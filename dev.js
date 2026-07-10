import * as THREE from 'three';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CHARACTERS } from './js/characters-data.js';
import { loadCharacter as loadCharacterCore } from './js/character.js';
import { buildExpressionBar, buildPoseBar, createPoseTuner } from './js/pose-ui.js';

/* ============================================================
   DOM
   ============================================================ */
const canvas = document.getElementById('three-canvas');
const viewport = document.getElementById('dev-viewport');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const poseBar = document.getElementById('pose-bar');
const expressionBar = document.getElementById('expression-bar');
const posePanelHint = document.getElementById('pose-panel-hint');
const tuneBoneSelect = document.getElementById('tune-bone-select');
const tuneX = document.getElementById('tune-x');
const tuneY = document.getElementById('tune-y');
const tuneZ = document.getElementById('tune-z');
const tuneXVal = document.getElementById('tune-x-val');
const tuneYVal = document.getElementById('tune-y-val');
const tuneZVal = document.getElementById('tune-z-val');
const tuneResetBtn = document.getElementById('tune-reset-btn');
const tuneCopyBtn = document.getElementById('tune-copy-btn');
const resetViewBtn = document.getElementById('dev-reset-view-btn');
const gridBtn = document.getElementById('dev-grid-btn');
const bgInput = document.getElementById('dev-bg-input');
const bgClearBtn = document.getElementById('dev-bg-clear-btn');
const bgImageDiv = document.getElementById('dev-bg-image');
const screenshotBtn = document.getElementById('dev-screenshot-btn');
const poseToast = document.getElementById('pose-toast');
const debugLog = document.getElementById('dev-debug-log');

// ローディング画面を隠す処理を一箇所に集約。CSSの`.hide`が
// opacity遷移のみでpointer-eventsを外し忘れていても、ここで
// 明示的に無効化することで「見えない壁」化を防ぐ（マウス操作が
// 効かなくなる不具合の典型原因）。
function hideLoadingOverlay() {
  loadingOverlay.classList.add('hide');
  loadingOverlay.style.pointerEvents = 'none';
}

let poseToastTimer = null;
function showPoseToast(text) {
  poseToast.textContent = text;
  poseToast.classList.add('show');
  clearTimeout(poseToastTimer);
  poseToastTimer = setTimeout(() => poseToast.classList.remove('show'), 1200);
}

/* ============================================================
   画面上デバッグログ
   ------------------------------------------------------------
   F12を開かなくてもエラーがその場で分かるように、画面左下へ
   直接エラー内容を表示する(開発者モード専用の簡易ツール)。
   ============================================================ */
function logDebug(msg) {
  debugLog.classList.add('show');
  const line = document.createElement('div');
  line.textContent = msg;
  debugLog.appendChild(line);
  console.error(msg);
}
window.addEventListener('error', (e) => {
  logDebug(`[error] ${e.message} (${e.filename}:${e.lineno})`);
});
window.addEventListener('unhandledrejection', (e) => {
  logDebug(`[unhandledrejection] ${e.reason}`);
});

/* ============================================================
   three.js セットアップ（カメラ映像なし、疑似スタジオ環境）
   ============================================================ */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const effect = new OutlineEffect(renderer, { defaultThickness: 0.0015, defaultColor: [0.05, 0.04, 0.05], defaultAlpha: 0.6 });

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);

const DEFAULT_CAM_POS = new THREE.Vector3(1.6, 1.3, 2.6);
const DEFAULT_TARGET = new THREE.Vector3(0, 0.9, 0);
camera.position.copy(DEFAULT_CAM_POS);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(DEFAULT_TARGET);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.update();

/* ------------------------------------------------------------
   ドラッグ操作が奪われないようにするための保険（CSS側の実装に
   依存せず、JSで確実に効かせる）。
   ------------------------------------------------------------
   ・canvas自体: touch-action/user-selectを明示し、必ずマウス操作を
     受け取れるようにする（ADR-003と同じ理由）。
   ・canvas以外の全画面/大きめのオーバーレイ要素(ローディング画面・
     背景参照画像・デバッグログ・トースト)は、非表示時にopacityだけ
     下げてpointer-eventsが残っていると「見えない壁」になり、
     OrbitControlsへドラッグが一切届かなくなる。今回の症状
     （pointerdownログが一度も出ない）はこれが濃厚な原因のため、
     JS側で明示的にpointer-eventsを制御する。
   ------------------------------------------------------------ */
canvas.style.touchAction = 'none';
canvas.style.userSelect = 'none';

function setInert(el, inert) {
  if (!el) return;
  el.style.pointerEvents = inert ? 'none' : '';
}
// 背景参照画像・デバッグログ・トーストはクリックを受け取る必要が
// 一切ないUIなので、常にマウスイベントを素通しする
setInert(bgImageDiv, true);
setInert(debugLog, true);
setInert(poseToast, true);

