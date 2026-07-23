import * as THREE from 'three';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { createEnvironmentLighting } from './js/lighting.js';
import { createShadowRig } from './js/shadow/shadow-rig.js';
import { applyPhotoFinish } from './js/postfx.js';
import { applyAtmosphericPerspective } from './js/atmosphere.js';
import { CHARACTERS } from './js/characters-data.js';
import { loadCharacter as loadCharacterCore } from './js/character.js';
import { initDiagnostics } from './js/diagnostics.js';
import { createIdleMotionManager } from './js/idle-motion.js';
import { GroundEstimator } from './js/environment/ground-estimator.js';
import { PlacementReticle } from './js/placement-reticle.js';
import { computePerceptualScaleFactor } from './js/perceptual-scale.js';
import { createCompassCalibration } from './js/compass-calibration.js';

let currentCharacterIndex = 0;

/* ============================================================
   DOM
   ============================================================ */
const selectScreen  = document.getElementById('select-screen');
const characterList = document.getElementById('character-list');
const startScreen   = document.getElementById('start-screen');
const startBtn      = document.getElementById('start-btn');
const startError    = document.getElementById('start-error');
const stageWrap     = document.getElementById('stage-wrap');
const stage         = document.getElementById('stage');
const video         = document.getElementById('camera-video');
const canvas        = document.getElementById('three-canvas');
const switchCamBtn  = document.getElementById('switch-cam-btn');
const reticleBtn    = document.getElementById('reticle-btn');
const resetBtn      = document.getElementById('reset-btn');
const shutterBtn    = document.getElementById('shutter-btn');
const resultScreen  = document.getElementById('result-screen');
const resultImg     = document.getElementById('result-img');
const resultHint    = document.getElementById('result-hint');
const shareBtn      = document.getElementById('share-btn');
const retakeBtn     = document.getElementById('retake-btn');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText   = document.getElementById('loading-text');
const timerBtn = document.getElementById('timer-btn');
const countdownOverlay = document.getElementById('countdown-overlay');
const countdownNum = document.getElementById('countdown-num');
const flashOverlay = document.getElementById('flash-overlay');
const shutterStatus = document.getElementById('shutter-status');
const framingBar = document.getElementById('framing-bar');
const modeBtn = document.getElementById('mode-btn');
const resultImgWrap = document.getElementById('result-imgwrap');
const resultVideo = document.getElementById('result-video');
const poseToast = document.getElementById('pose-toast');

let poseToastTimer = null;
function showPoseToast(text) {
  poseToast.textContent = text;
  poseToast.classList.add('show');
  clearTimeout(poseToastTimer);
  poseToastTimer = setTimeout(() => poseToast.classList.remove('show'), 1200);
}

/* ============================================================
   状態
   ============================================================ */
const placement = { x: 0, y: -1.1, z: -3.2, rotY: 0, scale: 1 };
const DEFAULT_PLACEMENT = { ...placement };

let facingMode = 'environment';
let currentStream = null;
let currentBlobUrl = null;
let lastBlob = null;

/* ============================================================
   three.js セットアップ
   ============================================================ */
