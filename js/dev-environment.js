/* ============================================================
   js/dev-environment.js — 開発者モード専用モジュール(v2)
   ------------------------------------------------------------
   写真素材を使わず、日付・時刻・緯度から太陽の高度/方位角を計算し、
   空のグラデーション・地面の色(場所×季節)・太陽光/環境光を連動させる。
   「よりリアルな場所での仮想実験」を目的に、場所ごとの地面色(biome)と
   季節による雪化粧を追加した。

   v2での変更点:
   - キャラクター単独の色調グレーディングを実現するため、背景用と
     キャラクター用でシーン/キャンバスを分離する設計に対応
     (このモジュールは backgroundScene のみを担当し、
      characterSceneへは光源(sunLight/hemiLight)だけを反映する)
   - 空を単色からグラデーション(天頂色→地平線色)へ強化
   - 場所プリセットに biome(地面の種類)を追加、季節による雪化粧に対応
   - 日付はDateオブジェクト1つで扱う(呼び出し側はinput type="date"の
     文字列をそのまま渡せる)

   このファイルはdev.html/dev.js専用。main.js(本体アプリ・実カメラ)
   からは参照されない。
   ============================================================ */
import * as THREE from 'three';

/* ------------------------------------------------------------
   ロケーションプリセット
   ------------------------------------------------------------
   lat: 太陽軌道の計算に使う緯度
   biome: 地面の色を決める簡易カテゴリ（実在の地形再現ではなく、
          「その場所らしい色味」を出すための大まかな分類）
   ------------------------------------------------------------ */
export const LOCATION_PRESETS = [
  { id: 'tokyo',   label: '東京（都市・北緯35.7°）',           lat: 35.68,  biome: 'urban' },
  { id: 'sapporo', label: '札幌（積雪地・北緯43.1°）',         lat: 43.06,  biome: 'temperate' },
  { id: 'naha',    label: '那覇（海岸・北緯26.2°）',           lat: 26.21,  biome: 'coastal' },
  { id: 'equator', label: '赤道付近（熱帯・0°）',              lat: 0.0,    biome: 'equatorial' },
  { id: 'sydney',  label: 'シドニー（南半球・季節反転）',       lat: -33.87, biome: 'temperate' },
  { id: 'tromso',  label: 'トロムソ（極域・白夜/極夜）',       lat: 69.65,  biome: 'polar' },
  { id: 'custom',  label: 'カスタム緯度…',                    lat: null,   biome: 'temperate' },
];

const BIOME_GROUND = {
  urban:      { day: 0x6d7178, night: 0x14161c },
  coastal:    { day: 0xd9c9a2, night: 0x171b1f },
  equatorial: { day: 0x3f7a3a, night: 0x0c130c },
  polar:      { day: 0xe9edf1, night: 0x1c212a },
  temperate:  { day: 0x4c7a3d, night: 0x10160f },
};
const SNOW_COLOR = new THREE.Color(0xeef2f6);

/* ------------------------------------------------------------
   太陽位置の計算（簡易版・NOAA近似式ベース）
   ------------------------------------------------------------
   「時刻」は真太陽時(solar time)として扱う。12:00=南中。経度による
   時差(均時差・タイムゾーン)は考慮しない。緯度・季節による太陽軌道の
   違いを体験することが目的であり、簡略化しても実験の主目的は
   損なわれないという判断（dev.html限定機能）。
   戻り値: { altitudeDeg, azimuthDeg }
   ------------------------------------------------------------ */
export function getSunPosition(date, solarHour, latDeg) {
  const dayOfYear = getDayOfYear(date);
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + (solarHour - 12) / 24);

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

/* 北半球基準の月→季節。南半球(lat<0)は半年ずらして反転させる。 */
export function seasonLabel(month, latDeg) {
  const northSeasons = ['冬', '冬', '春', '春', '春', '夏', '夏', '夏', '秋', '秋', '秋', '冬'];
  if (latDeg >= 0) return northSeasons[month - 1];
  const flip = { '春': '秋', '夏': '冬', '秋': '春', '冬': '夏' };
  return flip[northSeasons[month - 1]];
}
function isWinterMonth(month, latDeg) {
  const northernWinter = month === 12 || month === 1 || month === 2;
  const southernWinter = month === 6 || month === 7 || month === 8;
  return latDeg >= 0 ? northernWinter : southernWinter;
}