// スマホ版と近い見た目になるよう、同程度のライト構成を静的に設定
// (開発者モードにはカメラ映像が無いため環境光推定は行わない)
const hemi = new THREE.HemisphereLight(0xffffff, 0x2a2a33, 0.5);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xfff2d8, 0.9);
dir.position.set(1.2, 2.4, 1.6);
scene.add(dir);
const rim = new THREE.DirectionalLight(0xcfe8ff, 0.35);
rim.position.set(-1.5, 1.8, -2.0);
scene.add(rim);

const grid = new THREE.GridHelper(6, 24, 0x556, 0x334);
grid.position.y = 0;
scene.add(grid);
let gridVisible = true;
gridBtn.addEventListener('click', () => {
  gridVisible = !gridVisible;
  grid.visible = gridVisible;
  gridBtn.textContent = `床グリッド: ${gridVisible ? 'ON' : 'OFF'}`;
});

function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  logDebug(`[info] viewportサイズ: ${w} x ${h} / canvasサイズ: ${canvas.clientWidth} x ${canvas.clientHeight}`);
}
window.addEventListener('resize', resize);
resize();
logDebug('[info] OrbitControls初期化完了。domElement=' + (renderer.domElement === canvas ? 'canvasと一致' : '不一致(要確認)'));
canvas.addEventListener('pointerdown', () => logDebug('[info] canvasでpointerdownを検知しました'));

resetViewBtn.addEventListener('click', () => {
  camera.position.copy(DEFAULT_CAM_POS);
  controls.target.copy(DEFAULT_TARGET);
  controls.update();
});

/* ============================================================
   背景参照画像（実際に撮った写真を背景に置いて、見比べながら調整できる）
   ============================================================ */
bgInput.addEventListener('change', () => {
  const file = bgInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    bgImageDiv.style.backgroundImage = `url('${reader.result}')`;
    bgImageDiv.classList.add('show');
  };
  reader.readAsDataURL(file);
});
bgClearBtn.addEventListener('click', () => {
  bgImageDiv.style.backgroundImage = '';
  bgImageDiv.classList.remove('show');
});

/* ============================================================
   スクリーンショット保存
   ============================================================ */
screenshotBtn.addEventListener('click', () => {
  effect.render(scene, camera);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `oshi-camera-dev-${Date.now()}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, 'image/png');
});

/* ============================================================
   キャラクター読み込み
   ============================================================ */
let activeCharacter = null;
const def = CHARACTERS[0];

logDebug('[info] 初期化開始。OrbitControlsとシーンを構築します。');

// 万一モデル読み込みが失敗/停止しても、ローディング画面がcanvas全体を
// 覆ったままマウス操作を永久にブロックしないよう、一定時間で強制的に隠す。
const LOAD_TIMEOUT_MS = 15000;
const loadTimeoutId = setTimeout(() => {
  if (!loadingOverlay.classList.contains('hide')) {
    logDebug('[warn] モデル読み込みが15秒以内に完了しませんでした。読み込み画面を強制的に閉じます。');
    hideLoadingOverlay();
  }
}, LOAD_TIMEOUT_MS);

loadCharacterCore(def, { MMDLoader, scene }, {
  onLoad: (character) => {
    clearTimeout(loadTimeoutId);
    activeCharacter = character;
    character.setTransform({ x: 0, y: 0, z: 0, rotY: 0, scale: 1 });
    buildExpressionBar(expressionBar, def, () => activeCharacter, (label) => showPoseToast(`表情: ${label}`));
    buildPoseBar(poseBar, def, () => activeCharacter, (label) => {
      poseTuner.refresh();
      showPoseToast(`ポーズ: ${label}`);
    });
    poseTuner.refresh();
    hideLoadingOverlay();
    logDebug('[info] モデル読み込み完了。マウスでドラッグ/ホイールでの操作を試してください。');
  },
  onProgress: (xhr) => {
    if (xhr.lengthComputable) {
      const pct = Math.round((xhr.loaded / xhr.total) * 100);
      loadingText.textContent = `推しを読み込み中… ${pct}%`;
    }
  },
  onError: (err) => {
    clearTimeout(loadTimeoutId);
    console.error('MMD load error', err);
    loadingText.textContent = 'モデルの読み込みに失敗しました。ローカルサーバー経由で開いているか確認してください。';
    logDebug(`[error] モデル読み込み失敗: ${err && err.message ? err.message : err}`);
    // 読み込みに失敗してもマウス操作(視点確認)自体はできるようにしておく
    hideLoadingOverlay();
  },
});

const poseTuner = createPoseTuner({
  select: tuneBoneSelect,
  xSlider: tuneX, ySlider: tuneY, zSlider: tuneZ,
  xVal: tuneXVal, yVal: tuneYVal, zVal: tuneZVal,
  hint: posePanelHint,
}, () => activeCharacter);

tuneResetBtn.addEventListener('click', () => poseTuner.resetToDefault());
tuneCopyBtn.addEventListener('click', () => poseTuner.copyJSON());

/* ============================================================
   レンダーループ
   ============================================================ */
let lastTime = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;

  controls.update();
  if (activeCharacter) activeCharacter.update(dt);
  effect.render(scene, camera);
}
animate();
