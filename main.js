import * as THREE from 'three';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';

/* ============================================================
   キャラクター設定
   ------------------------------------------------------------
   expressions: PMXに実際に入っている表情モーフ名(頂点モーフ)を
   組み合わせたプリセット。モーフ名はモデルごとに異なるため、
   2人目を追加する時はそのモデルのモーフ名を確認して個別に定義する。
   （天音かなた_新衣装_ファンメイドMMD.pmx から抽出した26個の
   モーフのうち、表情に関係するもの＝眉/目/口パネルのみを使用）
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
const expressionBar = document.getElementById('expression-bar');
const shutterBtn    = document.getElementById('shutter-btn');
const resultScreen  = document.getElementById('result-screen');
const resultImg     = document.getElementById('result-img');
const resultHint    = document.getElementById('result-hint');
const shareBtn      = document.getElementById('share-btn');
const retakeBtn     = document.getElementById('retake-btn');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText   = document.getElementById('loading-text');

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

// OutlineEffect: MMDモデルの材質に埋め込まれたエッジ色・太さ情報を使って
// MMDらしい輪郭線を自動で描画してくれる（three.js公式のMMD対応機能）。
// 以後の描画は renderer.render の代わりに effect.render を使う。
const effect = new OutlineEffect(renderer, { defaultThickness: 0.0035, defaultColor: [0, 0, 0], defaultAlpha: 0.85 });

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
camera.position.set(0, 0, 0);

const hemi = new THREE.HemisphereLight(0xffffff, 0x2a2a33, 1.15);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xfff2d8, 0.9);
dir.position.set(1.2, 2.4, 1.6);
scene.add(dir);

/* ============================================================
   足元の影（二重構成：接地感を出すための締まったコア影＋広がる柔らかい影）
   ============================================================ */