/* ------------------------------------------------------------
   太陽高度→色/強度のカーブ（演出寄りの簡易近似）
   ------------------------------------------------------------ */
function sunColorFromAltitude(altDeg) {
  const t = THREE.MathUtils.clamp((altDeg + 6) / 30, 0, 1);
  return new THREE.Color(0xff7a3d).lerp(new THREE.Color(0xfff3df), t);
}
function sunIntensityFromAltitude(altDeg) {
  if (altDeg <= -6) return 0;
  const t = THREE.MathUtils.clamp((altDeg + 6) / 40, 0, 1);
  return THREE.MathUtils.lerp(0.05, 1.05, Math.pow(t, 0.6));
}
function skyGradientFromAltitude(altDeg) {
  const night = { zenith: 0x05060d, horizon: 0x0a0d16 };
  const twilight = { zenith: 0x3a3a63, horizon: 0xe08a55 };
  const day = { zenith: 0x3f7fd9, horizon: 0xbfe0ff };
  let zenith, horizon;
  if (altDeg <= -18) {
    zenith = new THREE.Color(night.zenith); horizon = new THREE.Color(night.horizon);
  } else if (altDeg <= 0) {
    const t = (altDeg + 18) / 18;
    zenith = new THREE.Color(night.zenith).lerp(new THREE.Color(twilight.zenith), t);
    horizon = new THREE.Color(night.horizon).lerp(new THREE.Color(twilight.horizon), t);
  } else {
    const t = THREE.MathUtils.clamp(altDeg / 40, 0, 1);
    zenith = new THREE.Color(twilight.zenith).lerp(new THREE.Color(day.zenith), t);
    horizon = new THREE.Color(twilight.horizon).lerp(new THREE.Color(day.horizon), t);
  }
  return { zenith, horizon };
}
function groundColorForBiome(biome, month, latDeg, altDeg) {
  const table = BIOME_GROUND[biome] || BIOME_GROUND.temperate;
  let base = new THREE.Color(table.day);
  if ((biome === 'polar' || biome === 'temperate') && isWinterMonth(month, latDeg)) {
    base = SNOW_COLOR.clone().lerp(base, biome === 'polar' ? 0.08 : 0.25);
  }
  const night = new THREE.Color(table.night);
  const t = THREE.MathUtils.clamp((altDeg + 6) / 30, 0, 1);
  return night.lerp(base, t);
}

/* ------------------------------------------------------------
   空グラデーションのCanvasTextureを生成
   ------------------------------------------------------------ */
