/* ============================================================
   js/dev-environment.js — 開発者モード専用モジュール
   ------------------------------------------------------------
   写真素材を使わず、日付・時刻・緯度から太陽の高度/方位角を計算し、
   空の色・DirectionalLight(太陽)・HemisphereLight(環境光)・フォグを
   連動させて「時間帯/季節/場所による光の違い」を体験できるようにする。

   このファイルはdev.html/dev.js専用。main.js(本体アプリ・実カメラ)
   からは参照されず、CONSTRAINTS.mdの禁止事項(AI推論・サーバー通信等)
   にも抵触しない、ブラウザ内の純粋な数式計算のみで完結する。

   【重要な前提・簡略化】
   - 「時刻」は真太陽時(solar time)として扱う。12:00=南中。
     経度による時差(均時差・タイムゾーン)は計算していない。
     このツールの目的は「緯度・季節による太陽軌道の違い」を体験する
     ことであり、経度分の時差を省いても実験の主目的は損なわれない
     という判断（ADR未起票・dev.html限定機能のため）。
   - 大気屈折・地形・雲量は考慮しない、あくまで簡易シミュレーション。
   ============================================================ */
import * as THREE from 'three';

/* ------------------------------------------------------------
   ロケーションプリセット（緯度のみが太陽軌道に影響する）
   ------------------------------------------------------------ */
export const LOCATION_PRESETS = [
  { id: 'tokyo',   label: '東京（北緯35.7°）',            lat: 35.68 },
  { id: 'sapporo', label: '札幌（北緯43.1°）',            lat: 43.06 },
  { id: 'naha',    label: '那覇（北緯26.2°）',            lat: 26.21 },
  { id: 'equator', label: '赤道付近（0°）',               lat: 0.0 },
  { id: 'sydney',  label: 'シドニー（南緯33.9°・季節反転）', lat: -33.87 },
  { id: 'tromso',  label: 'トロムソ（北緯69.6°・白夜/極夜）', lat: 69.65 },
  { id: 'custom',  label: 'カスタム緯度…',                lat: null },
];

/* ------------------------------------------------------------
   太陽位置の計算（簡易版・NOAA近似式ベース）
   戻り値: { altitudeDeg, azimuthDeg }
     altitudeDeg: 地平線からの高度（負値=地平線下）
     azimuthDeg : 真北0°から時計回り（東=90°、南=180°、西=270°）
   ------------------------------------------------------------ */
export function getSunPosition(date, solarHour, latDeg) {
  const dayOfYear = getDayOfYear(date);
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + (solarHour - 12) / 24);

  // 太陽赤緯（ラジアン）
  const decl = 0.006918
    - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);

  const lat = THREE.MathUtils.degToRad(latDeg);
  const hourAngle = THREE.MathUtils.degToRad(15 * (solarHour - 12));

  const sinAlt = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(hourAngle);
  const altitude = Math.asin(THREE.MathUtils.clamp(sinAlt, -1, 1));

  const cosAltLat = Math.cos(altitude) * Math.cos(lat);
  let cosAz = cosAltLat !== 0
    ? (Math.sin(decl) - Math.sin(altitude) * Math.sin(lat)) / cosAltLat
    : 1;
  cosAz = THREE.MathUtils.clamp(cosAz, -1, 1);
  let azimuth = Math.acos(cosAz);
  if (hourAngle > 0) azimuth = 2 * Math.PI - azimuth;

  return {
    altitudeDeg: THREE.MathUtils.radToDeg(altitude),
    azimuthDeg: THREE.MathUtils.radToDeg(azimuth),
  };
}

function getDayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

/* ------------------------------------------------------------
   太陽高度→色/強度のカーブ（演出寄りの簡易近似。厳密な放射輝度計算ではない）
   ------------------------------------------------------------ */
function sunColorFromAltitude(altDeg) {
  const t = THREE.MathUtils.clamp((altDeg + 6) / 30, 0, 1);
  const horizon = new THREE.Color(0xff7a3d);
  const noon = new THREE.Color(0xfff3df);
  return horizon.clone().lerp(noon, t);
}
function sunIntensityFromAltitude(altDeg) {
  if (altDeg <= -6) return 0; // 天文薄明より下は太陽光ゼロ扱い
  const t = THREE.MathUtils.clamp((altDeg + 6) / 40, 0, 1);
  return THREE.MathUtils.lerp(0.05, 1.05, Math.pow(t, 0.6));
}
function skyColorFromAltitude(altDeg) {
  const night = new THREE.Color(0x05070f);
  const twilight = new THREE.Color(0xd98a5f);
  const day = new THREE.Color(0x8fc3ff);
  if (altDeg <= -18) return night.clone();
  if (altDeg <= 0) return night.clone().lerp(twilight, (altDeg + 18) / 18);
  return twilight.clone().lerp(day, THREE.MathUtils.clamp(altDeg / 40, 0, 1));
}
function groundColorFromAltitude(altDeg) {
  const nightGround = new THREE.Color(0x03040a);
  const dayGround = new THREE.Color(0x2a2f26);
  const t = THREE.MathUtils.clamp((altDeg + 6) / 30, 0, 1);
  return nightGround.clone().lerp(dayGround, t);
}

