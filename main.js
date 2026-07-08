import * as THREE from 'three';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { createEnvironmentLighting } from './js/lighting.js';
import { createShadowRig } from './js/shadow-rig.js';
import { applyPhotoFinish } from './js/postfx.js';

/* ============================================================
   キャラクター設定
   ------------------------------------------------------------
   expressions: PMXの表情モーフ(頂点モーフ)の組み合わせプリセット
   poses: ボーンのbind-pose(初期姿勢)からの相対回転(度)で定義する
   ポーズプリセット。値は「たたき台」であり、実機のポーズ調整
   モードで追い込むことを前提にしている。
   ============================================================ */
const CHARACTERS = [
  {
    id: 'kanata',
    name: '天音かなた',
    thumb: '⭐',
    type: 'mmd',
    path: 'assets/kanata/kanata.pmx',
    unitToMeter: 0.081,
    expressions: {
      normal:    { emoji: '😐', label: '通常', weights: {} },
      smile:     { emoji: '😊', label: '笑顔', weights: { 'にこり': 1.0, '笑い': 1.0, '口角上げ': 0.6 } },
      wink:      { emoji: '😉', label: 'ウインク', weights: { 'ウィンク': 1.0, 'にこり': 0.5, '口角上げ': 0.4 } },
      surprised: { emoji: '😲', label: 'びっくり', weights: { 'びっくり': 1.0, '上': 0.6, 'あ': 0.7 } },
      troubled:  { emoji: '😟', label: '困り', weights: { '困る': 1.0, 'じと目': 0.4, 'う': 0.3 } },
    },
    blinkMorph: 'まばたき',
    poses: {
      // 完全な左右対称のTHE・MMDポーズを避け、肩/腰/首にごくわずかな
      // 非対称を入れて「自然な立ち姿」に寄せている(たたき台、要調整)
      standing: {
        label: '直立', emoji: '🧍',
        bones: {
          '下半身': [0, 0, 3],
          '首':    [0, 2, -2],
          '左肩':  [0, 0, 3],
          '右肩':  [0, 0, -2],
        },
      },
      peace: {
        label: 'ピース', emoji: '✌️',
        bones: {
          '右腕':   [0, 0, -60],
          '右ひじ': [-90, 0, 0],
          '右手首': [0, 0, 20],
          '右親指０': [0, 0, -30],
          '右親指１': [0, 0, -30],
          '右親指２': [0, 0, -20],
          '右薬指１': [60, 0, 0],
          '右薬指２': [60, 0, 0],
          '右薬指３': [60, 0, 0],
          '右小指１': [60, 0, 0],
          '右小指２': [60, 0, 0],
          '右小指３': [60, 0, 0],
        },
      },
      wave: {
        label: '手を振る', emoji: '👋',
        bones: {
          '左腕':   [0, 0, 70],
          '左ひじ': [-100, 0, 0],
          '左手首': [0, 0, -10],
        },
        // 手を振るポーズの時だけ、手首をゆっくり左右に振る演出を追加
        wiggle: { bone: '左手首', axis: 'y', amplitude: 15, speedHz: 1.6 },
      },
      hip: {
        label: '腰に手', emoji: '🙆',
        bones: {
          '右腕':   [0, 0, -80],
          '右ひじ': [-110, 0, 0],
          '右手首': [0, 0, 30],
        },
      },
      thinking: {
        label: '考え中', emoji: '🤔',
        bones: {
          '右腕':   [0, 10, -40],
          '右ひじ': [-120, 0, 0],
          '右手首': [0, -20, 10],
          '首':    [5, 5, 0],
        },
      },
      sitting: {
        label: '座る', emoji: '🪑',
        // 脚もbind-pose相対の回転で近似する(実際の椅子への接地判定はしない、
        // 将来のAI環境認識で椅子の高さを検出できたら精緻化する)
        bones: {
          '下半身':  [-85, 0, 0],
          '左足':   [-85, 0, 5],
          '右足':   [-85, 0, -5],
          '左ひざ': [95, 0, 0],
          '右ひざ': [95, 0, 0],
          '左足首': [-10, 0, 0],
          '右足首': [-10, 0, 0],
          '左腕':   [0, 0, -25],
          '右腕':   [0, 0, 25],
          '左ひじ': [-20, 0, 0],
          '右ひじ': [-20, 0, 0],
        },
        // センターボーンの位置(bind基準の相対オフセット、モデル単位)を下げて
        // 座高相当まで沈める。実際の座面の高さには合わせられないので目安。
        centerOffset: { x: 0, y: -6.5, z: 1.0 },
      },
      lookback: {
        label: '振り返り', emoji: '↩️',
        bones: {
          '下半身':  [0, 20, 0],
          '上半身':  [0, 25, 0],
          '上半身2': [0, 15, 0],
          '首':     [0, 15, 3],
          '頭':     [0, 10, 0],
        },
      },
      doublepeace: {
        label: '両手ピース', emoji: '✌️',
        bones: {
          '右腕': [0, 0, -60], '右ひじ': [-90, 0, 0], '右手首': [0, 0, 20],
          '右親指０': [0, 0, -30], '右親指１': [0, 0, -30], '右親指２': [0, 0, -20],
          '右薬指１': [60, 0, 0], '右薬指２': [60, 0, 0], '右薬指３': [60, 0, 0],
          '右小指１': [60, 0, 0], '右小指２': [60, 0, 0], '右小指３': [60, 0, 0],
          '左腕': [0, 0, 60], '左ひじ': [-90, 0, 0], '左手首': [0, 0, -20],
          '左親指０': [0, 0, 30], '左親指１': [0, 0, 30], '左親指２': [0, 0, 20],
          '左薬指１': [60, 0, 0], '左薬指２': [60, 0, 0], '左薬指３': [60, 0, 0],
          '左小指１': [60, 0, 0], '左小指２': [60, 0, 0], '左小指３': [60, 0, 0],
        },
      },
      fingerheart: {
        label: '指ハート', emoji: '🫰',
        bones: {
          '右腕': [10, 20, -70], '右ひじ': [-110, 0, 0], '右手首': [0, -30, 30],
          '右親指０': [0, 0, -40], '右親指１': [0, 0, -50],
          '右人指１': [70, 0, 0], '右人指２': [70, 0, 0],
          '右中指１': [80, 0, 0], '右中指２': [80, 0, 0], '右中指３': [80, 0, 0],
          '右薬指１': [80, 0, 0], '右薬指２': [80, 0, 0], '右薬指３': [80, 0, 0],
          '右小指１': [80, 0, 0], '右小指２': [80, 0, 0], '右小指３': [80, 0, 0],
          '左腕': [10, -20, 70], '左ひじ': [-110, 0, 0], '左手首': [0, 30, -30],
          '左親指０': [0, 0, 40], '左親指１': [0, 0, 50],
          '左人指１': [70, 0, 0], '左人指２': [70, 0, 0],
          '左中指１': [80, 0, 0], '左中指２': [80, 0, 0], '左中指３': [80, 0, 0],
          '左薬指１': [80, 0, 0], '左薬指２': [80, 0, 0], '左薬指３': [80, 0, 0],
          '左小指１': [80, 0, 0], '左小指２': [80, 0, 0], '左小指３': [80, 0, 0],
        },
      },
    },
    // 微細アニメーション：呼吸・重心のゆれ・後れ毛の揺れを常時ゆっくり加える。
    // 「動いている」のではなく「生きている」印象を作るための演出。
    idle: {
      bones: [
        { name: '上半身2', axis: 'x', amplitudeDeg: 0.8, periodSec: 4.5, phase: 0 },   // 呼吸
        { name: '下半身',  axis: 'z', amplitudeDeg: 0.5, periodSec: 7.5, phase: 1.2 }, // 重心ゆれ
        { name: 'hair_front_a',  axis: 'z', amplitudeDeg: 1.0, periodSec: 5.0, phase: 0.3 },
        { name: 'hair_front_b',  axis: 'z', amplitudeDeg: 1.0, periodSec: 4.6, phase: 1.8 },
        { name: 'hair_front_e',  axis: 'z', amplitudeDeg: 1.0, periodSec: 5.4, phase: 2.6 },
        { name: 'hair_front_c_1', axis: 'z', amplitudeDeg: 0.8, periodSec: 4.2, phase: 0.9 },
        { name: 'hair_front_d_1', axis: 'z', amplitudeDeg: 0.8, periodSec: 4.8, phase: 2.1 },
      ],
      expressionJitter: { morphs: ['口角上げ', '上'], amplitude: 0.06, periodSec: 3.0 },
    },
  },
  // 将来的な2D透過素材の例:
  // { id: 'example2d', type: 'sprite', name: '...', path: 'assets/example2d/character.png', heightMeters: 1.6 },
];
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
   キャラクターの抽象化
   ============================================================ */