const renderer = new THREE.WebGLRenderer({
  canvas, antialias: true, alpha: true, preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

// OutlineEffect: MMDの材質のエッジ情報を使って輪郭線を描画する。
// ただしMMDそのままの太い黒線は「MMDらしさ」が強く出るため、
// モデル読み込み後に各材質のoutlineParametersを上書きして
// 細く・少し透けた線にすることでアニメ調に寄せている。
const effect = new OutlineEffect(renderer, { defaultThickness: 0.0015, defaultColor: [0.05, 0.04, 0.05], defaultAlpha: 0.6 });

const scene = new THREE.Scene();
/* 遠近法(パースペクティブ)についての注記(Sprint 1「遠近法」対応):
   three.jsのPerspectiveCamera.fovは垂直画角(度)。iPhoneの背面広角
   レンズ(26mm相当)は対角画角がおよそ73〜78度、16:9クロップ時の
   垂直画角に換算すると約42〜44度になるという公開情報を根拠に42度とした。
   フロント(TrueDepth)カメラはやや広角レンズのため40度とやや狭めに調整。
   実際のレンズ画角とはズレがあり得るため、実機で違和感があれば
   facingMode別のこの値を直接調整すること。 */
const FOV_BY_FACING = { environment: 42, user: 40 };
const camera = new THREE.PerspectiveCamera(FOV_BY_FACING.environment, 1, 0.05, 100);
camera.position.set(0, 0, 0);

// トーンマッピング: 明るさが1.0を超えた部分をハードに白飛びさせず、
// 映画・写真的になだらかに丸める。実写背景に馴染ませる狙いも兼ねる。
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// ライト構成についての重要な注記(MMDToonShaderのソースで確認済み):
// HemisphereLight(環境光)はトゥーンのグラデーション階調を経由せず、
// そのままベタ塗りで加算される(RE_IndirectDiffuse_BlinnPhong)。
// そのため強くしすぎるとトゥーンの階調が潰れて全体が白っぽく平坦になる。
// DirectionalLightは階調を経由するので、これらより強めにしても階調は保たれる。
// これらは「環境光推定」が周囲の明るさに応じて掛け合わせるための基準値。
const BASE_HEMI_INTENSITY = 0.35;
const BASE_DIR_INTENSITY = 0.85;
const BASE_RIM_INTENSITY = 0.25;
const BASE_TONE_EXPOSURE = 1.0;

const hemi = new THREE.HemisphereLight(0xffffff, 0x2a2a33, BASE_HEMI_INTENSITY);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xfff2d8, BASE_DIR_INTENSITY);
dir.position.set(1.2, 2.4, 1.6);
scene.add(dir);
// リムライト：背景写真に馴染ませるための縁光。CGっぽい平坦な陰影を減らす狙い。
const rim = new THREE.DirectionalLight(0xcfe8ff, BASE_RIM_INTENSITY);
rim.position.set(-1.5, 1.8, -2.0);
scene.add(rim);

// 足元の影(Contact Shadow・太陽光によるDirectional Shadow・環境連動の
// 濃さ補正)は js/shadow/ 以下のShadowRigに委譲(ADR-014)。
// rendererを渡すとshadowMap.enabled/typeを自動設定する。
const shadowRig = createShadowRig(scene, { renderer, quality: 'medium' });

// 環境解析(GPS/太陽位置/カメラ画像解析)・投影整合性チェック・距離較正・
// 画面内デバッグコンソールの初期化。CONSTRAINTS.md 1節の通り、まだ
// ドラフト運用の位置づけ(将来CONSTRAINTS.md改訂で正式化する)。
const diagnostics = initDiagnostics({
  video, stage, camera, renderer,
  getCharacter: () => activeCharacter,
  placement,
  applyPlacement,
  baseVerticalFovDeg: () => camera.fov,
});

// 環境光推定(平均色/輝度/簡易光源方向/露出)は js/lighting.js に委譲。
// getEnvironmentStateを渡すことで、EnvironmentAnalyzerのaverageLuminance/
// skyColor/groundColorを既存の画像ベース推定へ弱くブレンドする(js/lighting.js参照)。
const environmentLighting = createEnvironmentLighting({
  video, hemi, dir, rim, renderer,
  baseIntensities: { hemi: BASE_HEMI_INTENSITY, dir: BASE_DIR_INTENSITY, rim: BASE_RIM_INTENSITY },
  baseToneExposure: BASE_TONE_EXPOSURE,
  getEnvironmentState: () => diagnostics.getEnvironmentState(),
});

// コンパス較正(ADR-014の既知の制約への対応、ROADMAP.md「太陽方位角の
// コンパス較正」)。iOS SafariのwebkitCompassHeadingを使い、
// EnvironmentAnalyzerのsunAzimuth(地理方位)をこのアプリのAR空間内での
// 相対角へ変換する。詳細はjs/compass-calibration.js冒頭コメント参照。
const compassCalibration = createCompassCalibration();

// 20260722平面推定指示書 Part1: 固定高さの仮想床。
const groundEstimator = new GroundEstimator(DEFAULT_PLACEMENT.y);
// 20260722平面推定指示書 Part2〜4: 配置レティクル。
const placementReticle = new PlacementReticle(scene);
let placementMode = false;

// 実際のARカメラアプリ(Pokémon GO/IKEA Place等)を参考にした初回設置フロー。
// 「起動直後にまずレティクルで床を狙い、タップで設置してからメインUIが
// 使えるようになる」体験にするため、モデル読み込み完了後は一旦非表示のまま
// 待機させ、設置確定後に初めて表示・配置する。
let pendingInitialPlacement = false;
const placementIntro = document.getElementById('placement-intro');
const uiLayer = document.getElementById('ui-layer');

/* ============================================================
   キャラクターの抽象化・材質調整・ロード処理は js/character.js に委譲。
   ============================================================ */
let activeCharacter = null;

function loadCharacter(def) {
  loadCharacterCore(def, { MMDLoader, scene }, {
    onLoad: (character) => {
      activeCharacter = character;
      // 初回設置が確定するまでキャラクター自体は非表示にしておく
      // (裏読み込みは先に済ませ、体感の待ち時間を減らす)。
      character.root.visible = false;
      buildPoseRing(def);
      loadingOverlay.classList.add('hide');
      beginInitialPlacement();
    },
    onProgress: (xhr) => {
      if (xhr.lengthComputable) {
        const pct = Math.round((xhr.loaded / xhr.total) * 100);
        loadingText.textContent = `推しを読み込み中… ${pct}%`;
      }
    },
    onError: (err) => {
      console.error('MMD load error', err);
      loadingText.textContent = 'モデルの読み込みに失敗しました。ファイル配置を確認してください。';
    },
  });
}

/* ============================================================
   ポーズ/表情セレクター(分割リング)
   ------------------------------------------------------------
   実体はグローバルスクリプトのwindow.PoseRingとして
   index.htmlで先に読み込んでいる(main.jsより前・type=moduleではない
   通常scriptとして読み込むことで、main.js側からそのまま参照できる)。
   ============================================================ */
function buildPoseRing(def) {
  const poseItems = Object.entries(def.poses).map(([key, p]) => ({ key, emoji: p.emoji, label: p.label }));
  const exprItems = Object.entries(def.expressions).map(([key, p]) => ({ key, emoji: p.emoji, label: p.label }));
  window.PoseRing.init(
    [
      { key: 'pose', label: 'ポーズ', items: poseItems },
      { key: 'expr', label: '表情', items: exprItems },
    ],
    (categoryKey, itemKey, item) => {
      if (!activeCharacter) return;
      if (categoryKey === 'pose') {
        activeCharacter.setPose(itemKey);
        // 「座る」等centerOffsetを使うポーズは足元のワールドYが変わるため、
        // ポーズ切り替え時にも接地影の位置を再計算する。
        applyPlacement();
        showPoseToast(`ポーズ: ${item.label}`);
      } else if (categoryKey === 'expr') {
        activeCharacter.setExpression(itemKey);
        showPoseToast(`表情: ${item.label}`);
      }
    }
  );
}

/* ============================================================
   配置の反映
   ============================================================ */
function applyPlacement() {
  if (!activeCharacter) return;

  const distanceFromCam = Math.abs(placement.z - camera.position.z);

  // 20260722平面推定指示書 Part7/Part8: 知覚スケール補正はあくまで演出。
  // placement.scale自体は書き換えず、setTransformへ渡す直前でのみ
  // 乗算する(ピンチ拡縮・キャラクター設定・将来の保存データに
  // 補正が混入しないようにするため)。
  const perceptualFactor = computePerceptualScaleFactor(distanceFromCam);
  activeCharacter.setTransform({ ...placement, scale: placement.scale * perceptualFactor });

  const footY = activeCharacter.getFootY();
  const width = activeCharacter.getWidth();

  const azimuthConfidence = diagnostics.getAzimuthConfidence();
  const environmentState = diagnostics.getEnvironmentState();

  // 20260722影修正指示書 Part1 + コンパス較正:
  // 屋外・GPS精度良好・コンパス較正済みの場合は地理方位ベースのAR相対角を
  // 優先し、それ以外は従来通りlighting.jsの画像ベース推定を使う。
  // (このGPS優先化はADR-014の既知の制約と関わるため、詳細な経緯・
  //  実機確認が必要な点はOPEN_ITEMSを参照)
  let lightAzimuthDeg = environmentLighting.getEstimatedAzimuthDeg();
  if (
    environmentState &&
    environmentState.environmentType !== 'indoor' &&
    environmentState.gpsAccuracy != null && environmentState.gpsAccuracy <= 20 &&
    environmentState.sunAzimuth != null &&
    compassCalibration.isAvailable()
  ) {
    const calibratedAzimuth = compassCalibration.toARRelativeAzimuth(environmentState.sunAzimuth);
    if (calibratedAzimuth != null) lightAzimuthDeg = calibratedAzimuth;
  }

  shadowRig.update(
    footY, width, placement,
    lightAzimuthDeg,
    environmentLighting.getBrightnessFactor(),
    distanceFromCam,
    camera.position,
    azimuthConfidence,
    environmentState
  );
  applyAtmosphericPerspective(activeCharacter.root, distanceFromCam);
}

/* ============================================================
   配置レティクル(20260722平面推定指示書 Part5/6)
   ------------------------------------------------------------
   単一の🎯ボタンで「配置モードへ入る」「今の位置に確定する」を
   兼ねるトグル式にしている(tuneBtn等、既存のUIパターンに合わせた)。
     1回目のタップ: 配置モードON、レティクル表示開始
     2回目のタップ: レティクルの位置で確定し、配置モードOFF
   ============================================================ */
function confirmPlacement() {
  const pose = placementReticle.getPlacementPose();
  if (!pose) {
    showPoseToast('その場所には配置できません');
    return;
  }
  placement.x = pose.position.x;
  placement.y = pose.position.y;
  placement.z = pose.position.z;
  // rotationYは「初期設定値をそのまま使う」設計(placement-reticle.js参照)。
  groundEstimator.setGroundHeight(pose.position.y);
  applyPlacement();
  placementMode = false;
  placementReticle.hide();
  reticleBtn.classList.remove('active');
  showPoseToast('この場所に配置しました');
}

reticleBtn.addEventListener('click', () => {
  if (!activeCharacter || pendingInitialPlacement) return;
  if (!placementMode) {
    placementMode = true;
    reticleBtn.classList.add('active');
    placementReticle.show();
    showPoseToast('画面中央を床に向けてもう一度🎯を押すと配置します');
  } else {
    confirmPlacement();
  }
});

/**
 * 初回設置フロー: モデル読み込み完了直後に呼ばれる。実際のARカメラアプリ
 * (Pokémon GO/IKEA Place等)の「まず床を狙ってタップで設置」という
 * 導入フローを参考にした。キャラクター・メインUIは隠したまま、
 * レティクルと案内バナーだけを表示する。
 */
function beginInitialPlacement() {
  pendingInitialPlacement = true;
  placementMode = true;
  placementReticle.show();
  uiLayer.classList.add('placement-pending');
  placementIntro.classList.add('show');
}

/**
 * 初回設置の確定。画面タップ(touchendハンドラ内)から呼ばれる。
 * レティクルの位置が無効(床が見つかっていない)場合は確定せず、
 * 案内を出して待ち続ける。
 */
function confirmInitialPlacement() {
  const pose = placementReticle.getPlacementPose();
  if (!pose) {
    showPoseToast('床が見つかりません。スマホをもう少し下に向けてください');
    return;
  }
  placement.x = pose.position.x;
  placement.y = pose.position.y;
  placement.z = pose.position.z;
  groundEstimator.setGroundHeight(pose.position.y);

  activeCharacter.root.visible = true;
  applyPlacement();

  pendingInitialPlacement = false;
  placementMode = false;
  placementReticle.hide();
  uiLayer.classList.remove('placement-pending');
  placementIntro.classList.remove('show');
  showPoseToast('この場所に配置しました');
}

/* ============================================================
   方位センサー(コンパス較正専用、カメラ回転には使わない)
   ------------------------------------------------------------
   【2026/07/26 設計変更の経緯】
   これまでDeviceOrientationEvent(alpha/beta/gamma)から求めた
   クォータニオンをcamera.quaternionへ毎フレーム反映し、「スマホの
   向きを変えてもキャラクターがその場に立っているように見える」
   3DoFジャイロAR(ADR-002)を実装していた。しかし実機で
   「スマホを傾けるとキャラクターが横に傾いて不自然」「レティクルの
   床認識が安定しない」という2つの問題が解消しなかった。

   ARKit(IKEA Place等)の実際の仕組みを調べ直したところ、これらの
   アプリは加速度センサー/ジャイロだけでなく、カメラ画像の特徴点を
   継続的に追跡する視覚慣性オドメトリ(VIO)によって「回転」だけでなく
   「並進移動(スマホの位置そのもの)」までリアルタイムに推定しており、
   それによって初めて「置いた物が本当にその場に固定されて見える」
   体験が成立している(参考: Appleの公式ARKitサンプル解説、
   ARKit Planes/Hit-Test系の各種技術記事)。本アプリはWeb(Safari)
   専用で、WebXR Device APIもSafariでは利用できず、ARKitのような
   視覚慣性オドメトリには技術的にアクセスできない(CONSTRAINTS.md/
   ADR-001の制約)。つまり「回転センサーの値だけ」からVIO相当の
   体験を再現しようとすること自体が、原理的に無理のある設計だった。

   そこで今回、方針を変更する:
   - camera.quaternionはジャイロで動かさず、常に固定(初期値)のままにする。
     これにより「スマホを傾けるとキャラクターが傾いて見える」問題は
     原理的に解消する(動かす入力自体が無くなるため)。
   - 配置レティクル(placement-reticle.js)のレイキャストは、
     「常に同じ向きの固定カメラ」に対する計算になるため、センサー
     ノイズの影響を受けず、フレームごとに結果が安定する
     (ADR-014が問題視していた「視線角度が変わるたびに交点が暴れる」
     現象は、視線そのものが変化しなくなったことで構造的に解消される)。
   - 「配置したら最初の位置から動かない」という要望にも、これで
     directに応える(スマホの向きが変わっても一切追従しない)。
   - DeviceOrientationEventの購読自体は残すが、用途を
     webkitCompassHeading(コンパス較正、影の方位補正用)の取得のみに
     縮小する。
   ============================================================ */

function onDeviceOrientation(e) {
  // コンパス較正(js/compass-calibration.js): iOS Safariのみ存在する
  // 非標準プロパティ。受信するたびに最新値を記録しておく。
  compassCalibration.recordHeading(e.webkitCompassHeading);
}
async function requestOrientationPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      return res === 'granted';
    } catch (e) { console.warn('orientation permission error', e); return false; }
  }
  return typeof DeviceOrientationEvent !== 'undefined';
}
function enableOrientationSensing() {
  window.addEventListener('deviceorientation', onDeviceOrientation);
}

