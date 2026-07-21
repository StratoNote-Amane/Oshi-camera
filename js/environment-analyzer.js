/* ============================================================
   environment-analyzer.js — 環境情報の一元推定モジュール(新規)
   ------------------------------------------------------------
   【スコープについての重要な注記】
   指示書は天候(降水/雲量/気温)取得も要求しているが、これは
   外部APIサーバーへの問い合わせが必須であり、GitHub Pages上の
   静的サイトからAPIキーを安全に隠す手段がない。CONSTRAINTS.mdの
   「サーバー/バックエンドなし」「有料API・サーバー不使用」
   「無料枠のみで完結」という制約に反するため、本モジュールでは
   天候関連フィールドは常にnullを返す(将来、この制約が変更されたら
   拡張できるよう、返却オブジェクトの形自体は指示書の形に合わせてある)。
   このスコープ変更は憲法6章の手順に従い、CONSTRAINTS.mdの改訂を
   経てから正式版とすること(現時点ではドラフト実装)。

   同様に、AIによる環境認識自体がCONSTRAINTS.md 1章で明示的に
   対象外とされている項目のため、このファイルはあくまで
   ドラフト/検証用として位置づけ、正式採用にはCONSTRAINTS.mdの
   該当節の更新が必要(VISION_REALISM.mdの「AIによる環境認識」節に
   既に合意された方向性はあるが、格上げの正式承認はまだ得ていない)。

   【取得する情報】
   - GPS(緯度/経度/高度/精度): navigator.geolocation。追加コストなし。
   - 日時→太陽高度/方位角: dev-environment.jsのgetSunPosition()と
     同じNOAA近似式を流用する。dev-environment.jsは「真太陽時として
     扱い、経度補正はしない」という意図的な簡略化をしているが
     (dev.html専用・緯度プリセットの選択のみで実時計と紐付かない
     ため)、本モジュールは実際のGPS経度と端末の実時計を持つので、
     経度による時差(15度=1時間)の補正だけは行う。均時差(equation
     of time)まではdev-environment.js同様に簡略化のため無視する。
   - カメラ映像解析: lighting.jsと同様に小さくリサイズしたcanvas
     から平均輝度・平均色・空/地面の色を取得し、Indoor/Outdoorの
     加点式スコアリングに使う。

   このファイルはlighting.jsの環境光反映ロジック(HemisphereLight等
   への適用)には触れない。あくまで「情報を取得して返す」層であり、
   各システムへどう反映するかは呼び出し側(lighting.js/atmosphere.js/
   shadow-rig.js/postfx.js/main.js)の責務のまま変えていない。
   ============================================================ */

const IMAGE_SAMPLE_W = 16;
const IMAGE_SAMPLE_H = 12;
const DEFAULT_IMAGE_INTERVAL_MS = 500;
const DEFAULT_GPS_INTERVAL_MS = 45000;

/* ------------------------------------------------------------
   太陽位置(NOAA近似)。dev-environment.jsのgetSunPosition()と
   同一の式。二重管理を避けるため、将来的にはこの関数を
   dev-environment.js側と共通の1ファイルへ切り出す統合を検討したい
   (このモジュールを新設した時点ではdev.html専用モジュールに
   本体アプリ(main.js)から依存を作るのは望ましくないと判断し、
   あえて式を複製した。統合するかどうかはADR化してから判断する)。
   ------------------------------------------------------------ */
