/* ============================================================
   lighting.js — 環境光推定モジュール
   ------------------------------------------------------------
   カメラ映像から
     - 平均輝度・平均色(既存機能)
     - 簡易的な光源方向(新規: Task 1)
     - よりロバストな露出係数(新規: Task 3、中央値ベース)
   を推定し、渡されたThree.jsのライト/レンダラーへ反映する。
   ============================================================ */
import * as THREE from 'three';

const SAMPLE_W = 12;
const SAMPLE_H = 8;
const SAMPLE_INTERVAL_MS = 400;

// rimの初期色(このプロジェクトが最初から意図していた「背景に馴染ませるための
// 縁光」の色)。環境色へ完全に置き換えるのではなく、この色とのブレンドとして
// 残すことで「縁光らしさ」は保ちつつ、環境と乖離しないようにする。
const RIM_BASE_COLOR = new THREE.Color(0xcfe8ff);

export function createEnvironmentLighting({ video, hemi, dir, rim, renderer, baseIntensities, baseToneExposure }) {
  const envCanvas = document.createElement('canvas');
  envCanvas.width = SAMPLE_W;
  envCanvas.height = SAMPLE_H;
  const envCtx = envCanvas.getContext('2d', { willReadFrequently: true });

  let smoothedBrightness = 0.5;   // 指数移動平均後の明るさ(中央値ベース)
  const smoothedColor = new THREE.Color(1, 1, 1);
  let smoothedAzimuthDeg = 0;     // 推定した光源の水平方向(度、画像中心からの相対)
  let smoothedElevation = 1;      // 0(低い/横から)〜1(高い/真上)の簡易指標
  let lastBrightnessFactor = 1;   // shadow-rig.js等、他モジュールへ渡すための明るさ係数
  let timer = null;

  function computeMedianBrightness(data) {
    const BIN_COUNT = 8;
    const bins = new Array(BIN_COUNT).fill(0);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const y = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
      const bin = Math.min(BIN_COUNT - 1, Math.floor(y * BIN_COUNT));
      bins[bin]++;
      n++;
    }
    let cum = 0, medianBin = 0;
    for (let b = 0; b < BIN_COUNT; b++) {
      cum += bins[b];
      if (cum >= n / 2) { medianBin = b; break; }
    }
    return (medianBin + 0.5) / BIN_COUNT;
  }

  function computeBrightestCellDirection(data) {
    let maxY = -1, maxX = 0, maxRow = 0;
    for (let py = 0; py < SAMPLE_H; py++) {
      for (let px = 0; px < SAMPLE_W; px++) {
        const idx = (py * SAMPLE_W + px) * 4;
        const y = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
        if (y > maxY) { maxY = y; maxX = px; maxRow = py; }
      }
    }
    const dx = (maxX + 0.5) / SAMPLE_W - 0.5;
    const dyTop = 1 - (maxRow + 0.5) / SAMPLE_H;
    return { azimuthDeg: dx * 100, elevation: dyTop };
  }

  function applyToScene() {
    const factor = THREE.MathUtils.clamp(smoothedBrightness / 0.45, 0.4, 2.2);
    lastBrightnessFactor = factor;
    hemi.intensity = baseIntensities.hemi * factor;
    dir.intensity = baseIntensities.dir * factor;
    rim.intensity = baseIntensities.rim * factor;

    const tint = smoothedColor.clone().lerp(new THREE.Color(1, 1, 1), 0.35);
    dir.color.copy(tint);
    hemi.color.copy(tint);
    rim.color.copy(RIM_BASE_COLOR.clone().lerp(tint, 0.75));

    renderer.toneMappingExposure = THREE.MathUtils.clamp(baseToneExposure / Math.sqrt(factor), 0.6, 1.3);

    const azimuthRad = THREE.MathUtils.degToRad(smoothedAzimuthDeg);
    const horizDist = 1.6 * (1 - smoothedElevation * 0.5);
    dir.position.set(
      Math.sin(azimuthRad) * horizDist,
      1.2 + smoothedElevation * 1.8,
      Math.cos(azimuthRad) * horizDist + 0.8
    );
  }

  function sampleOnce() {
    if (!video.videoWidth) return;
    try {
      envCtx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
      const { data } = envCtx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);

      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
      r /= n; g /= n; b /= n;

      const medianBrightness = computeMedianBrightness(data);
      smoothedBrightness += (medianBrightness - smoothedBrightness) * 0.15;
      smoothedColor.lerp(new THREE.Color(r / 255, g / 255, b / 255), 0.1);

      const est = computeBrightestCellDirection(data);
      smoothedAzimuthDeg += (est.azimuthDeg - smoothedAzimuthDeg) * 0.08;
      smoothedElevation += (est.elevation - smoothedElevation) * 0.08;

      applyToScene();
    } catch (e) {
      console.warn('environment sampling failed', e);
      stop();
    }
  }

  function start() {
    stop();
    timer = setInterval(sampleOnce, SAMPLE_INTERVAL_MS);
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }
  function getEstimatedAzimuthDeg() {
    return smoothedAzimuthDeg;
  }
  function getEstimatedTintColor() {
    return { r: smoothedColor.r, g: smoothedColor.g, b: smoothedColor.b };
  }
  function getBrightnessFactor() {
    return lastBrightnessFactor;
  }

  return { start, stop, sampleOnce, getEstimatedAzimuthDeg, getEstimatedTintColor, getBrightnessFactor };
}