/* ------------------------------------------------------------
   DevEnvironment: シーンの空・太陽・環境光・フォグをまとめて管理
   ------------------------------------------------------------ */
export class DevEnvironment {
  constructor({ scene, sunLight, hemiLight }) {
    this.scene = scene;
    this.sunLight = sunLight;
    this.hemiLight = hemiLight;
    this.fog = new THREE.Fog(0x8fc3ff, 8, 40);
    scene.fog = this.fog;

    this.state = {
      date: new Date(2026, 6, 15), // 月日のみ使用（年は季節計算に無関係）
      solarHour: 12,
      latDeg: 35.68,
    };
  }

  update() {
    const { date, solarHour, latDeg } = this.state;
    const { altitudeDeg, azimuthDeg } = getSunPosition(date, solarHour, latDeg);

    const az = THREE.MathUtils.degToRad(azimuthDeg);
    const alt = THREE.MathUtils.degToRad(altitudeDeg);
    const dist = 20;
    const x = dist * Math.cos(alt) * Math.sin(az);
    const y = dist * Math.sin(alt);
    const z = -dist * Math.cos(alt) * Math.cos(az);
    // 太陽が地平線下でも、光源自体は少し下に置いたままにして
    // 「沈んだ後の残照」的な角度を自然に保つ（極端に潜らせない）
    this.sunLight.position.set(x, Math.max(y, -3), z);

    this.sunLight.intensity = sunIntensityFromAltitude(altitudeDeg);
    this.sunLight.color.copy(sunColorFromAltitude(altitudeDeg));

    const sky = skyColorFromAltitude(altitudeDeg);
    const ground = groundColorFromAltitude(altitudeDeg);
    this.hemiLight.color.copy(sky);
    this.hemiLight.groundColor.copy(ground);
    this.hemiLight.intensity = THREE.MathUtils.lerp(0.15, 0.6, THREE.MathUtils.clamp((altitudeDeg + 6) / 40, 0, 1));

    this.scene.background = sky.clone();
    this.fog.color.copy(sky);

    return { altitudeDeg, azimuthDeg };
  }

  setDate(month, day) { this.state.date = new Date(2026, month - 1, day); }
  setSolarHour(h) { this.state.solarHour = h; }
  setLatitude(lat) { this.state.latDeg = lat; }
}

/* ------------------------------------------------------------
   カラーグレーディング（canvas全体へのCSSフィルタ）
   ------------------------------------------------------------
   モデルだけを個別に色調整するにはMMDトゥーンシェーダーの改造が
   必要でコストが大きい（ADR-006参照：シェーダー変更は要ソース検証）。
   まずは「画全体の色を馴染ませる」手軽な方式（ADR-010の色調統一と
   同じ方向性）として、描画結果(canvas)へCSSフィルタを適用する。
   空も含めて色が変わる点は既知のトレードオフとして明記しておく。
   ------------------------------------------------------------ */
export function applyColorGrade(canvas, { brightness = 1, contrast = 1, saturate = 1, warmth = 0 }) {
  canvas.style.filter =
    `brightness(${brightness}) contrast(${contrast}) saturate(${saturate}) hue-rotate(${warmth}deg)`;
}

/* ------------------------------------------------------------
   UI構築: 場所・日付・時刻・色調整パネルをまとめて生成する
   ------------------------------------------------------------ */