function makeShadowTexture({ core, mid, spread }) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
  g.addColorStop(0, `rgba(0,0,0,${core})`);
  g.addColorStop(0.55, `rgba(0,0,0,${mid})`);
  g.addColorStop(1, `rgba(0,0,0,${spread})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
function makeShadowPlane(tex) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  mesh.rotation.x = -Math.PI / 2;
  scene.add(mesh);
  return mesh;
}
const shadowSoft = makeShadowPlane(makeShadowTexture({ core: 0.30, mid: 0.16, spread: 0 }));
const shadowCore = makeShadowPlane(makeShadowTexture({ core: 0.55, mid: 0.20, spread: 0 }));

/* ============================================================
   キャラクターの抽象化
   ============================================================ */
class MMDCharacter {
  constructor(mesh, def) {
    this.root = mesh;
    this.unitToMeter = def.unitToMeter;
    this.expressions = def.expressions || {};
    this.blinkMorph = def.blinkMorph || null;
    this.exprWeights = {};   // 現在の各モーフの表示重み(補間後)
    this.exprTargets = {};   // 選択中プリセットの目標重み
    this.setExpression('normal');
    this.blinkState = 'idle'; // idle -> closing -> closed -> opening
    this.blinkTimer = 2 + Math.random() * 3;
    this.blinkWeight = 0;
  }
  setTransform({ x, y, z, rotY, scale }) {
    this.root.position.set(x, y, z);
    this.root.rotation.y = rotY;
    this.root.scale.setScalar(this.unitToMeter * scale);
  }
  getFootY() {
    const box = new THREE.Box3().setFromObject(this.root);
    return box.min.y;
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
  // 毎フレーム呼び出し：表情の滑らかな補間と自動まばたきを処理する
  update(dt) {
    const dict = this.root.morphTargetDictionary;
    const infl = this.root.morphTargetInfluences;
    if (!dict || !infl) return;

    // 表情モーフをターゲットへ滑らかに補間
    const allNames = new Set([...Object.keys(this.exprWeights), ...Object.keys(this.exprTargets)]);
    const LERP_SPEED = 8; // 大きいほど速く切り替わる
    for (const name of allNames) {
      const cur = this.exprWeights[name] || 0;
      const target = this.exprTargets[name] || 0;
      const next = cur + (target - cur) * Math.min(1, dt * LERP_SPEED);
      this.exprWeights[name] = next;
      const idx = dict[name];
      if (idx !== undefined) infl[idx] = next;
    }

    // 自動まばたき（表情プリセットとは独立して動かし、最後に上書きで合成する）
    if (this.blinkMorph && dict[this.blinkMorph] !== undefined) {
      this.blinkTimer -= dt;
      if (this.blinkState === 'idle' && this.blinkTimer <= 0) {
        this.blinkState = 'closing';
      }
      const CLOSE_SPEED = 14, OPEN_SPEED = 10;
      if (this.blinkState === 'closing') {
        this.blinkWeight = Math.min(1, this.blinkWeight + dt * CLOSE_SPEED);
        if (this.blinkWeight >= 1) this.blinkState = 'opening';
      } else if (this.blinkState === 'opening') {
        this.blinkWeight = Math.max(0, this.blinkWeight - dt * OPEN_SPEED);
        if (this.blinkWeight <= 0) {
          this.blinkState = 'idle';
          this.blinkTimer = 2.2 + Math.random() * 3.5;
        }
      }
      const idx = dict[this.blinkMorph];
      const base = this.exprWeights[this.blinkMorph] || 0;
      infl[idx] = Math.max(base, this.blinkWeight);
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
  setExpression() { /* 2D素材は表情モーフを持たないため何もしない */ }
  update() {}
}

let activeCharacter = null;

function loadCharacter(def) {
  if (def.type === 'mmd') {
    const loader = new MMDLoader();
    loader.load(
      def.path,
      (mesh) => {
        scene.add(mesh);
        activeCharacter = new MMDCharacter(mesh, def);
        applyPlacement();
        buildExpressionBar(def);
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
      loadingOverlay.classList.add('hide');
    });
  }
}

/* ============================================================
   表情ボタンの生成
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
    });
    buttons[key] = btn;
    expressionBar.appendChild(btn);
  });
}

/* ============================================================
   配置の反映
   ============================================================ */
function applyPlacement() {
  if (!activeCharacter) return;
  activeCharacter.setTransform(placement);
  const footY = activeCharacter.getFootY();
  const width = activeCharacter.getWidth();
  shadowSoft.position.set(placement.x, footY + 0.002, placement.z);
  shadowSoft.scale.set(width * 1.3, width * 1.3 * 0.6, 1);
  shadowCore.position.set(placement.x, footY + 0.003, placement.z);
  shadowCore.scale.set(width * 0.55, width * 0.55 * 0.55, 1);
}

/* ============================================================
   ジャイロAR（3DoF：スマホの向きに合わせてカメラを回転させ、
   推しがその場に固定されているように見せる）
   ------------------------------------------------------------
   位置(x/y/z)の完全なAR追従にはARKit相当のVIOが必要でWeb単体
   では不可能だが、向き(回転)だけならDeviceOrientationEventで
   実用的に再現できる。基準姿勢からの「差分回転」をカメラに
   適用することで、配置時に見えていた通りの位置関係を保ったまま
   スマホの回転に追従させる。
   ============================================================ */
let gyroEnabled = false;
let gyroRefQuat = null;
let gyroCurQuat = null;

const _zee = new THREE.Vector3(0, 0, 1);
const _euler = new THREE.Euler();
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // -90deg around X

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
  if (e.alpha === null) return; // センサー値が取れない環境
  if (!gyroCurQuat) gyroCurQuat = new THREE.Quaternion();
  deviceOrientationToQuaternion(e.alpha, e.beta, e.gamma, gyroCurQuat);
  if (!gyroRefQuat) gyroRefQuat = gyroCurQuat.clone();
}

async function requestGyroPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      return res === 'granted';
    } catch (e) {
      console.warn('gyro permission error', e);
      return false;
    }
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
  if (currentStream) { currentStream.getTracks().forEach((t) => t.stop()); currentStream = null; }
}
function onVideoMeta() {
  const vw = video.videoWidth || 1080;
  const vh = video.videoHeight || 1920;
  sizeStageToVideo(vw, vh);
}
function sizeStageToVideo(vw, vh) {
  const aspect = vw / vh;
  const wrapRect = stageWrap.getBoundingClientRect();
  let w = wrapRect.width;
  let h = w / aspect;
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
    const dx = t.clientX - touchState.lastX;
    const dy = t.clientY - touchState.lastY;
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
  reanchorGyro(); // 現在の向きを新しい基準にして「ここに固定」しなおす
});

switchCamBtn.addEventListener('click', async () => {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  await startCamera();
});

/* ============================================================
   撮影
   ============================================================ */
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
  out.toBlob((blob) => {
    if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = URL.createObjectURL(blob);
    resultImg.src = currentBlobUrl;
    resultScreen.classList.add('show');
    lastBlob = blob;
  }, 'image/png');
}
shutterBtn.addEventListener('click', capture);
retakeBtn.addEventListener('click', () => resultScreen.classList.remove('show'));

shareBtn.addEventListener('click', async () => {
  if (!lastBlob) return;
  const file = new File([lastBlob], 'oshi-camera.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; }
    catch (err) { if (err && err.name === 'AbortError') return; console.error(err); }
  }
  resultHint.textContent = 'この環境では共有シートが使えません。画像を長押しして「写真に保存」してください';
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
    const delta = gyroCurQuat.clone().multiply(gyroRefQuat.clone().invert());
    camera.quaternion.copy(delta);
  }

  if (activeCharacter) activeCharacter.update(dt);

  effect.render(scene, camera);
}
animate();

/* ============================================================
   起動フロー：キャラ選択 → 権限許可 → カメラ開始
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
    await startCamera();
    startScreen.style.display = 'none';
    loadCharacter(CHARACTERS[currentCharacterIndex]);
  } catch (err) {
    // エラーメッセージは startCamera 内で表示済み
  }
});