/* ============================================================
   手ぶれ検知（写真のブレ対策）
   ------------------------------------------------------------
   devicemotionの角速度(rotationRate)の合計を「揺れの大きさ」の
   簡易指標として使い、一定時間おさまるまでシャッターを待つ。
   真のOIS/EISではないが、「止まってから撮る」ことでブレを減らす
   実用的な近似。
   ============================================================ */
let lastMotionMagnitude = 0;
function onDeviceMotion(e) {
  const rr = e.rotationRate || {};
  lastMotionMagnitude = Math.abs(rr.alpha || 0) + Math.abs(rr.beta || 0) + Math.abs(rr.gamma || 0);
}
async function requestMotionPermission() {
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    try {
      const res = await DeviceMotionEvent.requestPermission();
      return res === 'granted';
    } catch (e) { console.warn('motion permission error', e); return false; }
  }
  return typeof DeviceMotionEvent !== 'undefined';
}
function enableMotionTracking() {
  window.addEventListener('devicemotion', onDeviceMotion);
}

const STEADY_THRESHOLD = 12;   // deg/s の合計。これ未満なら「静止」とみなす
const STEADY_HOLD_MS = 180;    // これだけ静止が続いたら撮影する
const STEADY_MAX_WAIT_MS = 1500; // これ以上は待たず、諦めて撮影する