const _tmpEuler = new THREE.Euler();
const _tmpQuat = new THREE.Quaternion();

class MMDCharacter {
  constructor(mesh, def) {
    this.root = mesh;
    this.unitToMeter = def.unitToMeter;
    this.expressions = def.expressions || {};
    this.blinkMorph = def.blinkMorph || null;
    this.poses = def.poses || {};

    this.exprWeights = {};
    this.exprTargets = {};
    this.setExpression('normal');
    this.blinkState = 'idle';
    this.blinkTimer = 2 + Math.random() * 3;
    this.blinkWeight = 0;

    // ボーンのbind-pose(初期姿勢)を保存し、以後は「そこからの相対回転」でポーズを扱う
    this.bonesByName = {};
    this.bindQuats = {};
    if (mesh.skeleton) {
      mesh.skeleton.bones.forEach((b) => {
        this.bonesByName[b.name] = b;
        this.bindQuats[b.name] = b.quaternion.clone();
      });
    }
    this.allPosableBones = new Set();
    Object.values(this.poses).forEach((p) => {
      Object.keys(p.bones || {}).forEach((n) => this.allPosableBones.add(n));
    });
    this.poseTargets = {};
    this.poseCurrent = {};
    this.activePoseKey = 'standing';
    this._poseElapsed = 0;
    this.wiggle = null;

    // 微細アニメーション(呼吸・重心ゆれ・後れ毛)：常時ゆっくり加算する
    this.idleBones = (def.idle && def.idle.bones) ? def.idle.bones : [];
    this.idleExprJitter = (def.idle && def.idle.expressionJitter) ? def.idle.expressionJitter : null;

    // センターボーンの位置オフセット(座りポーズ等で使用)
    this.bindCenterPos = this.bonesByName['センター'] ? this.bonesByName['センター'].position.clone() : null;
    this.centerOffsetTarget = { x: 0, y: 0, z: 0 };
    this.centerOffsetCurrent = { x: 0, y: 0, z: 0 };

    this.setPose('standing');
  }
  setTransform({ x, y, z, rotY, scale }) {
    this.root.position.set(x, y, z);
    this.root.rotation.y = rotY;
    this.root.scale.setScalar(this.unitToMeter * scale);
  }
  getFootY() {
    const box = new THREE.Box3().setFromObject(this.root);
    // 注記: Box3はbind-pose時の静的なバウンディングボックスを土台の変換行列で
    // 変換しているだけで、ボーンの実際の変形(ポーズ)までは反映しない。
    // センターオフセット(座りポーズ等)による沈み込みだけは既知の量なので、
    // ワールド座標系に換算して補正しておく(脚の曲げ自体までは反映できない簡易対応)。
    const worldShift = (this.centerOffsetCurrent ? this.centerOffsetCurrent.y : 0) * this.root.scale.y;
    return box.min.y + worldShift;
  }
  getWidth() {
    const box = new THREE.Box3().setFromObject(this.root);
    return Math.max(0.4, box.max.x - box.min.x);
  }
  setExpression(key) {
    const preset = this.expressions[key];
    if (!preset) return;
    this.exprTargets = preset.weights;
  }
  /* ---- ポーズ関連 ---- */
  setPose(key) {
    const preset = this.poses[key] || { bones: {} };
    this.activePoseKey = key;
    const bones = preset.bones || {};
    this.allPosableBones.forEach((name) => {
      this.poseTargets[name] = bones[name] ? [...bones[name]] : [0, 0, 0];
    });
    this.wiggle = preset.wiggle ? { ...preset.wiggle, forPose: key } : null;
    this.centerOffsetTarget = preset.centerOffset ? { ...preset.centerOffset } : { x: 0, y: 0, z: 0 };
  }
  // ポーズ調整モードから直接呼ぶ：即座に反映したいのでtargetとcurrentの両方を書き換える
  setBoneDelta(name, xyz) {
    this.poseTargets[name] = [...xyz];
    this.poseCurrent[name] = [...xyz];
  }
  resetPoseToDefault() {
    this.setPose(this.activePoseKey);
    this.allPosableBones.forEach((name) => {
      this.poseCurrent[name] = [...(this.poseTargets[name] || [0, 0, 0])];
    });
  }
  getCurrentPoseBoneNames() {
    const preset = this.poses[this.activePoseKey];
    return preset ? Object.keys(preset.bones || {}) : [];
  }
  update(dt) {
    const dict = this.root.morphTargetDictionary;
    const infl = this.root.morphTargetInfluences;
    if (dict && infl) {
      const allNames = new Set([...Object.keys(this.exprWeights), ...Object.keys(this.exprTargets)]);
      const LERP_SPEED = 8;
      for (const name of allNames) {
        const cur = this.exprWeights[name] || 0;
        const target = this.exprTargets[name] || 0;
        const next = cur + (target - cur) * Math.min(1, dt * LERP_SPEED);
        this.exprWeights[name] = next;
        const idx = dict[name];
        if (idx !== undefined) infl[idx] = next;
      }
      if (this.blinkMorph && dict[this.blinkMorph] !== undefined) {
        this.blinkTimer -= dt;
        if (this.blinkState === 'idle' && this.blinkTimer <= 0) this.blinkState = 'closing';
        const CLOSE_SPEED = 14, OPEN_SPEED = 10;
        if (this.blinkState === 'closing') {
          this.blinkWeight = Math.min(1, this.blinkWeight + dt * CLOSE_SPEED);
          if (this.blinkWeight >= 1) this.blinkState = 'opening';
        } else if (this.blinkState === 'opening') {
          this.blinkWeight = Math.max(0, this.blinkWeight - dt * OPEN_SPEED);
          if (this.blinkWeight <= 0) { this.blinkState = 'idle'; this.blinkTimer = 2.2 + Math.random() * 3.5; }
        }
        const idx = dict[this.blinkMorph];
        const base = this.exprWeights[this.blinkMorph] || 0;
        infl[idx] = Math.max(base, this.blinkWeight);
      }
      // 表情の微細ランダム変動：「生きている」印象のためのごく小さな揺らぎ
      if (this.idleExprJitter) {
        const { morphs, amplitude, periodSec } = this.idleExprJitter;
        morphs.forEach((name, i) => {
          const idx = dict[name];
          if (idx === undefined) return;
          const j = Math.sin(this._poseElapsed * (Math.PI * 2 / periodSec) + i * 2.1) * amplitude;
          infl[idx] = THREE.MathUtils.clamp((infl[idx] || 0) + j, 0, 1);
        });
      }
    }

    // ポーズ(ボーン回転)の補間適用
    this._poseElapsed += dt;
    const POSE_LERP = 10;
    this.allPosableBones.forEach((name) => {
      const bone = this.bonesByName[name];
      const bind = this.bindQuats[name];
      if (!bone || !bind) return;
      const target = this.poseTargets[name] || [0, 0, 0];
      const cur = this.poseCurrent[name] || (this.poseCurrent[name] = [0, 0, 0]);
      for (let i = 0; i < 3; i++) cur[i] += (target[i] - cur[i]) * Math.min(1, dt * POSE_LERP);

      let ex = cur[0], ey = cur[1], ez = cur[2];
      if (this.wiggle && this.wiggle.bone === name && this.activePoseKey === this.wiggle.forPose) {
        const w = Math.sin(this._poseElapsed * Math.PI * 2 * this.wiggle.speedHz) * this.wiggle.amplitude;
        if (this.wiggle.axis === 'x') ex += w;
        else if (this.wiggle.axis === 'y') ey += w;
        else ez += w;
      }
      _tmpEuler.set(
        THREE.MathUtils.degToRad(ex),
        THREE.MathUtils.degToRad(ey),
        THREE.MathUtils.degToRad(ez),
        'XYZ'
      );
      _tmpQuat.setFromEuler(_tmpEuler);
      bone.quaternion.copy(bind).multiply(_tmpQuat);
    });

    // 微細アニメーション：呼吸・重心ゆれ・後れ毛(ポーズ非依存で常時適用)
    this.idleBones.forEach((idle) => {
      const bone = this.bonesByName[idle.name];
      const bind = this.bindQuats[idle.name];
      if (!bone || !bind) return;
      const angle = Math.sin(this._poseElapsed * (Math.PI * 2 / idle.periodSec) + (idle.phase || 0)) * idle.amplitudeDeg;
      const e = { x: 0, y: 0, z: 0 };
      e[idle.axis] = angle;
      _tmpEuler.set(
        THREE.MathUtils.degToRad(e.x),
        THREE.MathUtils.degToRad(e.y),
        THREE.MathUtils.degToRad(e.z),
        'XYZ'
      );
      _tmpQuat.setFromEuler(_tmpEuler);
      bone.quaternion.copy(bind).multiply(_tmpQuat);
    });

    // センターボーンの位置オフセット(座りポーズ等、モデル単位での相対移動)
    if (this.bindCenterPos) {
      const centerBone = this.bonesByName['センター'];
      const CENTER_LERP = 6;
      ['x', 'y', 'z'].forEach((axis) => {
        this.centerOffsetCurrent[axis] += (this.centerOffsetTarget[axis] - this.centerOffsetCurrent[axis]) * Math.min(1, dt * CENTER_LERP);
      });
      centerBone.position.set(
        this.bindCenterPos.x + this.centerOffsetCurrent.x,
        this.bindCenterPos.y + this.centerOffsetCurrent.y,
        this.bindCenterPos.z + this.centerOffsetCurrent.z
      );
    }
  }
}

