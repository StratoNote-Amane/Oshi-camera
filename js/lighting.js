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

   2026/08 更新（色温度の反映、ADR-015案）:
   - js/environment-analyzer.jsの実体を確認できたため、上記1)で
     見送っていたestimatedColorTemperature(1500K〜12000Kの粗い推定、
     R/B比ベース)の反映を実装する。
   - 色温度→RGBの変換は物理的に厳密なものではなく、Tanner Hellandの
     近似式を簡略化したものを使用する(colorTemperatureToRGB())。
     色温度の傾向(低いほど暖色/赤み、高いほど寒色/青み)を大まかに
     再現する実用的な近似に留める。
   - 実機写真で「部屋の色(暖色/寒色)とキャラクターの色味が一致しない」
     というフィードバックがあったため、既存のtint計算(skyColor/
     groundColorベース)へ、この色温度ベースの色をさらに弱くブレンド
     する形で追加する(既存ロジックを置き換えない、ENV_ANALYZER_BLEND
     と同じ重みを流用)。
   - 数値は実機未確認の「たたき台」であり、まだ寄せ方が弱い/強すぎる
     場合は本ファイルのENV_ANALYZER_BLEND、または末尾のCT_BLEND_EXTRA
     を調整すること。
   ============================================================ */
import * as THREE from 'three';

const SAMPLE_W = 12;
const SAMPLE_H = 8;
const SAMPLE_INTERVAL_MS = 400;

// EnvironmentAnalyzer由来の値をどれだけ信用してブレンドするか(0〜1)。
// 環境認識自体はまだドラフト運用(CONSTRAINTS.md 1節)のため、既存の
// 画像ベース推定を置き換えない範囲の弱いブレンドに留めている。
const ENV_ANALYZER_BLEND = 0.25;

// 色温度ベースの色(colorTemperatureToRGB)をtintへブレンドする強さ。
// skyColor/groundColorのブレンド(ENV_ANALYZER_BLEND)とは独立した
// パラメータにしてある(色温度はR/B比という別の切り口の推定値であり、
// 効き方を別々に調整できた方が実機調整がしやすいため)。
const CT_BLEND_EXTRA = 0.3;

// rimの初期色(このプロジェクトが最初から意図していた「背景に馴染ませるための
// 縁光」の色)。環境色へ完全に置き換えるのではなく、この色とのブレンドとして
// 残すことで「縁光らしさ」は保ちつつ、環境と乖離しないようにする。
const RIM_BASE_COLOR = new THREE.Color(0xcfe8ff);

/**
 * 色温度(ケルビン)をおおよそのRGBへ変換する。
 * Tanner Hellandのアルゴリズムを簡略化した近似式で、物理的に厳密な
 * 変換ではない。あくまで「低いほど暖色(赤み)、高いほど寒色(青み)」
 * という色温度の傾向を、追加のテーブルや外部ライブラリなしで
 * 大まかに再現するための実用的な近似として使う。
 * @param {number} kelvin 1000〜40000程度を想定(environment-analyzer.js
 *   のestimatedColorTemperatureは1500〜12000にクランプ済み)
 * @returns {THREE.Color}
 */
function colorTemperatureToRGB(kelvin) {
  const temp = THREE.MathUtils.clamp(kelvin, 1000, 40000) / 100;
  let r, g, b;

  if (temp <= 66) {
    r = 255;
  } else {
    r = 329.698727446 * Math.pow(temp - 60, -0.1332047592);
  }

  if (temp <= 66) {
    g = 99.4708025861 * Math.log(temp) - 161.1195681661;
  } else {
    g = 288.1221695283 * Math.pow(temp - 60, -0.0755148492);
  }

  if (temp >= 66) {
    b = 255;
  } else if (temp <= 19) {
    b = 0;
  } else {
    b = 138.5177312231 * Math.log(temp - 10) - 305.0447927307;
  }

  return new THREE.Color(
    THREE.MathUtils.clamp(r, 0, 255) / 255,
    THREE.MathUtils.clamp(g, 0, 255) / 255,
    THREE.MathUtils.clamp(b, 0, 255) / 255
  );
}

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

    // EnvironmentAnalyzerのskyColor(上方向)/groundColor(下方向)が取得できる場合、
    // Hemisphere Lightの上下色へ弱くブレンドする。環境認識がまだドラフト運用
    // (CONSTRAINTS.md 1節)であることを踏まえ、既存の画像ベース色を置き換えず
    // ENV_ANALYZER_BLEND分だけ寄せるに留める。
    if (envState && envState.skyColor && envState.groundColor) {
      const sky = new THREE.Color(envState.skyColor.r, envState.skyColor.g, envState.skyColor.b);
      const ground = new THREE.Color(envState.groundColor.r, envState.groundColor.g, envState.groundColor.b);
      hemi.color.lerp(sky, ENV_ANALYZER_BLEND);
      hemi.groundColor.copy(hemi.groundColor || new THREE.Color(0x2a2a33)).lerp(ground, ENV_ANALYZER_BLEND);
      // tint(dir/rimへ反映する色)にも同じ根拠(空/地面の平均色)を弱く寄せる。
      // これにより「Hemisphereだけ環境色が乗ってDirectional/Rimは乗らない」
      // という不一致を防ぐ。
      const skyGroundAvg = sky.clone().lerp(ground, 0.5);
      tint.lerp(skyGroundAvg, ENV_ANALYZER_BLEND * 0.6);
    }

    // 2026/08追加: estimatedColorTemperature(1500K〜12000Kの粗い推定)を
    // RGBへ変換し、tintへさらに弱くブレンドする。以前は「実体未確認」を
    // 理由に見送っていたが、environment-analyzer.jsの実装を確認できた
    // ため反映する。色温度はR/B比という、skyColor/groundColorの平均とは
    // 別の切り口の推定値であるため、独立した重み(CT_BLEND_EXTRA)で
    // ブレンドする(効きが強すぎ/弱すぎる場合はここを調整する)。
    if (envState && typeof envState.estimatedColorTemperature === 'number') {
      const ctColor = colorTemperatureToRGB(envState.estimatedColorTemperature);
      tint.lerp(ctColor, CT_BLEND_EXTRA);
    }

    dir.color.copy(tint);
    hemi.color.lerp(tint, 0.5);
    // rimは「縁光らしさ」を保つため基準色(クール寄り)を残しつつ、
    // 大部分は環境色へ追従させる(暖色の部屋では暖色の縁光になる)。
    rim.color.copy(RIM_BASE_COLOR.clone().lerp(tint, 0.75));

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