function getSunPosition(date, solarHour, latDeg) {
  const dayOfYear = getDayOfYear(date);
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + (solarHour - 12) / 24);

  const decl = 0.006918
    - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);

  const lat = degToRad(latDeg);
  const hourAngle = degToRad(15 * (solarHour - 12));

  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  const altitude = Math.asin(clamp(sinAlt, -1, 1));

  const cosAltLat = Math.cos(altitude) * Math.cos(lat);
  let cosAz = cosAltLat !== 0
    ? (Math.sin(decl) - Math.sin(altitude) * Math.sin(lat)) / cosAltLat
    : 1;
  cosAz = clamp(cosAz, -1, 1);
  let azimuth = Math.acos(cosAz);
  if (hourAngle > 0) azimuth = 2 * Math.PI - azimuth;

  return { altitudeDeg: radToDeg(altitude), azimuthDeg: radToDeg(azimuth) };
}
function getDayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}
function degToRad(d) { return d * Math.PI / 180; }
function radToDeg(r) { return r * 180 / Math.PI; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * 実時計時刻(Dateオブジェクト、端末のローカルタイムゾーンで解釈される)と
 * 経度から、「真太陽時」に近い時刻(0〜24の小数)へ変換する。
 * 均時差(年間±15分程度のズレ)は無視する簡略化(dev-environment.jsと
 * 同水準の精度)。タイムゾーンの標準経度(例: JSTならUTC+9=135°E)からの
 * 経度差分だけを反映する。
 */
function estimateSolarHour(date, longitudeDeg) {
  const localHour = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  const tzOffsetHours = -date.getTimezoneOffset() / 60; // 例: JSTなら+9
  const standardMeridian = tzOffsetHours * 15; // そのタイムゾーンの基準経度
  const longitudeCorrectionHours = (longitudeDeg - standardMeridian) / 15;
  let solarHour = localHour + longitudeCorrectionHours;
  if (solarHour < 0) solarHour += 24;
  if (solarHour >= 24) solarHour -= 24;
  return solarHour;
}

/* ------------------------------------------------------------
   カメラ画像解析
   ------------------------------------------------------------ */
function sampleFrame(video, ctx, canvas) {
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function analyzeImage(imageData, w, h) {
  const { data } = imageData;
  let rSum = 0, gSum = 0, bSum = 0, ySum = 0, n = 0;
  let highlightClip = 0, shadowClip = 0;
  const histogram = new Array(8).fill(0);

  // 上1/4を「空候補」、下1/4を「地面候補」として別集計する
  let skyR = 0, skyG = 0, skyB = 0, skyN = 0;
  let groundR = 0, groundG = 0, groundB = 0, groundN = 0;

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const idx = (py * w + px) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      const y = r * 0.299 + g * 0.587 + b * 0.114;
      rSum += r; gSum += g; bSum += b; ySum += y; n++;
      if (y >= 250) highlightClip++;
      if (y <= 5) shadowClip++;
      histogram[Math.min(7, Math.floor((y / 255) * 8))]++;

      if (py < h * 0.25) { skyR += r; skyG += g; skyB += b; skyN++; }
      if (py >= h * 0.75) { groundR += r; groundG += g; groundB += b; groundN++; }
    }
  }

  const avgR = rSum / n, avgG = gSum / n, avgB = bSum / n, avgY = ySum / n;
  const skyColor = skyN ? { r: skyR / skyN, g: skyG / skyN, b: skyB / skyN } : null;
  const groundColor = groundN ? { r: groundR / groundN, g: groundG / groundN, b: groundB / groundN } : null;

  // 色温度の粗い推定: R/B比が高い(赤みが強い)ほど低色温度(暖色/白熱灯)、
  // B/R比が高いほど高色温度(青みが強い/曇天・日陰)とみなす簡易近似。
  // 物理的に厳密な色温度変換ではなく、Indoor/Outdoor判定用の相対指標。
  const rbRatio = avgB > 0 ? avgR / avgB : 1;
  const estimatedColorTemperature = clamp(6500 / rbRatio, 1500, 12000);

  return {
    averageLuminance: avgY / 255,
    averageColor: { r: avgR / 255, g: avgG / 255, b: avgB / 255 },
    skyColor: skyColor ? { r: skyColor.r / 255, g: skyColor.g / 255, b: skyColor.b / 255 } : null,
    groundColor: groundColor ? { r: groundColor.r / 255, g: groundColor.g / 255, b: groundColor.b / 255 } : null,
    histogram,
    highlightClipRatio: highlightClip / n,
    shadowClipRatio: shadowClip / n,
    estimatedColorTemperature,
  };
}

/**
 * 空候補の色が「空らしいか」を判定する簡易ヒューリスティック。
 * 青空(高輝度・青み)、曇天(高輝度・低彩度の白灰色)のどちらもそれらしいと判定する。
 */
