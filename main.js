import * as THREE from 'three';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { createEnvironmentLighting } from './js/lighting.js';
import { createShadowRig } from './js/shadow-rig.js';
import { applyPhotoFinish } from './js/postfx.js';
import { CHARACTERS } from './js/characters-data.js';
import { loadCharacter as loadCharacterCore } from './js/character.js';
import {
  buildExpressionBar as buildExpressionBarCore,
  buildPoseBar as buildPoseBarCore,
  createPoseTuner,
} from './js/pose-ui.js';

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
const resetBtn      = document.getElementById('reset-btn');
const tuneBtn       = document.getElementById('tune-btn');
const poseBar       = document.getElementById('pose-bar');
const expressionBar = document.getElementById('expression-bar');
const shutterBtn    = document.getElementById('shutter-btn');
const resultScreen  = document.getElementById('result-screen');
const resultImg     = document.getElementById('result-img');
const resultHint    = document.getElementById('result-hint');
const shareBtn      = document.getElementById('share-btn');
const retakeBtn     = document.getElementById('retake-btn');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText   = document.getElementById('loading-text');
const posePanel     = document.getElementById('pose-panel');
const posePanelClose = document.getElementById('pose-panel-close');
const tuneBoneSelect = document.getElementById('tune-bone-select');
const tuneX = document.getElementById('tune-x');
const tuneY = document.getElementById('tune-y');
const tuneZ = document.getElementById('tune-z');
const tuneXVal = document.getElementById('tune-x-val');
const tuneYVal = document.getElementById('tune-y-val');
const tuneZVal = document.getElementById('tune-z-val');
const tuneResetBtn = document.getElementById('tune-reset-btn');
const tuneCopyBtn = document.getElementById('tune-copy-btn');
const posePanelHint = document.getElementById('pose-panel-hint');
const gridBtn = document.getElementById('grid-btn');
const gridOverlay = document.getElementById('grid-overlay');
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

// 環境光推定(平均色/輝度/簡易光源方向/露出)は js/lighting.js に委譲。
// (Sprint 1 Task 1, Task 3。詳細はdocs/SPRINT_1_REPORT.md参照)
const environmentLighting = createEnvironmentLighting({
  video, hemi, dir, rim, renderer,
  baseIntensities: { hemi: BASE_HEMI_INTENSITY, dir: BASE_DIR_INTENSITY, rim: BASE_RIM_INTENSITY },
  baseToneExposure: BASE_TONE_EXPOSURE,
});

// 足元の影(二重影+接触AO)は js/shadow-rig.js に委譲(Sprint 1 Task 2)。
const shadowRig = createShadowRig(scene);

/* ============================================================
   キャラクターの抽象化・材質調整・ロード処理は js/character.js に委譲。
   ============================================================ */
let activeCharacter = null;

function loadCharacter(def) {
  loadCharacterCore(def, { MMDLoader, scene }, {
    onLoad: (character) => {
      activeCharacter = character;
      applyPlacement();
      buildExpressionBar(def);
      buildPoseBar(def);
      loadingOverlay.classList.add('hide');
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
   表情バー・ポーズバー・ポーズ調整パネル
   ------------------------------------------------------------
   実体はjs/pose-ui.jsに共通化(dev.jsのPC開発者モードと共有)。
   ============================================================ */
function buildExpressionBar(def) {
  buildExpressionBarCore(expressionBar, def, () => activeCharacter, (label) => {
    showPoseToast(`表情: ${label}`);
  });
}
function buildPoseBar(def) {
  buildPoseBarCore(poseBar, def, () => activeCharacter, (label) => {
    if (posePanel.classList.contains('show')) poseTuner.refresh();
    showPoseToast(`ポーズ: ${label}`);
  });
}

const poseTuner = createPoseTuner({
  select: tuneBoneSelect,
  xSlider: tuneX, ySlider: tuneY, zSlider: tuneZ,
  xVal: tuneXVal, yVal: tuneYVal, zVal: tuneZVal,
  hint: posePanelHint,
}, () => activeCharacter);

tuneBtn.addEventListener('click', () => {
  posePanel.classList.toggle('show');
  tuneBtn.classList.toggle('active');
  if (posePanel.classList.contains('show')) poseTuner.refresh();
});
posePanelClose.addEventListener('click', () => {
  posePanel.classList.remove('show');
  tuneBtn.classList.remove('active');
});
tuneResetBtn.addEventListener('click', () => poseTuner.resetToDefault());
tuneCopyBtn.addEventListener('click', () => poseTuner.copyJSON());

/* ============================================================
   配置の反映
   ============================================================ */
function applyPlacement() {
  if (!activeCharacter) return;
  activeCharacter.setTransform(placement);
  const footY = activeCharacter.getFootY();
  const width = activeCharacter.getWidth();
  shadowRig.update(footY, width, placement, environmentLighting.getEstimatedAzimuthDeg());
}

/* ============================================================
   ジャイロAR（3DoF）
   ============================================================ */
let gyroEnabled = false;
let gyroRefQuat = null;
let gyroCurQuat = null;

const _zee = new THREE.Vector3(0, 0, 1);
const _euler = new THREE.Euler();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));

function getScreenOrientationRad() {
  const angle = (screen.orientation && typeof screen.orientation.angle === 'number')
    ? screen.orientation.angle
    : (window.orientation || 0);
  return THREE.MathUtils.degToRad(angle);
}
function deviceOrientationToQuaternion(alphaDeg, betaDeg, gammaDeg, out) {
  const alpha = THREE.MathUtils.degToRad(alphaDeg || 0);
  const beta = THREE.MathUtils.degToRad(betaDeg || 0);
  const gamma = THREE.MathUtils.degToRad(gammaDeg || 0);
  const orient = getScreenOrientationRad();
  _euler.set(beta, alpha, -gamma, 'YXZ');
  out.setFromEuler(_euler);
  out.multiply(_q1);
  out.multiply(_q0.setFromAxisAngle(_zee, -orient));
  return out;
}
function onDeviceOrientation(e) {
  if (e.alpha === null) return;
  if (!gyroCurQuat) gyroCurQuat = new THREE.Quaternion();
  deviceOrientationToQuaternion(e.alpha, e.beta, e.gamma, gyroCurQuat);
  if (!gyroRefQuat) gyroRefQuat = gyroCurQuat.clone();
}
async function requestGyroPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      return res === 'granted';
    } catch (e) { console.warn('gyro permission error', e); return false; }
  }
  return typeof DeviceOrientationEvent !== 'undefined';
}
function enableGyro() {
  gyroEnabled = true;
  window.addEventListener('deviceorientation', onDeviceOrientation);
}
function reanchorGyro() {
  gyroRefQuat = gyroCurQuat ? gyroCurQuat.clone() : null;
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
   ============================================================ */
const touchState = { mode: null, lastX: 0, lastY: 0, startDist: 0, startAngle: 0, startScale: 1, startRotY: 0 };
function touchDist(t0, t1) { return Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY); }
function touchAngle(t0, t1) { return Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX); }
function normalizeAngle(a) { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; }

