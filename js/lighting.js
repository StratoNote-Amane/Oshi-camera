/* ============================================================
   lighting.js — 環境光推定モジュール
   ------------------------------------------------------------
   カメラ映像から
     - 平均輝度・平均色(既存機能)
     - 簡易的な光源方向(輝度重心法)
     - よりロバストな露出係数(中央値ベース)
   を推定し、渡されたThree.jsのライト/レンダラーへ反映する。

   2026/07/22 更新（20260722影修正指示書 対応、一部）:
   -指示書は「SkyColor/GroundColor/ColorTemperature/AverageLuminanceを
     Lighting.jsへ統合せよ」としているが、以下の理由で**部分対応**に
     留めている。
       1) js/environment-analyzer.js の実体をまだ確認できておらず、
          colorTemperatureの単位(ケルビン値かRGB係数か)や
          skyColor/groundColorの値域(0-1かHexか)を断定できない。
          environment-shadow.js が既に skyColor/groundColor を
          {r,g,b}(0-1、THREE.Colorと同じ値域)として扱っている実装を
          唯一の手掛かりとして、そこだけは同じ前提で扱う。
       2) 憶測で色温度→RGB変換式を実装するのは「見た目の不具合は
          ライブラリ/実装を確認してから直す」というCONSTRAINTS.md 6節の
          原則に反するため、colorTemperatureの反映は見送り、
          environment-analyzer.jsの実体確認後に追って対応する。
   - 対応した内容: skyColor/groundColor/averageLuminanceが取得できて
     いる場合、既存の画像内輝度重心法による推定に「弱く」(既定25%)
     ブレンドする。既存ロジックを置き換えるのではなく寄せるだけに
     留めているため、environmentStateが無い/値がおかしい場合でも
     既存の見た目からの破綻が小さい。
   ============================================================ */
import * as THREE from 'three';

const SAMPLE_W = 12;
const SAMPLE_H = 8;
const SAMPLE_INTERVAL_MS = 400;

// EnvironmentAnalyzer由来の値をどれだけ信用してブレンドするか(0〜1)。
// 環境認識自体はまだドラフト運用(CONSTRAINTS.md 1節)のため、既存の
// 画像ベース推定を置き換えない範囲の弱いブレンドに留めている。
const ENV_ANALYZER_BLEND = 0.25;

// rimの初期色(このプロジェクトが最初から意図していた「背景に馴染ませるための
// 縁光」の色)。環境色へ完全に置き換えるのではなく、この色とのブレンドとして
// 残すことで「縁光らしさ」は保ちつつ、環境と乖離しないようにする。
const RIM_BASE_COLOR = new THREE.Color(0xcfe8ff);

/**
 * @param {object} args
 * @param {() => object|null} [args.getEnvironmentState] diagnostics.jsの
 *   getEnvironmentState()相当。未指定/nullを返す間は従来通り画像ベースのみで動作する。
 */
export function createEnvironmentLighting({ video, hemi, dir, rim, renderer, baseIntensities, baseToneExposure, getEnvironmentState = null }) {
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
    // EnvironmentAnalyzerのaverageLuminance(0-1想定)が取得できる場合、
    // 画像内輝度推定へ弱くブレンドする(置き換えない)。
    let brightnessForFactor = smoothedBrightness;
    const envState = getEnvironmentState ? getEnvironmentState() : null;
    if (envState && typeof envState.averageLuminance === 'number') {
      brightnessForFactor = THREE.MathUtils.lerp(smoothedBrightness, envState.averageLuminance, ENV_ANALYZER_BLEND);
    }

    const factor = THREE.MathUtils.clamp(brightnessForFactor / 0.45, 0.4, 2.2);
    lastBrightnessFactor = factor;
    hemi.intensity = baseIntensities.hemi * factor;
    dir.intensity = baseIntensities.dir * factor;
    rim.intensity = baseIntensities.rim * factor;

    // 実機写真で「部屋が暖色でもキャラの肌・服が終始クールな色味のまま」という
    // 症状が確認された。原因は主に2点:
    //   (1) 白へのlerpが強すぎ(0.6)、環境色の反映がもともと弱かった
    //   (2) rim(縁光)の色がここで一度も更新されておらず、初期値の
    //       クールな水色(0xcfe8ff)に常時固定されていた
    // (1)は白寄りの割合を下げ、(2)はrimにも環境色を反映することで対応する。
    const tint = smoothedColor.clone().lerp(new THREE.Color(1, 1, 1), 0.35);
    dir.color.copy(tint);
    hemi.color.copy(tint);
    // rimは「縁光らしさ」を保つため基準色(クール寄り)を残しつつ、
    // 大部分は環境色へ追従させる(暖色の部屋では暖色の縁光になる)。
    rim.color.copy(RIM_BASE_COLOR.clone().lerp(tint, 0.75));

    // EnvironmentAnalyzerのskyColor(上方向)/groundColor(下方向)が取得できる場合、
    // Hemisphere Lightの上下色へ弱くブレンドする。環境認識がまだドラフト運用
    // (CONSTRAINTS.md 1節)であることを踏まえ、既存の画像ベース色を置き換えず
    // ENV_ANALYZER_BLEND分だけ寄せるに留める。colorTemperatureはenvironment-analyzer.js
    // の実体確認後に別途対応する(このファイル冒頭コメント参照)。
    if (envState && envState.skyColor && envState.groundColor) {
      const sky = new THREE.Color(envState.skyColor.r, envState.skyColor.g, envState.skyColor.b);
      const ground = new THREE.Color(envState.groundColor.r, envState.groundColor.g, envState.groundColor.b);
      hemi.color.lerp(sky, ENV_ANALYZER_BLEND);
      hemi.groundColor.copy(hemi.groundColor || new THREE.Color(0x2a2a33)).lerp(ground, ENV_ANALYZER_BLEND);
    }

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
  function getBrightnessFactor() {
    return lastBrightnessFactor;
  }

  return { start, stop, sampleOnce, getEstimatedAzimuthDeg, getEstimatedTintColor, getBrightnessFactor };
}