function looksLikeSky(skyColor) {
  if (!skyColor) return false;
  const { r, g, b } = skyColor;
  const brightness = (r + g + b) / 3;
  const blueDominant = b > r + 0.03 && b > g * 0.95;
  const brightGray = brightness > 0.65 && Math.max(r, g, b) - Math.min(r, g, b) < 0.08;
  return (brightness > 0.35 && blueDominant) || brightGray;
}

/* ------------------------------------------------------------
   Indoor/Outdoorスコアリング(加点方式)
   ------------------------------------------------------------
   指示書の例(空色あり+20、GPS精度良好+10等)を踏襲しつつ、
   このプロジェクトで実際に取得可能な情報だけを使う。
   二値判定ではなく、0〜100の確率的なスコアとして返す。
   ------------------------------------------------------------ */
function scoreEnvironment({ imageAnalysis, gps, sun }) {
  let outdoor = 0, indoor = 0;

  if (imageAnalysis) {
    if (looksLikeSky(imageAnalysis.skyColor)) outdoor += 25;
    else indoor += 15;

    // 上(空候補)と下(地面候補)の明るさに十分な差がある→屋外の
    // 空-地面グラデーションらしい。差が乏しい→屋内の均一照明らしい。
    if (imageAnalysis.skyColor && imageAnalysis.groundColor) {
      const skyLum = (imageAnalysis.skyColor.r + imageAnalysis.skyColor.g + imageAnalysis.skyColor.b) / 3;
      const groundLum = (imageAnalysis.groundColor.r + imageAnalysis.groundColor.g + imageAnalysis.groundColor.b) / 3;
      const gradient = Math.abs(skyLum - groundLum);
      if (gradient > 0.12) outdoor += 10;
      else indoor += 10;
    }

    // 太陽が地平線より上にある時刻に、実際の映像も明るい→日照と整合
    if (sun && sun.altitudeDeg > 0 && imageAnalysis.averageLuminance > 0.35) outdoor += 15;
    if (sun && sun.altitudeDeg <= -6 && imageAnalysis.averageLuminance > 0.5) {
      // 太陽が沈んでいるはずなのに明るい→人工照明(屋内)の可能性
      indoor += 15;
    }

    // 色温度: 日中屋外の目安(5000K〜9000K程度)から外れるほどIndoor寄り
    const ct = imageAnalysis.estimatedColorTemperature;
    if (ct >= 4800 && ct <= 9500) outdoor += 10;
    else indoor += 15;
  }

  if (gps) {
    if (gps.accuracy != null && gps.accuracy <= 20) outdoor += 15;
    else if (gps.accuracy != null && gps.accuracy > 50) indoor += 15;
  } else {
    // GPSが一定時間内に取得できない(屋内で電波が届きにくい)ことが多い
    indoor += 15;
  }

  const total = outdoor + indoor;
  const outdoorScore = total > 0 ? (outdoor / total) * 100 : 50;
  const indoorScore = 100 - outdoorScore;
  const environmentType = outdoorScore >= 55 ? 'outdoor' : (outdoorScore <= 45 ? 'indoor' : 'ambiguous');

  return { outdoorScore, indoorScore, environmentType };
}

/**
 * @param {object} opts
 * @param {HTMLVideoElement} opts.video
 * @param {number} [opts.imageIntervalMs]
 * @param {number} [opts.gpsIntervalMs]
 * @param {boolean} [opts.useGps=true] falseの場合、位置情報を一切要求しない
 *   (許可ダイアログを出したくない場面や、位置情報の使用に同意が
 *   得られていない場面のために用意)。
 */
