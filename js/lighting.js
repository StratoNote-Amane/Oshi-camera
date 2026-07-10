/* ============================================================
   lighting.js — 環境光推定モジュール
   ------------------------------------------------------------
   カメラ映像から
     - 平均輝度・平均色(既存機能)
     - 簡易的な光源方向(新規: Task 1)
     - よりロバストな露出係数(新規: Task 3、中央値ベース)
   を推定し、渡されたThree.jsのライト/レンダラーへ反映する。

   【調査結果のサマリ(詳細はdocs/SPRINT_1_REPORT.md参照)】
   光源方向推定の実装方式として以下を比較した:
     - Sobel/エッジ検出         : 実装コスト中、方向推定の精度は中程度、
                                    小さいサンプルでは輪郭が少なくノイズに弱い
     - 軽量AI(セグメンテーション等): 精度は高いが本Sprintの「main.js責務を
                                    増やさない/既存アーキテクチャを壊さない」
                                    「モバイル性能を考慮」との両立が難しく、
                                    将来のAI環境認識タスクと合わせて再検討する
     - 輝度重心法(採用)         : 縮小画像の中で最も明るい領域の位置を
                                    「輝度の重心」として求め、画像中心からの
                                    オフセットを方向とみなす簡易手法。
                                    実装コストが低く、既存の平均色サンプリング
                                    (12x8の縮小画像)をそのまま流用できるため、
                                    今回はこれを採用した。
   露出方式の比較:
     - 単純平均(旧)             : 明るい/暗い外れ値(小さな光源・暗い隅等)に
                                    弱く、露出が過敏に変化することがあった
     - 中央値ベース(採用)       : 96サンプルを簡易ヒストグラム化し中央値を
                                    使うことで外れ値の影響を緩和
     - ヒストグラムのゾーン別制御: 精度は上がるが実装・調整コストが高く、
                                    サンプル数(12x8=96)では解像度不足のため見送り
   ============================================================ */
import * as THREE from 'three';

const SAMPLE_W = 12;
const SAMPLE_H = 8;
const SAMPLE_INTERVAL_MS = 400;

export function createEnvironmentLighting({ video, hemi, dir, rim, renderer, baseIntensities, baseToneExposure }) {
  const envCanvas = document.createElement('canvas');
  envCanvas.width = SAMPLE_W;
  envCanvas.height = SAMPLE_H;
  const envCtx = envCanvas.getContext('2d', { willReadFrequently: true });

  let smoothedBrightness = 0.5;   // 指数移動平均後の明るさ(中央値ベース)
  const smoothedColor = new THREE.Color(1, 1, 1);
  let smoothedAzimuthDeg = 0;     // 推定した光源の水平方向(度、画像中心からの相対)
  let smoothedElevation = 1;      // 0(低い/横から)〜1(高い/真上)の簡易指標
  let timer = null;

  function computeMedianBrightness(data) {
    // 96サンプル分の輝度を8段階のヒストグラムに分け、中央値を含むビンの
    // 代表値を返す。厳密な中央値ではないが、外れ値の影響を抑える目的には十分。
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
    // 12x8グリッドの中で最も明るいセルを探し、画像中心からのオフセットを
    // 方向(azimuth/elevation)の簡易推定値として使う。
    let maxY = -1, maxX = 0, maxRow = 0;
    for (let py = 0; py < SAMPLE_H; py++) {
      for (let px = 0; px < SAMPLE_W; px++) {
        const idx = (py * SAMPLE_W + px) * 4;
        const y = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
        if (y > maxY) { maxY = y; maxX = px; maxRow = py; }
      }
    }
    const dx = (maxX + 0.5) / SAMPLE_W - 0.5;   // -0.5〜0.5 (左右)
    const dyTop = 1 - (maxRow + 0.5) / SAMPLE_H; // 0(下)〜1(上)。上にあるほど高い光源とみなす
    return { azimuthDeg: dx * 100, elevation: dyTop };
  }

  function applyToScene() {
    const factor = THREE.MathUtils.clamp(smoothedBrightness / 0.45, 0.4, 2.2);
    hemi.intensity = baseIntensities.hemi * factor;
    dir.intensity = baseIntensities.dir * factor;
    rim.intensity = baseIntensities.rim * factor;

    const tint = smoothedColor.clone().lerp(new THREE.Color(1, 1, 1), 0.6);
    dir.color.copy(tint);
    hemi.color.copy(tint);

    renderer.toneMappingExposure = THREE.MathUtils.clamp(baseToneExposure / Math.sqrt(factor), 0.6, 1.3);

    // 推定した光源方向をDirectionalLightの位置(向き)へ反映する。
    // elevationが高いほど真上寄り、azimuthが大きいほど横から差す。
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

  return { start, stop, sampleOnce, getEstimatedAzimuthDeg, getEstimatedTintColor };
}