export function buildEnvironmentPanel(container, devEnv, canvas) {
  container.innerHTML = `
    <div class="devenv-head">環境シミュレーション</div>
    <div class="devenv-row">
      <label>場所</label>
      <select id="devenv-location"></select>
    </div>
    <div class="devenv-row" id="devenv-custom-lat-row" style="display:none">
      <label>緯度</label>
      <input type="number" id="devenv-lat" min="-90" max="90" step="0.1" value="35.68">
    </div>
    <div class="devenv-row">
      <label>月/日</label>
      <input type="number" id="devenv-month" min="1" max="12" value="7" style="width:52px">
      <span>/</span>
      <input type="number" id="devenv-day" min="1" max="31" value="15" style="width:52px">
    </div>
    <div class="devenv-row slider-row">
      <label>時刻</label>
      <input type="range" id="devenv-hour" min="0" max="24" step="0.25" value="12">
      <span id="devenv-hour-val">12:00</span>
    </div>
    <div class="devenv-row" id="devenv-sun-info"></div>

    <div class="devenv-head" style="margin-top:14px">色調グレーディング</div>
    <div class="devenv-row slider-row">
      <label>明るさ</label>
      <input type="range" id="devenv-bright" min="0.5" max="1.5" step="0.01" value="1">
      <span id="devenv-bright-val">1.00</span>
    </div>
    <div class="devenv-row slider-row">
      <label>コントラスト</label>
      <input type="range" id="devenv-contrast" min="0.5" max="1.5" step="0.01" value="1">
      <span id="devenv-contrast-val">1.00</span>
    </div>
    <div class="devenv-row slider-row">
      <label>彩度</label>
      <input type="range" id="devenv-saturate" min="0" max="2" step="0.01" value="1">
      <span id="devenv-saturate-val">1.00</span>
    </div>
    <div class="devenv-row slider-row">
      <label>色温度(暖⇄寒)</label>
      <input type="range" id="devenv-warmth" min="-20" max="20" step="1" value="0">
      <span id="devenv-warmth-val">0</span>
    </div>
    <button id="devenv-reset-grade" class="dev-btn" style="margin-top:8px;width:100%">色調をリセット</button>
  `;

  const locSel = container.querySelector('#devenv-location');
  LOCATION_PRESETS.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.label;
    locSel.appendChild(opt);
  });
  locSel.value = 'tokyo';

  const customLatRow = container.querySelector('#devenv-custom-lat-row');
  const latInput = container.querySelector('#devenv-lat');
  const monthInput = container.querySelector('#devenv-month');
  const dayInput = container.querySelector('#devenv-day');
  const hourInput = container.querySelector('#devenv-hour');
  const hourVal = container.querySelector('#devenv-hour-val');
  const sunInfo = container.querySelector('#devenv-sun-info');

  const brightInput = container.querySelector('#devenv-bright');
  const contrastInput = container.querySelector('#devenv-contrast');
  const saturateInput = container.querySelector('#devenv-saturate');
  const warmthInput = container.querySelector('#devenv-warmth');
  const brightVal = container.querySelector('#devenv-bright-val');
  const contrastVal = container.querySelector('#devenv-contrast-val');
  const saturateVal = container.querySelector('#devenv-saturate-val');
  const warmthVal = container.querySelector('#devenv-warmth-val');
  const resetGradeBtn = container.querySelector('#devenv-reset-grade');

  function formatHour(h) {
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  function refreshEnvironment() {
    devEnv.setDate(parseInt(monthInput.value, 10) || 1, parseInt(dayInput.value, 10) || 1);
    devEnv.setSolarHour(parseFloat(hourInput.value));
    const preset = LOCATION_PRESETS.find(p => p.id === locSel.value);
    const lat = preset && preset.lat !== null ? preset.lat : (parseFloat(latInput.value) || 0);
    devEnv.setLatitude(lat);
    const { altitudeDeg, azimuthDeg } = devEnv.update();
    hourVal.textContent = formatHour(parseFloat(hourInput.value));
    const stateLabel = altitudeDeg <= -18 ? '（夜）' : altitudeDeg <= 0 ? '（薄明）' : '';
    sunInfo.textContent = `太陽高度: ${altitudeDeg.toFixed(1)}° / 方位角: ${azimuthDeg.toFixed(0)}° ${stateLabel}`;
  }

  function refreshGrade() {
    applyColorGrade(canvas, {
      brightness: parseFloat(brightInput.value),
      contrast: parseFloat(contrastInput.value),
      saturate: parseFloat(saturateInput.value),
      warmth: parseFloat(warmthInput.value),
    });
    brightVal.textContent = parseFloat(brightInput.value).toFixed(2);
    contrastVal.textContent = parseFloat(contrastInput.value).toFixed(2);
    saturateVal.textContent = parseFloat(saturateInput.value).toFixed(2);
    warmthVal.textContent = warmthInput.value;
  }

  locSel.addEventListener('change', () => {
    customLatRow.style.display = locSel.value === 'custom' ? '' : 'none';
    refreshEnvironment();
  });
  [monthInput, dayInput, hourInput, latInput].forEach(el => el.addEventListener('input', refreshEnvironment));
  [brightInput, contrastInput, saturateInput, warmthInput].forEach(el => el.addEventListener('input', refreshGrade));
  resetGradeBtn.addEventListener('click', () => {
    brightInput.value = 1; contrastInput.value = 1; saturateInput.value = 1; warmthInput.value = 0;
    refreshGrade();
  });

  refreshEnvironment();
  refreshGrade();
}