function waitForSteady() {
  return new Promise((resolve) => {
    const start = performance.now();
    let steadySince = null;
    function poll() {
      const now = performance.now();
      if (lastMotionMagnitude < STEADY_THRESHOLD) {
        if (steadySince === null) steadySince = now;
        if (now - steadySince >= STEADY_HOLD_MS) { resolve(); return; }
      } else {
        steadySince = null;
      }
      if (now - start >= STEADY_MAX_WAIT_MS) { resolve(); return; }
      requestAnimationFrame(poll);
    }
    poll();
  });
}

/* ============================================================
   カメラ映像
   ============================================================ */
async function startCamera() {
  stopCamera();
  try {
    const constraints = {
      audio: false,
      video: { facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    currentStream = stream;
    video.srcObject = stream;
    video.classList.toggle('mirror', facingMode === 'user');
    await video.play();
    video.addEventListener('loadedmetadata', onVideoMeta, { once: true });
    if (video.videoWidth) onVideoMeta();
  } catch (err) {
    console.error(err);
    startError.textContent = 'カメラを起動できませんでした。設定で許可を確認してください。';
    throw err;
  }
}
function stopCamera() {
  if (currentStream) { currentStream.getTracks().forEach((t) => t.stop()); currentStream = null; }
}
function onVideoMeta() {
  sizeStageToVideo(video.videoWidth || 1080, video.videoHeight || 1920);
}
function sizeStageToVideo(vw, vh) {
  const aspect = vw / vh;
  const wrapRect = stageWrap.getBoundingClientRect();
  let w = wrapRect.width, h = w / aspect;
  if (h > wrapRect.height) { h = wrapRect.height; w = h * aspect; }
  stage.style.width = `${w}px`;
  stage.style.height = `${h}px`;
  renderer.setSize(vw, vh, false);
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', () => {
  if (video.videoWidth) sizeStageToVideo(video.videoWidth, video.videoHeight);
});
// 横向き対応：回転直後はvideoWidth/Heightやbounding rectの更新が
// 一瞬遅れる機種があるため、resizeに加えて少し遅らせて再計算する。
window.addEventListener('orientationchange', () => {
  setTimeout(() => {
    if (video.videoWidth) sizeStageToVideo(video.videoWidth, video.videoHeight);
  }, 150);
});

/* ============================================================
   ジェスチャー操作
   ------------------------------------------------------------
   1本指ドラッグ: X/Y移動
   1本指タップ(短時間・ほぼ動かさない): タップした床の位置へ自動配置
   2本指ピンチ: 拡縮(scale)
   2本指ひねり: 回転(rotY)
   2本指の縦方向の動き: 奥行き(Z)移動
   ============================================================ */
// タップと判定する閾値(これを超えて動く/長押しするとドラッグ扱いのまま)
const TAP_MAX_MOVE_PX = 12;
const TAP_MAX_DURATION_MS = 350;

// 2本指の縦ドラッグでどこまでZを動かせるか(m、カメラ前方向)。
const MIN_CHARACTER_DISTANCE_Z = -25;
const MAX_CHARACTER_DISTANCE_Z = -0.8;
// 縦ドラッグの感度係数。1.0が「指の動きと同じ量だけ実距離が動く」基準値で、
// 奥行きの変化は横移動より体感しにくいため気持ち強めにしている。
const DEPTH_DRAG_GAIN = 1.3;

// 2本指ジェスチャーが「拡縮/回転(planar)」なのか「奥行き移動(depth)」なのかを
// 判定してロックするまでの猶予(px)。
const GESTURE_LOCK_THRESHOLD_PX = 14;
const GESTURE_LOCK_ANGLE_RAD = THREE.MathUtils.degToRad(6);

const touchState = {
  mode: null, lastX: 0, lastY: 0,
  startDist: 0, startAngle: 0, startScale: 1, startRotY: 0,
  startMidY: 0, startZ: 0,
  startX: 0, startY: 0, startTime: 0, hadMultiTouch: false,
  gestureLock: null, // null | 'planar' | 'depth'
};
function touchDist(t0, t1) { return Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY); }
function touchAngle(t0, t1) { return Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX); }
function touchMidY(t0, t1) { return (t0.clientY + t1.clientY) / 2; }
function normalizeAngle(a) { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; }

