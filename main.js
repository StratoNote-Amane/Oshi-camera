import * as THREE from 'three';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';

/* ============================================================
   設定
   ------------------------------------------------------------
   MODEL_PATH: 読み込むPMXのパス。2人目を追加する時はここに
   配列を増やして選択できるようにする（現段階は1人固定）。
   MMD_UNIT_TO_METER: MMDモデルは慣習的に「1ユニット≒8cm」で
   作られていることが多いため、実寸に近づけるための基準値。
   実機で大きさが合わなければこの値かピンチ操作で調整する。
   ============================================================ */
const MODEL_PATH = 'assets/kanata/kanata.pmx';
const MMD_UNIT_TO_METER = 0.081;

/* ============================================================
   DOM
   ============================================================ */
const startScreen   = document.getElementById('start-screen');
const startBtn      = document.getElementById('start-btn');
const startError    = document.getElementById('start-error');
const stageWrap     = document.getElementById('stage-wrap');
const stage         = document.getElementById('stage');
const video         = document.getElementById('camera-video');
const canvas        = document.getElementById('three-canvas');
const uiLayer       = document.getElementById('ui-layer');
const switchCamBtn  = document.getElementById('switch-cam-btn');
const resetBtn      = document.getElementById('reset-btn');
const shutterBtn    = document.getElementById('shutter-btn');
const resultScreen  = document.getElementById('result-screen');
const resultImg     = document.getElementById('result-img');
const retakeBtn     = document.getElementById('retake-btn');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText   = document.getElementById('loading-text');

/* ============================================================
   状態
   ============================================================ */
const placement = {
  x: 0, y: -1.1, z: -3.2,   // モデルのワールド座標（初期位置は少し下・奥）
  rotY: 0,
  scale: 1,
};
const DEFAULT_PLACEMENT = { ...placement };

let facingMode = 'environment'; // 'environment' = 背面, 'user' = 前面
let currentStream = null;
let mmdMesh = null;
let shadowMesh = null;

/* ============================================================
   three.js セットアップ
   ============================================================ */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
camera.position.set(0, 0, 0);

// ライト：MMDのトゥーン素材が破綻しない程度のシンプルな2灯構成
const hemi = new THREE.HemisphereLight(0xffffff, 0x2a2a33, 1.15);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xfff2d8, 0.9);
dir.position.set(1.2, 2.4, 1.6);
scene.add(dir);

/* 接地感を出すための足元の柔らかい影（円形グラデーションテクスチャ） */
function makeShadowTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.7, 'rgba(0,0,0,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
function addShadow() {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({
    map: makeShadowTexture(),
    transparent: true,
    depthWrite: false,
  });
  shadowMesh = new THREE.Mesh(geo, mat);
  shadowMesh.rotation.x = -Math.PI / 2;
  scene.add(shadowMesh);
}
addShadow();

/* ============================================================
   MMD読み込み
   ============================================================ */
function loadModel() {
  const loader = new MMDLoader();
  loader.load(
    MODEL_PATH,
    (mesh) => {
      mmdMesh = mesh;
      mesh.scale.setScalar(MMD_UNIT_TO_METER);
      scene.add(mesh);
      applyPlacement();
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
}

/* ============================================================
   配置の反映
   ============================================================ */
function applyPlacement() {
  if (!mmdMesh) return;
  mmdMesh.position.set(placement.x, placement.y, placement.z);
  mmdMesh.rotation.y = placement.rotY;
  mmdMesh.scale.setScalar(MMD_UNIT_TO_METER * placement.scale);

  if (shadowMesh) {
    // モデルの足元（バウンディングボックス最下部）に影を置く
    const box = new THREE.Box3().setFromObject(mmdMesh);
    const footY = box.min.y;
    const width = Math.max(0.4, (box.max.x - box.min.x) * 1.2);
    shadowMesh.position.set(placement.x, footY + 0.002, placement.z);
    shadowMesh.scale.set(width, width * 0.6, 1);
  }
}

/* ============================================================
   カメラ映像の開始／切替
   ============================================================ */
async function startCamera() {
  stopCamera();
  try {
    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
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
  if (currentStream) {
    currentStream.getTracks().forEach((t) => t.stop());
    currentStream = null;
  }
}

function onVideoMeta() {
  const vw = video.videoWidth || 1080;
  const vh = video.videoHeight || 1920;
  sizeStageToVideo(vw, vh);
}

/* ============================================================
   ステージのサイズ調整
   ------------------------------------------------------------
   video のネイティブ解像度に aspect-ratio を合わせることで、
   プレビューで見えている construction と撮影結果の見え方を
   一致させる（撮影時のズレを防ぐ）。
   ============================================================ */
function sizeStageToVideo(vw, vh) {
  const aspect = vw / vh;
  const wrapRect = stageWrap.getBoundingClientRect();
  let w = wrapRect.width;
  let h = w / aspect;
  if (h > wrapRect.height) {
    h = wrapRect.height;
    w = h * aspect;
  }
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

/* ============================================================
   ジェスチャー操作（1本指:移動 / 2本指:拡縮・回転）
   ============================================================ */
const touchState = {
  mode: null, // 'drag' | 'gesture'
  lastX: 0, lastY: 0,
  startDist: 0,
  startAngle: 0,
  startScale: 1,
  startRotY: 0,
};

function touchDist(t0, t1) {
  return Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
}
function touchAngle(t0, t1) {
  return Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX);
}

stage.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1) {
    touchState.mode = 'drag';
    touchState.lastX = e.touches[0].clientX;
    touchState.lastY = e.touches[0].clientY;
  } else if (e.touches.length >= 2) {
    touchState.mode = 'gesture';
    touchState.startDist = touchDist(e.touches[0], e.touches[1]);
    touchState.startAngle = touchAngle(e.touches[0], e.touches[1]);
    touchState.startScale = placement.scale;
    touchState.startRotY = placement.rotY;
  }
}, { passive: true });

