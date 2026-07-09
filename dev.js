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

let poseToastTimer = null;
function showPoseToast(text) {
  poseToast.textContent = text;
  poseToast.classList.add('show');
  clearTimeout(poseToastTimer);
  poseToastTimer = setTimeout(() => poseToast.classList.remove('show'), 1200);
}

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
}
window.addEventListener('resize', resize);
resize();

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

loadCharacterCore(def, { MMDLoader, scene }, {
  onLoad: (character) => {
    activeCharacter = character;
    character.setTransform({ x: 0, y: 0, z: 0, rotY: 0, scale: 1 });
    buildExpressionBar(expressionBar, def, () => activeCharacter, (label) => showPoseToast(`表情: ${label}`));
    buildPoseBar(poseBar, def, () => activeCharacter, (label) => {
      poseTuner.refresh();
      showPoseToast(`ポーズ: ${label}`);
    });
    poseTuner.refresh();
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
    loadingText.textContent = 'モデルの読み込みに失敗しました。ローカルサーバー経由で開いているか確認してください。';
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