class SpriteCharacter {
  constructor(sprite, def) {
    this.root = sprite;
    this.heightMeters = def.heightMeters;
    this.aspect = def.aspect;
    sprite.center.set(0.5, 0);
  }
  setTransform({ x, y, z, rotY, scale }) {
    this.root.position.set(x, y, z);
    this.root.material.rotation = rotY;
    const h = this.heightMeters * scale;
    this.root.scale.set(h * this.aspect, h, 1);
  }
  getFootY() { return this.root.position.y; }
  getWidth() { return this.root.scale.x; }
  setExpression() {}
  setPose() {}
  getCurrentPoseBoneNames() { return []; }
  update() {}
}

let activeCharacter = null;

/* ============================================================
   材質の調整（MMDらしさを抑える：輪郭線を細く・トゥーンの段差を滑らかに）
   ============================================================ */
function softenMaterials(mesh) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mats.forEach((mat) => {
    if (!mat) return;
    if (mat.userData && mat.userData.outlineParameters) {
      const op = mat.userData.outlineParameters;
      op.thickness = (op.thickness || 0.003) * 0.4;
      op.alpha = 0.55;
      // 輪郭線を純粋な黒ではなく、材質自身の色を暗くしたトーンにする
      // (黒線そのものがMMDらしさの大きな要因になっているため)
      if (mat.color) {
        op.color = [mat.color.r * 0.35, mat.color.g * 0.3, mat.color.b * 0.35];
      }
    }
    if (mat.gradientMap) {
      mat.gradientMap.magFilter = THREE.LinearFilter;
      mat.gradientMap.minFilter = THREE.LinearFilter;
      mat.gradientMap.needsUpdate = true;
    }
  });
}