export function createEnvironmentAnalyzer({ video, imageIntervalMs = DEFAULT_IMAGE_INTERVAL_MS, gpsIntervalMs = DEFAULT_GPS_INTERVAL_MS, useGps = true }) {
  const canvas = document.createElement('canvas');
  canvas.width = IMAGE_SAMPLE_W;
  canvas.height = IMAGE_SAMPLE_H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  let state = {
    latitude: null,
    longitude: null,
    altitudeMeters: null,
    gpsAccuracy: null,
    sunAltitude: null,
    sunAzimuth: null,
    averageLuminance: null,
    skyColor: null,
    groundColor: null,
    estimatedColorTemperature: null,
    estimatedLightDirection: null, // { azimuthDeg, elevation(0-1) } 簡易版
    // 天候関連: CONSTRAINTS.md(サーバー/有料API不使用)に抵触するため
    // 現状は常にnull。将来この制約が変更されたら拡張する拡張ポイント。
    cloudCover: null,
    weather: null,
    indoorScore: 50,
    outdoorScore: 50,
    environmentType: 'ambiguous',
    lastImageUpdate: 0,
    lastGpsUpdate: 0,
  };

  let imageTimer = null;
  let gpsWatchId = null;
  let gpsPollTimer = null;

  function updateSun() {
    if (state.latitude == null || state.longitude == null) return;
    const now = new Date();
    const solarHour = estimateSolarHour(now, state.longitude);
    const { altitudeDeg, azimuthDeg } = getSunPosition(now, solarHour, state.latitude);
    state.sunAltitude = altitudeDeg;
    state.sunAzimuth = azimuthDeg;
  }

  function sampleImageOnce() {
    if (!video.videoWidth) return;
    try {
      const imageData = sampleFrame(video, ctx, canvas);
      const analysis = analyzeImage(imageData, canvas.width, canvas.height);
      state.averageLuminance = analysis.averageLuminance;
      state.skyColor = analysis.skyColor;
      state.groundColor = analysis.groundColor;
      state.estimatedColorTemperature = analysis.estimatedColorTemperature;

      // 簡易light direction: 最も明るいセルの位置から(lighting.jsの
      // 輝度重心法と同種のロジック。SPRINT_1_REPORT.mdに記載の通り
      // 「映像内で最も明るい場所」という粗い近似であることに注意)
      state.estimatedLightDirection = estimateBrightestDirection(imageData, canvas.width, canvas.height);

      updateSun();
      const scores = scoreEnvironment({
        imageAnalysis: analysis,
        gps: (state.latitude != null) ? { accuracy: state.gpsAccuracy } : null,
        sun: (state.sunAltitude != null) ? { altitudeDeg: state.sunAltitude } : null,
      });
      state.outdoorScore = scores.outdoorScore;
      state.indoorScore = scores.indoorScore;
      state.environmentType = scores.environmentType;
      state.lastImageUpdate = Date.now();
    } catch (e) {
      console.warn('[environment-analyzer] image sampling failed', e);
    }
  }

  function estimateBrightestDirection(imageData, w, h) {
    const { data } = imageData;
    let maxY = -1, maxX = 0, maxRow = 0;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const idx = (py * w + px) * 4;
        const y = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
        if (y > maxY) { maxY = y; maxX = px; maxRow = py; }
      }
    }
    const dx = (maxX + 0.5) / w - 0.5;
    const dyTop = 1 - (maxRow + 0.5) / h;
    return { azimuthDeg: dx * 100, elevation: dyTop };
  }

  function updateGpsFromPosition(pos) {
    state.latitude = pos.coords.latitude;
    state.longitude = pos.coords.longitude;
    state.altitudeMeters = pos.coords.altitude;
    state.gpsAccuracy = pos.coords.accuracy;
    state.lastGpsUpdate = Date.now();
    updateSun();
  }

  function pollGpsOnce() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      updateGpsFromPosition,
      (err) => { console.warn('[environment-analyzer] GPS error', err.message); },
      { enableHighAccuracy: false, maximumAge: gpsIntervalMs, timeout: 10000 }
    );
  }

  function start() {
    stop();
    imageTimer = setInterval(sampleImageOnce, imageIntervalMs);
    sampleImageOnce();
    if (useGps && navigator.geolocation) {
      pollGpsOnce();
      gpsPollTimer = setInterval(pollGpsOnce, gpsIntervalMs);
    }
  }
  function stop() {
    if (imageTimer) { clearInterval(imageTimer); imageTimer = null; }
    if (gpsPollTimer) { clearInterval(gpsPollTimer); gpsPollTimer = null; }
    if (gpsWatchId != null && navigator.geolocation) { navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; }
  }
  function getState() { return { ...state }; }

  return { start, stop, getState, sampleImageOnce };
}