stage.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (e.touches.length === 1) {
    touchState.mode = 'drag';
    touchState.lastX = e.touches[0].clientX; touchState.lastY = e.touches[0].clientY;
  } else if (e.touches.length >= 2) {
    touchState.mode = 'gesture';
    touchState.startDist = touchDist(e.touches[0], e.touches[1]);
    touchState.startAngle = touchAngle(e.touches[0], e.touches[1]);
    touchState.startScale = placement.scale;
    touchState.startRotY = placement.rotY;
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
    const scaleRatio = dist / (touchState.startDist || dist);
    const angleDelta = normalizeAngle(angle - touchState.startAngle);
    placement.scale = THREE.MathUtils.clamp(touchState.startScale * scaleRatio, 0.2, 5);
    placement.rotY = touchState.startRotY - angleDelta;
    applyPlacement();
  }
}, { passive: false });

stage.addEventListener('touchend', (e) => {
  e.preventDefault();
  if (e.touches.length === 0) touchState.mode = null;
  else if (e.touches.length === 1) {
    touchState.mode = 'drag';
    touchState.lastX = e.touches[0].clientX; touchState.lastY = e.touches[0].clientY;
  }
}, { passive: false });

resetBtn.addEventListener('click', () => {
  Object.assign(placement, DEFAULT_PLACEMENT);
  applyPlacement();
  reanchorGyro();
});

switchCamBtn.addEventListener('click', async () => {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  camera.fov = FOV_BY_FACING[facingMode];
  camera.updateProjectionMatrix();
  await startCamera();
  environmentLighting.start();
});

/* ============================================================
   構図グリッド／セルフタイマー
   ============================================================ */
gridBtn.addEventListener('click', () => {
  gridOverlay.classList.toggle('show');
  gridBtn.classList.toggle('active');
});

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
   ------------------------------------------------------------
   キャラクターの配置(placement)ではなく、カメラの位置を前後・上下に
   動かす(ドリー)方式にしている。これによりユーザーがドラッグで
   決めたキャラクターの立ち位置と干渉せず、ズーム相当の効果が出せる。
   数値は実機未検証のたたき台。
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
      // 同じ数字でもCSSアニメーションが再生されるよう一度クリアしてから設定
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
  // 写真としての仕上げ処理(ビネット/グレイン/色収差/疑似ブルーム/カラーグレーディング)。
  // ライブプレビューには適用せず、撮影結果にのみ1回だけ適用する設計
  // (詳細はjs/postfx.js冒頭のコメント参照)。環境光推定の平均色をティントとして渡し、
  // モデルだけでなく写真全体の色を撮影場所の雰囲気へ寄せる。
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
    // 動画モード：録画中なら停止、していなければ開始する(トグル式)
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
   レンダーループ
   ============================================================ */
let lastTime = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;

  if (gyroEnabled && gyroRefQuat && gyroCurQuat) {
    const targetDelta = gyroCurQuat.clone().multiply(gyroRefQuat.clone().invert());
    // 指数減衰(半減期ベース)でスラープすることでセンサーノイズによる
    // 微小な震えを均し、実際の動きにはきちんと追従させる。
    const halfLife = 0.06;
    const t = 1 - Math.pow(2, -dt / halfLife);
    camera.quaternion.slerp(targetDelta, t);
  }
  if (activeCharacter) activeCharacter.update(dt);
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
    const gyroOK = await requestGyroPermission();
    if (gyroOK) enableGyro();
    const motionOK = await requestMotionPermission();
    if (motionOK) enableMotionTracking();
    await startCamera();
    startScreen.style.display = 'none';
    loadCharacter(CHARACTERS[currentCharacterIndex]);
    environmentLighting.start();
  } catch (err) {
    // エラーメッセージは startCamera 内で表示済み
  }
});