stage.addEventListener('touchmove', (e) => {
  if (touchState.mode === 'drag' && e.touches.length === 1) {
    const t = e.touches[0];
    const dx = t.clientX - touchState.lastX;
    const dy = t.clientY - touchState.lastY;
    touchState.lastX = t.clientX;
    touchState.lastY = t.clientY;

    // 画面ピクセル差分をカメラのFOVに基づいてワールド座標の差分に変換
    const rect = stage.getBoundingClientRect();
    const distance = Math.abs(placement.z - camera.position.z);
    const vFovRad = THREE.MathUtils.degToRad(camera.fov);
    const worldPerPixelY = (2 * Math.tan(vFovRad / 2) * distance) / rect.height;
    const worldPerPixelX = worldPerPixelY; // 正方ピクセルを仮定

    placement.x += dx * worldPerPixelX;
    placement.y -= dy * worldPerPixelY;
    applyPlacement();
  } else if (touchState.mode === 'gesture' && e.touches.length >= 2) {
    const dist = touchDist(e.touches[0], e.touches[1]);
    const angle = touchAngle(e.touches[0], e.touches[1]);
    const scaleRatio = dist / (touchState.startDist || dist);
    const angleDelta = angle - touchState.startAngle;

    placement.scale = THREE.MathUtils.clamp(touchState.startScale * scaleRatio, 0.2, 5);
    placement.rotY = touchState.startRotY - angleDelta;
    applyPlacement();
  }
}, { passive: true });

stage.addEventListener('touchend', (e) => {
  if (e.touches.length === 0) {
    touchState.mode = null;
  } else if (e.touches.length === 1) {
    // 2本指→1本指に減った場合はドラッグへ復帰
    touchState.mode = 'drag';
    touchState.lastX = e.touches[0].clientX;
    touchState.lastY = e.touches[0].clientY;
  }
}, { passive: true });

resetBtn.addEventListener('click', () => {
  Object.assign(placement, DEFAULT_PLACEMENT);
  applyPlacement();
});

/* ============================================================
   カメラ切替
   ============================================================ */
switchCamBtn.addEventListener('click', async () => {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  await startCamera();
});

/* ============================================================
   撮影
   ============================================================ */
shutterBtn.addEventListener('click', () => {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const out = document.createElement('canvas');
  out.width = vw;
  out.height = vh;
  const ctx = out.getContext('2d');

  // フロントカメラの場合はプレビューと同じ「鏡写し」で保存する
  if (facingMode === 'user') {
    ctx.translate(vw, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, vw, vh);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // three.js 側は video と同解像度でレンダリングしているのでそのまま重ねる
  ctx.drawImage(renderer.domElement, 0, 0, vw, vh);

  out.toBlob((blob) => {
    const url = URL.createObjectURL(blob);
    resultImg.src = url;
    resultScreen.classList.add('show');
  }, 'image/png');
});

retakeBtn.addEventListener('click', () => {
  resultScreen.classList.remove('show');
});

/* ============================================================
   レンダーループ
   ============================================================ */
function animate() {
  requestAnimationFrame(animate);
  // フロントカメラ時はプレビュー用videoがCSSで反転していないため、
  // three.js側は常に非反転のまま描画し、撮影時のみ上でミラー処理する。
  renderer.render(scene, camera);
}
animate();

/* ============================================================
   起動
   ============================================================ */
startBtn.addEventListener('click', async () => {
  startError.textContent = '';
  try {
    await startCamera();
    startScreen.style.display = 'none';
    loadModel();
  } catch (err) {
    // エラーメッセージは startCamera 内で表示済み
  }
});