function makeSkyTexture(zenith, horizon) {
  const canvas = document.createElement('canvas');
  canvas.width = 2; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, `#${zenith.getHexString()}`);
  grad.addColorStop(1, `#${horizon.getHexString()}`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ------------------------------------------------------------
   DevEnvironment
   ------------------------------------------------------------
   backgroundScene: 空(background)・地面・フォグを保持する専用シーン
   characterScene : キャラクター表示用シーン。太陽/環境光のみここに反映する
   （このクラスはcharacterScene側にメッシュを追加しない）
   ------------------------------------------------------------ */
export class DevEnvironment {
  constructor({ backgroundScene, sunLight, hemiLight }) {
    this.backgroundScene = backgroundScene;
    this.sunLight = sunLight;
    this.hemiLight = hemiLight;

    this.fog = new THREE.Fog(0x8fc3ff, 10, 42);
    backgroundScene.fog = this.fog;

    const groundGeo = new THREE.CircleGeometry(9, 48);
    this.groundMat = new THREE.MeshBasicMaterial({ color: 0x4c7a3d, fog: true });
    this.groundMesh = new THREE.Mesh(groundGeo, this.groundMat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.position.y = -0.015; // グリッド線とのz-fighting回避
    backgroundScene.add(this.groundMesh);

    this.skyTexture = null;

    this.state = {
      date: new Date(2026, 6, 15),
      solarHour: 12,
      latDeg: 35.68,
      biome: 'urban',
    };
  }

  update() {
    const { date, solarHour, latDeg, biome } = this.state;
    const month = date.getMonth() + 1;
    const { altitudeDeg, azimuthDeg } = getSunPosition(date, solarHour, latDeg);

    const az = THREE.MathUtils.degToRad(azimuthDeg);
    const alt = THREE.MathUtils.degToRad(altitudeDeg);
    const dist = 20;
    const x = dist * Math.cos(alt) * Math.sin(az);
    const y = dist * Math.sin(alt);
    const z = -dist * Math.cos(alt) * Math.cos(az);
    this.sunLight.position.set(x, Math.max(y, -3), z);
    this.sunLight.intensity = sunIntensityFromAltitude(altitudeDeg);
    this.sunLight.color.copy(sunColorFromAltitude(altitudeDeg));

    const { zenith, horizon } = skyGradientFromAltitude(altitudeDeg);
    if (this.skyTexture) this.skyTexture.dispose();
    this.skyTexture = makeSkyTexture(zenith, horizon);
    this.backgroundScene.background = this.skyTexture;
    this.fog.color.copy(horizon);

    this.hemiLight.color.copy(zenith);
    this.hemiLight.groundColor.copy(horizon);
    this.hemiLight.intensity = THREE.MathUtils.lerp(0.15, 0.6, THREE.MathUtils.clamp((altitudeDeg + 6) / 40, 0, 1));

    this.groundMat.color.copy(groundColorForBiome(biome, month, latDeg, altitudeDeg));

    return { altitudeDeg, azimuthDeg, month, season: seasonLabel(month, latDeg) };
  }

  setDateFromInput(dateStr) {
    // <input type="date">の"YYYY-MM-DD"を受け取る。年は季節計算に使わないため無視してよい。
    const [, m, d] = dateStr.split('-').map((v) => parseInt(v, 10));
    this.state.date = new Date(2026, (m || 1) - 1, d || 1);
  }
  setSolarHour(h) { this.state.solarHour = h; }
  setLocation(latDeg, biome) { this.state.latDeg = latDeg; this.state.biome = biome; }
}

/* ------------------------------------------------------------
   カラーグレーディング（モデル専用キャンバスへのCSSフィルタ）
   ------------------------------------------------------------
   背景と分離したキャンバスにのみ適用することで、「モデルの色調だけ」
   を独立して調整できるようにしている（背景側キャンバスには一切適用しない）。
   ------------------------------------------------------------ */
export function applyColorGrade(canvas, { brightness = 1, contrast = 1, saturate = 1, warmth = 0 }) {
  canvas.style.filter =
    `brightness(${brightness}) contrast(${contrast}) saturate(${saturate}) hue-rotate(${warmth}deg)`;
}

/* ------------------------------------------------------------
   UI構築(1): 環境タブの中身（場所・日付・時刻）
   ------------------------------------------------------------ */
export function buildEnvironmentControls(container, devEnv) {
  container.innerHTML = `
    <div class="dsp-row">
      <label>場所</label>
      <select id="devenv-location"></select>
    </div>
    <div class="dsp-row" id="devenv-custom-lat-row" style="display:none">
      <label>緯度</label>
      <input type="number" id="devenv-lat" min="-90" max="90" step="0.1" value="35.68">
    </div>
    <div class="dsp-row">
      <label>日付</label>
      <input type="date" id="devenv-date" value="2026-07-15">
    </div>
    <div class="dsp-row dsp-slider-row">
      <label>時刻</label>
      <input type="range" id="devenv-hour" min="0" max="24" step="0.25" value="12">
      <span id="devenv-hour-val">12:00</span>
    </div>
    <div class="dsp-info" id="devenv-sun-info"></div>
  `;

  const locSel = container.querySelector('#devenv-location');
  LOCATION_PRESETS.forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.label;
    locSel.appendChild(opt);
  });
  locSel.value = 'tokyo';

  const customLatRow = container.querySelector('#devenv-custom-lat-row');
  const latInput = container.querySelector('#devenv-lat');
  const dateInput = container.querySelector('#devenv-date');
  const hourInput = container.querySelector('#devenv-hour');
  const hourVal = container.querySelector('#devenv-hour-val');
  const sunInfo = container.querySelector('#devenv-sun-info');

  function formatHour(h) {
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  function refresh() {
    const preset = LOCATION_PRESETS.find((p) => p.id === locSel.value);
    const lat = preset && preset.lat !== null ? preset.lat : (parseFloat(latInput.value) || 0);
    const biome = preset ? preset.biome : 'temperate';
    devEnv.setDateFromInput(dateInput.value);
    devEnv.setSolarHour(parseFloat(hourInput.value));
    devEnv.setLocation(lat, biome);
    const { altitudeDeg, azimuthDeg, season } = devEnv.update();
    hourVal.textContent = formatHour(parseFloat(hourInput.value));
    const stateLabel = altitudeDeg <= -18 ? '夜' : altitudeDeg <= 0 ? '薄明' : '日中';
    sunInfo.textContent =
      `${season} / ${stateLabel}　太陽高度 ${altitudeDeg.toFixed(1)}°・方位角 ${azimuthDeg.toFixed(0)}°`;
  }

  locSel.addEventListener('change', () => {
    customLatRow.style.display = locSel.value === 'custom' ? '' : 'none';
    refresh();
  });
  [dateInput, hourInput, latInput].forEach((el) => el.addEventListener('input', refresh));

  refresh();
}

/* ------------------------------------------------------------
   UI構築(2): 色調タブの中身（明るさ・コントラスト・彩度・色温度）
   ------------------------------------------------------------ */
export function buildColorGradePanel(container, canvas) {
  container.innerHTML = `
    <div class="dsp-info" style="margin-bottom:10px">この調整はモデルにのみ適用され、背景には影響しません。</div>
    <div class="dsp-row dsp-slider-row">
      <label>明るさ</label>
      <input type="range" id="devenv-bright" min="0.5" max="1.5" step="0.01" value="1">
      <span id="devenv-bright-val">1.00</span>
    </div>
    <div class="dsp-row dsp-slider-row">
      <label>コントラスト</label>
      <input type="range" id="devenv-contrast" min="0.5" max="1.5" step="0.01" value="1">
      <span id="devenv-contrast-val">1.00</span>
    </div>
    <div class="dsp-row dsp-slider-row">
      <label>彩度</label>
      <input type="range" id="devenv-saturate" min="0" max="2" step="0.01" value="1">
      <span id="devenv-saturate-val">1.00</span>
    </div>
    <div class="dsp-row dsp-slider-row">
      <label>色温度</label>
      <input type="range" id="devenv-warmth" min="-20" max="20" step="1" value="0">
      <span id="devenv-warmth-val">0</span>
    </div>
    <button id="devenv-reset-grade" class="dsp-btn">色調をリセット</button>
  `;

  const brightInput = container.querySelector('#devenv-bright');
  const contrastInput = container.querySelector('#devenv-contrast');
  const saturateInput = container.querySelector('#devenv-saturate');
  const warmthInput = container.querySelector('#devenv-warmth');
  const brightVal = container.querySelector('#devenv-bright-val');
  const contrastVal = container.querySelector('#devenv-contrast-val');
  const saturateVal = container.querySelector('#devenv-saturate-val');
  const warmthVal = container.querySelector('#devenv-warmth-val');
  const resetBtn = container.querySelector('#devenv-reset-grade');

  function refresh() {
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

  [brightInput, contrastInput, saturateInput, warmthInput].forEach((el) => el.addEventListener('input', refresh));
  resetBtn.addEventListener('click', () => {
    brightInput.value = 1; contrastInput.value = 1; saturateInput.value = 1; warmthInput.value = 0;
    refresh();
  });

  refresh();
}