const _floorRaycaster = new THREE.Raycaster();
/**
 * 画面上の1点(clientX/Y)を、キャラクターが「今すでに立っている高さ」と
 * 同じ水平面に投影し、そのワールド座標(x,z)を返す。
 *
 * 【2026/07/26追記】この関数はcamera.quaternionを経由するレイキャストを
 * 行うが、main.jsがジャイロによるcamera.quaternionの更新を廃止したため、
 * cameraの向きは常に固定(初期値)である。そのためこの関数の結果は
 * フレームごとに変化しない決定論的な計算になり、以前懸念していた
 * 「ジャイロ由来の姿勢が不安定なことによる交点の発散」という問題は
 * 構造的に解消している。
 */
function computeFloorPointFromScreen(clientX, clientY) {
  if (!activeCharacter) return null;
  const rect = stage.getBoundingClientRect();
  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = -(((clientY - rect.top) / rect.height) * 2 - 1);
  _floorRaycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
  const floorY = activeCharacter.getFootY();
  const origin = _floorRaycaster.ray.origin;
  const dir = _floorRaycaster.ray.direction;
  if (Math.abs(dir.y) < 1e-5) return null; // 床とほぼ平行な視線では交点が求まらない
  const t = (floorY - origin.y) / dir.y;
  if (t <= 0.05) return null; // 交点がカメラの後ろ、あるいは極端に近すぎる(=上向きの視線)
  return origin.clone().addScaledVector(dir, t);
}

/**
 * タップされた床の位置へキャラクターを再配置する。footYは変化しない
 * (x/zの平行移動のみで、rotation/scaleは変えないため)ので、
 * 常に「今の接地の高さ」を保ったまま位置だけを移せる。
 */
function placeCharacterAtScreenPoint(clientX, clientY) {
  const hit = computeFloorPointFromScreen(clientX, clientY);
  if (!hit) {
    showPoseToast('その場所には配置できません');
    return;
  }
  placement.x = hit.x;
  placement.z = hit.z;
  applyPlacement();
  showPoseToast('この場所に配置しました');
}