function loadCharacter(def) {
  if (def.type === 'mmd') {
    const loader = new MMDLoader();
    loader.load(
      def.path,
      (mesh) => {
        scene.add(mesh);
        softenMaterials(mesh);
        activeCharacter = new MMDCharacter(mesh, def);
        applyPlacement();
        buildExpressionBar(def);
        buildPoseBar(def);
        loadingOverlay.classList.add('hide');
      },
      (xhr) => {
        if (xhr.lengthComputable) {
          const pct = Math.round((xhr.loaded / xhr.total) * 100);
          loadingText.textContent = `推しを読み込み中… ${pct}%`;
        }
      },
      (err) => {
        console.error('MMD load error', err);
        loadingText.textContent = 'モデルの読み込みに失敗しました。ファイル配置を確認してください。';
      }
    );
  } else if (def.type === 'sprite') {
    const texLoader = new THREE.TextureLoader();
    texLoader.load(def.path, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const aspect = tex.image.width / tex.image.height;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
      const sprite = new THREE.Sprite(mat);
      scene.add(sprite);
      activeCharacter = new SpriteCharacter(sprite, { ...def, aspect });
      applyPlacement();
      expressionBar.innerHTML = '';
      poseBar.innerHTML = '';
      loadingOverlay.classList.add('hide');
    });
  }
}

