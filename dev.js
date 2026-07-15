import * as THREE from 'three';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CHARACTERS } from './js/characters-data.js';
import { loadCharacter as loadCharacterCore, disposeCharacter } from './js/character.js';
import { buildExpressionBar, buildPoseBar, createPoseTuner } from './js/pose-ui.js';
import { DevEnvironment, buildEnvironmentPanel } from './js/dev-environment.js';

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
const envPanel = document.getElementById('dev-env-panel');
const characterSelect = document.getElementById('dev-character-select');

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
   エラーログ（コンソールのみ。画面表示はしない）
   ============================================================ */
window.addEventListener('error', (e) => {
  console.error(`[error] ${e.message} (${e.filename}:${e.lineno})`);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error(`[unhandledrejection] ${e.reason}`);
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
// style.css(本体アプリと共有)側でcanvasに pointer-events:none が
// かかっている可能性が高い(診断ログで#dev-viewportがクリックを
// 拾っていたことから判明。本体アプリではcanvasは見た目だけの層で、
// 実際のドラッグ操作は別のジェスチャー用オーバーレイが受け持つ設計と
// 推測される)。dev.htmlにはそのオーバーレイが無くOrbitControlsが
// canvasに直接ぶら下がっているため、インラインstyleで明示的に
// 上書きしてクリックを拾えるようにする。
canvas.style.pointerEvents = 'auto';

function setInert(el, inert) {
  if (!el) return;
  el.style.pointerEvents = inert ? 'none' : '';
}
// 背景参照画像・トーストはクリックを受け取る必要が
// 一切ないUIなので、常にマウスイベントを素通しする
setInert(bgImageDiv, true);
setInert(poseToast, true);

/* ------------------------------------------------------------
   ライト構成
   ------------------------------------------------------------
   hemi(環境光)・dir(太陽=DevEnvironmentが位置/色/強度を計算して
   毎回上書きする)・rim(縁光、環境シミュレーションの対象外・常時固定)
   の3灯構成。以前はここで固定値を設定していたが、太陽の役割は
   DevEnvironment.update()に一本化した(このファイル内で個別に
   hemi.intensity等をいじると環境シミュレーションと競合するため、
   以後は触らないこと)。
   ------------------------------------------------------------ */
const hemi = new THREE.HemisphereLight(0xffffff, 0x2a2a33, 0.4);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xfff2d8, 0.9);
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

/* ============================================================
   環境シミュレーション（場所・季節・時刻・色調グレーディング）
   ============================================================ */
const devEnvironment = new DevEnvironment({ scene, sunLight: dir, hemiLight: hemi });
buildEnvironmentPanel(envPanel, devEnvironment, canvas);

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
   ------------------------------------------------------------
   注意: 環境シミュレーション(scene.background)と併用すると、
   このdiv自体はcanvasの背面/前面のどちらに置かれているか
   dev.css依存のため、状況によってはどちらかが隠れる可能性がある。
   写真と環境シミュレーションは基本的に「どちらか一方を使う」運用を
   想定している。
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
   キャラクター読み込み・切替
   ------------------------------------------------------------
   以前はCHARACTERS[0](かなた)を固定で読み込むだけで、dev.htmlには
   「別のキャラクターを選ぶ手段」自体が存在しなかった(音乃瀬奏が
   表示されない不具合の実体はこれだった)。ここでは:
     1. ヘッダーのセレクトボックスからキャラクターを選べるようにする
     2. 切替時は古いキャラクターをdisposeCharacter()でシーンから
        除去・GPUリソース解放してから新しいキャラクターを読み込む
     3. 連打などで読み込みが重複した場合に古い方の結果を誤って
        適用しないよう、世代カウンタ(loadGeneration)で防止する
   ============================================================ */
let activeCharacter = null;
let loadGeneration = 0;

// 万一モデル読み込みが失敗/停止しても、ローディング画面がcanvas全体を
// 覆ったままマウス操作を永久にブロックしないよう、一定時間で強制的に隠す。
const LOAD_TIMEOUT_MS = 15000;
let loadTimeoutId = null;

function loadAndActivateCharacter(def) {
  const myGeneration = ++loadGeneration;

  loadingOverlay.classList.remove('hide');
  loadingOverlay.style.pointerEvents = '';
  loadingText.textContent = '推しを読み込み中…';

  clearTimeout(loadTimeoutId);
  loadTimeoutId = setTimeout(() => {
    if (myGeneration === loadGeneration && !loadingOverlay.classList.contains('hide')) {
      console.warn('モデル読み込みが15秒以内に完了しませんでした。読み込み画面を強制的に閉じます。');
      hideLoadingOverlay();
    }
  }, LOAD_TIMEOUT_MS);

  loadCharacterCore(def, { MMDLoader, scene }, {
    onLoad: (character) => {
      // 選択が短時間で連続して変わった場合、後から返ってきた古い読み込み結果は
      // 画面に反映せず、シーンに追加もされていないので単に無視すればよい
      // (character.jsのloadCharacterはscene.addを内部で行うため、こちらでは
      //  disposeCharacterで確実に除去してから破棄する)。
      if (myGeneration !== loadGeneration) {
        disposeCharacter(character, scene);
        return;
      }
      clearTimeout(loadTimeoutId);
      if (activeCharacter) disposeCharacter(activeCharacter, scene);
      activeCharacter = character;
      character.setTransform({ x: 0, y: 0, z: 0, rotY: 0, scale: 1 });
      buildExpressionBar(expressionBar, def, () => activeCharacter, (label) => showPoseToast(`表情: ${label}`));
      buildPoseBar(poseBar, def, () => activeCharacter, (label) => {
        poseTuner.refresh();
        showPoseToast(`ポーズ: ${label}`);
      });
      poseTuner.refresh();
      hideLoadingOverlay();
    },
    onProgress: (xhr) => {
      if (myGeneration !== loadGeneration) return;
      if (xhr.lengthComputable) {
        const pct = Math.round((xhr.loaded / xhr.total) * 100);
        loadingText.textContent = `推しを読み込み中… ${pct}%`;
      }
    },
    onError: (err) => {
      if (myGeneration !== loadGeneration) return;
      clearTimeout(loadTimeoutId);
      console.error('MMD load error', err);
      loadingText.textContent = 'モデルの読み込みに失敗しました。ローカルサーバー経由で開いているか確認してください。';
      // 読み込みに失敗してもマウス操作(視点確認)自体はできるようにしておく
      hideLoadingOverlay();
    },
  });
}

CHARACTERS.forEach((c) => {
  const opt = document.createElement('option');
  opt.value = c.id;
  opt.textContent = `${c.thumb || ''} ${c.name}`.trim();
  characterSelect.appendChild(opt);
});
characterSelect.value = CHARACTERS[0].id;
characterSelect.addEventListener('change', () => {
  const def = CHARACTERS.find((c) => c.id === characterSelect.value);
  if (def) loadAndActivateCharacter(def);
});

loadAndActivateCharacter(CHARACTERS[0]);

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