stage.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (e.touches.length === 1) {
    touchState.mode = 'drag';
    touchState.lastX = e.touches[0].clientX; touchState.lastY = e.touches[0].clientY;
    // タップ判定用: 1本指シーケンスの開始時点の情報を記録する。
    touchState.startX = e.touches[0].clientX;
    touchState.startY = e.touches[0].clientY;
    touchState.startTime = Date.now();
    touchState.hadMultiTouch = false;
  } else if (e.touches.length >= 2) {
    touchState.mode = 'gesture';
    touchState.hadMultiTouch = true;
    touchState.startDist = touchDist(e.touches[0], e.touches[1]);
    touchState.startAngle = touchAngle(e.touches[0], e.touches[1]);
    touchState.startScale = placement.scale;
    touchState.startRotY = placement.rotY;
    touchState.startMidY = touchMidY(e.touches[0], e.touches[1]);
    touchState.startZ = placement.z;
    touchState.gestureLock = null;
  }
}, { passive: false });

stage.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (touchState.mode === 'drag' && e.touches.length === 1) {
    const t = e.touches[0];
    const dx = t.clientX - touchState.lastX, dy = t.clientY - touchState.lastY;
    touchState.lastX = t.clientX; touchState.lastY = t.clientY;
    const rect = stage.getBoundingClientRect();
    const distance = Math.abs(placement.z - camera.position.z);
    const vFovRad = THREE.MathUtils.degToRad(camera.fov);
    const worldPerPixelY = (2 * Math.tan(vFovRad / 2) * distance) / rect.height;
    placement.x += dx * worldPerPixelY;
    placement.y -= dy * worldPerPixelY;
    applyPlacement();
  } else if (touchState.mode === 'gesture' && e.touches.length >= 2) {
    const dist = touchDist(e.touches[0], e.touches[1]);
    const angle = touchAngle(e.touches[0], e.touches[1]);
    const midY = touchMidY(e.touches[0], e.touches[1]);

    const distDeltaPx = dist - touchState.startDist;
    const midYDeltaPx = midY - touchState.startMidY;
    const angleDeltaRad = normalizeAngle(angle - touchState.startAngle);

    if (!touchState.gestureLock) {
      if (Math.abs(midYDeltaPx) > GESTURE_LOCK_THRESHOLD_PX &&
          Math.abs(midYDeltaPx) > Math.abs(distDeltaPx) * 1.5) {
        touchState.gestureLock = 'depth';
      } else if (Math.abs(distDeltaPx) > GESTURE_LOCK_THRESHOLD_PX ||
                 Math.abs(angleDeltaRad) > GESTURE_LOCK_ANGLE_RAD) {
        touchState.gestureLock = 'planar';
      }
    }

    if (touchState.gestureLock !== 'depth') {
      const scaleRatio = dist / (touchState.startDist || dist);
      placement.scale = THREE.MathUtils.clamp(touchState.startScale * scaleRatio, 0.2, 5);
      placement.rotY = touchState.startRotY - angleDeltaRad;
    }

    if (touchState.gestureLock !== 'planar') {
      const rect = stage.getBoundingClientRect();
      const distFromCamAtStart = Math.abs(touchState.startZ - camera.position.z);
      const depthPerPixel = distFromCamAtStart / rect.height;
      placement.z = THREE.MathUtils.clamp(
        touchState.startZ + midYDeltaPx * depthPerPixel * DEPTH_DRAG_GAIN,
        MIN_CHARACTER_DISTANCE_Z,
        MAX_CHARACTER_DISTANCE_Z
      );
    }

    applyPlacement();
  }
}, { passive: false });

stage.addEventListener('touchend', (e) => {
  e.preventDefault();
  if (touchState.mode === 'drag' && !touchState.hadMultiTouch && e.changedTouches.length > 0) {
    const t = e.changedTouches[0];
    const movedPx = Math.hypot(t.clientX - touchState.startX, t.clientY - touchState.startY);
    const elapsedMs = Date.now() - touchState.startTime;
    if (movedPx <= TAP_MAX_MOVE_PX && elapsedMs <= TAP_MAX_DURATION_MS) {
      if (pendingInitialPlacement) {
        confirmInitialPlacement();
      } else if (!placementMode) {
        placeCharacterAtScreenPoint(t.clientX, t.clientY);
      }
    }
  }
  if (e.touches.length === 0) touchState.mode = null;
  else if (e.touches.length === 1) {
    touchState.mode = 'drag';
    touchState.lastX = e.touches[0].clientX; touchState.lastY = e.touches[0].clientY;
  }
}, { passive: false });

resetBtn.addEventListener('click', () => {
  Object.assign(placement, DEFAULT_PLACEMENT);
  applyPlacement();
});

switchCamBtn.addEventListener('click', async () => {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  camera.fov = FOV_BY_FACING[facingMode];
  camera.updateProjectionMatrix();
  await startCamera();
  environmentLighting.start();
  diagnostics.start();
});

/* ============================================================
   セルフタイマー
   ============================================================ */
const TIMER_OPTIONS = [0, 3, 10];
let timerIndex = 0;
function updateTimerBtnLabel() {
  const v = TIMER_OPTIONS[timerIndex];
  timerBtn.textContent = v === 0 ? '⏱' : `⏱${v}`;
  timerBtn.classList.toggle('active', v > 0);
}
timerBtn.addEventListener('click', () => {
  timerIndex = (timerIndex + 1) % TIMER_OPTIONS.length;
  updateTimerBtnLabel();
});
updateTimerBtnLabel();

/* ============================================================
   アングル(フレーミング)切替
   ============================================================ */
