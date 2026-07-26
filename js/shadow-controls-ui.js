/* ============================================================
   shadow-controls-ui.js — 影の向き・長さ 手動調整パネル(20260726追加)
   ------------------------------------------------------------
   背景: 影の向き・長さは js/shadow/ 以下(EnvironmentAnalyzer→
   Directional/Environment Shadow)が自動推定しているが、GPS精度や
   輝度重心法の性質上、撮影時に「向きが不自然」「影が伸びすぎ/
   短すぎ」といった破綻が起きる可能性が構造的に残っている
   (ADR-014, VISION_REALISM.md参照)。撮影本番でこれが起きた時に
   困らないよう、向き(azimuth)と長さ(太陽高度ベース)をその場で
   手動固定できる保険としてこのパネルを追加した。

   意図的にオン/オフ(影自体の表示切替)は実装していない
   (2026/07/26 hinya指示: 「オンオフはいらない」)。あくまで
   「自動推定 → 手動固定」の切り替えのみを提供する。既定は常に
   「自動」で、パネルを開いただけでは何も変化しない
   (手動トグルを明示的にオンにして初めてオーバーライドが有効になる)。

   CONSTRAINTS.md「モジュール分割ルール」に従い、main.jsへ直接
   書かずこの独立モジュールとして実装している。依存はShadowRigが
   公開する setShadowDirection/setShadowLength/
   resetShadowManualOverride/getShadowManualState のみで、
   lighting.js/atmosphere.js/postfx.js等へは一切依存しない。
   ============================================================ */

const DEFAULT_AZIMUTH = 0;
const DEFAULT_LENGTH_PERCENT = 50;

/**
 * @param {object} shadowRig js/shadow/shadow-rig.jsのcreateShadowRig()戻り値
 * @returns {{ open: () => void, close: () => void } | null} DOM要素が
 *   見つからない場合(index.html側の対応マークアップが無い場合)はnullを返す。
 */
export function initShadowControlsUI(shadowRig) {
  const openBtn = document.getElementById('shadow-adjust-btn');
  const panel = document.getElementById('shadow-panel');
  const closeBtn = document.getElementById('shadow-panel-close');
  const manualToggle = document.getElementById('shadow-manual-toggle');
  const azimuthSlider = document.getElementById('shadow-azimuth-slider');
  const azimuthVal = document.getElementById('shadow-azimuth-val');
  const lengthSlider = document.getElementById('shadow-length-slider');
  const lengthVal = document.getElementById('shadow-length-val');
  const resetBtn = document.getElementById('shadow-reset-btn');

  if (!openBtn || !panel || !manualToggle || !azimuthSlider || !lengthSlider) {
    // index.html側の対応マークアップが無い場合は静かに無効化する
    // (このモジュール自体が無くてもアプリ本体は問題なく動く設計)。
    console.warn('shadow-controls-ui: 必要なDOM要素が見つからないため無効化します');
    return null;
  }

  let manualEnabled = false;

  function setSlidersEnabled(v) {
    azimuthSlider.disabled = !v;
    lengthSlider.disabled = !v;
  }

  function applyCurrentSlidersToRig() {
    shadowRig.setShadowDirection(Number(azimuthSlider.value));
    shadowRig.setShadowLength(Number(lengthSlider.value));
  }

  function updateAzimuthLabel() {
    azimuthVal.textContent = `${azimuthSlider.value}°`;
  }
  function updateLengthLabel() {
    lengthVal.textContent = lengthSlider.value;
  }

  function setManualEnabled(v) {
    manualEnabled = v;
    manualToggle.textContent = v ? 'オン(手動)' : 'オフ(自動)';
    manualToggle.classList.toggle('on', v);
    setSlidersEnabled(v);
    if (v) {
      applyCurrentSlidersToRig();
    } else {
      shadowRig.resetShadowManualOverride();
    }
  }

  function resetToDefaults() {
    azimuthSlider.value = String(DEFAULT_AZIMUTH);
    lengthSlider.value = String(DEFAULT_LENGTH_PERCENT);
    updateAzimuthLabel();
    updateLengthLabel();
    setManualEnabled(false);
  }

  manualToggle.addEventListener('click', () => setManualEnabled(!manualEnabled));

  azimuthSlider.addEventListener('input', () => {
    updateAzimuthLabel();
    if (manualEnabled) applyCurrentSlidersToRig();
  });
  lengthSlider.addEventListener('input', () => {
    updateLengthLabel();
    if (manualEnabled) applyCurrentSlidersToRig();
  });

  resetBtn && resetBtn.addEventListener('click', resetToDefaults);

  function open() { panel.classList.add('show'); }
  function close() { panel.classList.remove('show'); }

  openBtn.addEventListener('click', () => panel.classList.toggle('show'));
  closeBtn && closeBtn.addEventListener('click', close);

  // 初期表示(常に「自動」から始める)
  updateAzimuthLabel();
  updateLengthLabel();
  setSlidersEnabled(false);

  return { open, close };
}