/* ============================================================
   表情ボタン
   ============================================================ */
function buildExpressionBar(def) {
  expressionBar.innerHTML = '';
  if (!def.expressions) return;
  const buttons = {};
  Object.entries(def.expressions).forEach(([key, preset]) => {
    const btn = document.createElement('button');
    btn.className = 'expr-btn' + (key === 'normal' ? ' active' : '');
    btn.textContent = preset.emoji;
    btn.title = preset.label;
    btn.addEventListener('click', () => {
      activeCharacter.setExpression(key);
      Object.values(buttons).forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      showPoseToast(`表情: ${preset.label}`);
    });
    buttons[key] = btn;
    expressionBar.appendChild(btn);
  });
}

/* ============================================================
   ポーズボタン
   ============================================================ */
function buildPoseBar(def) {
  poseBar.innerHTML = '';
  if (!def.poses) return;
  const buttons = {};
  Object.entries(def.poses).forEach(([key, preset]) => {
    const btn = document.createElement('button');
    btn.className = 'pose-btn' + (key === 'standing' ? ' active' : '');
    btn.textContent = preset.emoji;
    btn.title = preset.label;
    btn.addEventListener('click', () => {
      activeCharacter.setPose(key);
      Object.values(buttons).forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      if (posePanel.classList.contains('show')) refreshTunePanel();
      showPoseToast(`ポーズ: ${preset.label}`);
    });
    buttons[key] = btn;
    poseBar.appendChild(btn);
  });
}