const FRAMING_PRESETS = {
  full:  { label: '全身',     camZ: 0,    camY: 0 },
  half:  { label: '上半身',   camZ: -1.3, camY: 0.3 },
  close: { label: '顔アップ', camZ: -2.3, camY: 0.7 },
};
let currentFramingKey = 'full';
function applyFraming(key) {
  const p = FRAMING_PRESETS[key];
  if (!p) return;
  currentFramingKey = key;
  camera.position.z = p.camZ;
  camera.position.y = p.camY;
  applyPlacement();
}
function buildFramingBar() {
  framingBar.innerHTML = '';
  const buttons = {};
  Object.entries(FRAMING_PRESETS).forEach(([key, p]) => {
    const btn = document.createElement('button');
    btn.className = 'framing-btn' + (key === currentFramingKey ? ' active' : '');
    btn.textContent = p.label;
    btn.addEventListener('click', () => {
      applyFraming(key);
      Object.values(buttons).forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
    buttons[key] = btn;
    framingBar.appendChild(btn);
  });
}
buildFramingBar();

function runCountdown(seconds) {
  return new Promise((resolve) => {
    if (seconds <= 0) { resolve(); return; }
    countdownOverlay.classList.add('show');
    let remaining = seconds;
    countdownNum.textContent = String(remaining);
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) {
        countdownOverlay.classList.remove('show');
        resolve();
        return;
      }
      countdownNum.textContent = '';
      requestAnimationFrame(() => { countdownNum.textContent = String(remaining); });
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 1000);
  });
}

/* ============================================================
   撮影（写真／動画）
   ============================================================ */
let lastIsVideo = false;
let isVideoMode = false;

function capture() {
  effect.render(scene, camera);
  const vw = video.videoWidth, vh = video.videoHeight;
  const out = document.createElement('canvas');
  out.width = vw; out.height = vh;
  const ctx = out.getContext('2d');
  if (facingMode === 'user') { ctx.translate(vw, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0, vw, vh);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(renderer.domElement, 0, 0, vw, vh);
  applyPhotoFinish(out, { envTint: environmentLighting.getEstimatedTintColor() });
  out.toBlob((blob) => {
    showResult(blob, false);
  }, 'image/png');
}

function showResult(blob, isVideo) {
  if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
  currentBlobUrl = URL.createObjectURL(blob);
  lastBlob = blob;
  lastIsVideo = isVideo;
  resultImgWrap.classList.toggle('video-mode', isVideo);
  if (isVideo) {
    resultVideo.src = currentBlobUrl;
    resultVideo.play().catch(() => {});
  } else {
    resultImg.src = currentBlobUrl;
  }
  resultHint.textContent = isVideo
    ? '動画を長押しして保存するか、下のボタンで共有してください'
    : '画像を長押しして「写真に保存」してください';
  resultScreen.classList.add('show');
}

function flashEffect() {
  flashOverlay.classList.remove('flash-out');
  flashOverlay.classList.add('flash');
  requestAnimationFrame(() => {
    flashOverlay.classList.remove('flash');
    flashOverlay.classList.add('flash-out');
  });
}

/* ---- 動画撮影：video要素とthree.jsの描画を1枚のcanvasへ毎フレーム合成し、
   そのcanvasのcaptureStream()をMediaRecorderで録画する ---- */
const recordCanvas = document.createElement('canvas');
const recordCtx = recordCanvas.getContext('2d');
let mediaRecorder = null;
let recordedChunks = [];
let recordLoopId = null;
let isRecording = false;
let recordStartTime = 0;
let recordTimerInterval = null;

function pickSupportedMime() {
  const candidates = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  if (typeof MediaRecorder === 'undefined') return '';
  return candidates.find((c) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) || '';
}

function recordFrameLoop() {
  if (!isRecording) return;
  const vw = video.videoWidth, vh = video.videoHeight;
  if (vw && (recordCanvas.width !== vw || recordCanvas.height !== vh)) {
    recordCanvas.width = vw; recordCanvas.height = vh;
  }
  if (vw) {
    if (facingMode === 'user') { recordCtx.save(); recordCtx.translate(vw, 0); recordCtx.scale(-1, 1); }
    recordCtx.drawImage(video, 0, 0, vw, vh);
    if (facingMode === 'user') recordCtx.restore();
    recordCtx.drawImage(renderer.domElement, 0, 0, vw, vh);
  }
  recordLoopId = requestAnimationFrame(recordFrameLoop);
}

function startVideoRecording() {
  if (typeof MediaRecorder === 'undefined' || !recordCanvas.captureStream) {
    resultHint.textContent = 'この端末/ブラウザは動画撮影に対応していません';
    return;
  }
  const mime = pickSupportedMime();
  const stream = recordCanvas.captureStream(30);
  recordedChunks = [];
  try {
    mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  } catch (e) {
    console.error('MediaRecorder init failed', e);
    resultHint.textContent = '動画撮影を開始できませんでした';
    return;
  }
  mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: mime || 'video/mp4' });
    showResult(blob, true);
  };
  isRecording = true;
  mediaRecorder.start();
  recordFrameLoop();

  recordStartTime = performance.now();
  shutterBtn.classList.add('recording');
  shutterStatus.classList.add('show');
  recordTimerInterval = setInterval(() => {
    const sec = Math.floor((performance.now() - recordStartTime) / 1000);
    shutterStatus.textContent = `● 録画中 ${sec}秒`;
  }, 250);
}

function stopVideoRecording() {
  isRecording = false;
  if (recordLoopId) cancelAnimationFrame(recordLoopId);
  if (recordTimerInterval) { clearInterval(recordTimerInterval); recordTimerInterval = null; }
  shutterBtn.classList.remove('recording');
  shutterStatus.classList.remove('show');
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
}