/* ============================================================
   ポーズ調整パネル
   ============================================================ */
function refreshTunePanel() {
  if (!activeCharacter) return;
  const names = activeCharacter.getCurrentPoseBoneNames();
  tuneBoneSelect.innerHTML = '';
  if (names.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = '(このポーズには調整可能なボーンがありません)';
    tuneBoneSelect.appendChild(opt);
    tuneX.disabled = tuneY.disabled = tuneZ.disabled = true;
    return;
  }
  tuneX.disabled = tuneY.disabled = tuneZ.disabled = false;
  names.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    tuneBoneSelect.appendChild(opt);
  });
  loadBoneSliders(names[0]);
}

function loadBoneSliders(name) {
  if (!activeCharacter) return;
  const v = activeCharacter.poseTargets[name] || [0, 0, 0];
  tuneX.value = v[0]; tuneY.value = v[1]; tuneZ.value = v[2];
  tuneXVal.textContent = Math.round(v[0]);
  tuneYVal.textContent = Math.round(v[1]);
  tuneZVal.textContent = Math.round(v[2]);
}

function currentTuneBoneName() {
  return tuneBoneSelect.value;
}

function onSliderInput() {
  if (!activeCharacter) return;
  const name = currentTuneBoneName();
  if (!name) return;
  const xyz = [Number(tuneX.value), Number(tuneY.value), Number(tuneZ.value)];
  activeCharacter.setBoneDelta(name, xyz);
  tuneXVal.textContent = Math.round(xyz[0]);
  tuneYVal.textContent = Math.round(xyz[1]);
  tuneZVal.textContent = Math.round(xyz[2]);
}
tuneX.addEventListener('input', onSliderInput);
tuneY.addEventListener('input', onSliderInput);
tuneZ.addEventListener('input', onSliderInput);
tuneBoneSelect.addEventListener('change', () => loadBoneSliders(currentTuneBoneName()));

tuneBtn.addEventListener('click', () => {
  posePanel.classList.toggle('show');
  tuneBtn.classList.toggle('active');
  if (posePanel.classList.contains('show')) refreshTunePanel();
});
posePanelClose.addEventListener('click', () => {
  posePanel.classList.remove('show');
  tuneBtn.classList.remove('active');
});
tuneResetBtn.addEventListener('click', () => {
  if (!activeCharacter) return;
  activeCharacter.resetPoseToDefault();
  loadBoneSliders(currentTuneBoneName());
  posePanelHint.textContent = '初期値に戻しました';
  setTimeout(() => { posePanelHint.textContent = ''; }, 1500);
});
tuneCopyBtn.addEventListener('click', async () => {
  if (!activeCharacter) return;
  const names = activeCharacter.getCurrentPoseBoneNames();
  const obj = {};
  names.forEach((n) => {
    const v = activeCharacter.poseTargets[n] || [0, 0, 0];
    obj[n] = v.map((x) => Math.round(x * 10) / 10);
  });
  const json = JSON.stringify(obj, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    posePanelHint.textContent = 'コピーしました。Claudeに貼り付けて送ってください';
  } catch (e) {
    window.prompt('コピーしてClaudeに送ってください:', json);
  }
});

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
let lastBlob = null;
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