modeBtn.addEventListener('click', () => {
  if (isRecording) return; // 録画中はモード切替させない
  isVideoMode = !isVideoMode;
  modeBtn.textContent = isVideoMode ? '🎥 動画' : '📷 写真';
  modeBtn.classList.toggle('video-mode', isVideoMode);
});

let isCapturing = false;
async function onShutterPress() {
  if (isVideoMode) {
    if (isRecording) {
      if (navigator.vibrate) navigator.vibrate(20);
      stopVideoRecording();
    } else {
      await runCountdown(TIMER_OPTIONS[timerIndex]);
      if (navigator.vibrate) navigator.vibrate([15, 60, 15]);
      startVideoRecording();
    }
    return;
  }

  if (isCapturing) return;
  isCapturing = true;
  shutterBtn.disabled = true;
  try {
    await runCountdown(TIMER_OPTIONS[timerIndex]);

    shutterBtn.classList.add('waiting');
    shutterStatus.textContent = '手ぶれを確認中…';
    shutterStatus.classList.add('show');
    await waitForSteady();
    shutterBtn.classList.remove('waiting');
    shutterStatus.classList.remove('show');

    if (navigator.vibrate) navigator.vibrate(15);
    flashEffect();
    capture();
  } finally {
    isCapturing = false;
    shutterBtn.disabled = false;
  }
}
shutterBtn.addEventListener('click', onShutterPress);
retakeBtn.addEventListener('click', () => resultScreen.classList.remove('show'));

shareBtn.addEventListener('click', async () => {
  if (!lastBlob) return;
  const ext = lastIsVideo ? (lastBlob.type.includes('mp4') ? 'mp4' : 'webm') : 'png';
  const file = new File([lastBlob], `oshi-camera.${ext}`, { type: lastBlob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; }
    catch (err) { if (err && err.name === 'AbortError') return; console.error(err); }
  }
  resultHint.textContent = lastIsVideo
    ? 'この環境では共有シートが使えません。動画を長押しして保存してください'
    : 'この環境では共有シートが使えません。画像を長押しして「写真に保存」してください';
});

/* ============================================================
   待機モーション(20260721ポージング指示書 + 補足指示)
   ------------------------------------------------------------
   ユーザー操作が30秒以上ない場合、既存のwaveポーズ+wink表情、
   または上半身の左右揺れ(setGlobalOffset('bodyYaw', 最大9度))を
   自動再生する機能として実装した。

   【2026/07/26時点、既定でOFFにした】
   「配置後にモデルが傾く/動く」という今回の報告のうち、特に
   「横に傾く」という症状は、この待機モーションのうち上半身を
   最大9度左右に揺らす「sway」の可能性がある(30秒操作しないと
   自動発動する仕様のため、気づかないうちに再生されていた可能性がある)。
   ジャイロ由来の傾き(方位センサーセクション参照)と切り分けるため、
   一旦この機能自体を無効化しておく。「配置したら動かない」という
   要望に対しても、まずはこちらをOFFにするのが安全と判断した。
   気に入っている場合や、原因が待機モーションではなかったと分かった
   場合は、IDLE_MOTION_ENABLEDをtrueに戻せばそのまま復活する
   (js/idle-motion.js自体は変更していない)。
   ============================================================ */
const IDLE_MOTION_ENABLED = false;
if (IDLE_MOTION_ENABLED) {
  const idleMotion = createIdleMotionManager({
    getCharacter: () => activeCharacter,
    isBusy: () => isCapturing || isRecording,
  });
  idleMotion.attachAutoListeners(stage);
  idleMotion.attachAutoListeners(document.getElementById('ui-layer'));
}

/* ============================================================
   レンダーループ
   ============================================================ */
let lastTime = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;

  // 2026/07/26: camera.quaternionはジャイロで動かさず、常に固定のまま
  // にする方針へ変更した(詳細は「方位センサー」セクションのコメント参照)。
  // そのためここには何も書かない(意図的に空、将来また混乱しないように明記)。
  if (activeCharacter) activeCharacter.update(dt);
  if (placementMode) {
    placementReticle.update(groundEstimator.getGroundPlane(), camera, dt);
  }
  effect.render(scene, camera);
}
animate();

/* ============================================================
   起動フロー
   ============================================================ */
function initCharacterSelect() {
  if (CHARACTERS.length <= 1) {
    selectScreen.style.display = 'none';
    currentCharacterIndex = 0;
    return;
  }
  selectScreen.style.display = 'flex';
  characterList.innerHTML = '';
  CHARACTERS.forEach((def, i) => {
    const card = document.createElement('div');
    card.className = 'character-card';
    card.innerHTML = `<div class="thumb">${def.thumb || '⭐'}</div><div class="cname">${def.name}</div>`;
    card.addEventListener('click', () => {
      currentCharacterIndex = i;
      selectScreen.style.display = 'none';
    });
    characterList.appendChild(card);
  });
}
initCharacterSelect();

startBtn.addEventListener('click', async () => {
  startError.textContent = '';
  try {
    const orientationOK = await requestOrientationPermission();
    if (orientationOK) enableOrientationSensing();
    const motionOK = await requestMotionPermission();
    if (motionOK) enableMotionTracking();
    await startCamera();
    startScreen.style.display = 'none';
    loadCharacter(CHARACTERS[currentCharacterIndex]);
    environmentLighting.start();
    diagnostics.start();
  } catch (err) {
    // エラーメッセージは startCamera 内で表示済み
  }
});
