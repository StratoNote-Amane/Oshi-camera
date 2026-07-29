/* ============================================================
   shadow-controls-ui.js — 影の向き・長さ 手動調整パネル(ADR-016改訂)
   ------------------------------------------------------------
   【変更点】旧版はスライダー2本(向き/長さ)+トグルの計3操作だった。
   「もっと簡単に」というhinya指示を受け、円形パッド内でハンドル
   (太陽の印)をドラッグするだけで、向き(角度)と長さ(中心からの距離)を
   1つのジェスチャーで同時に決められる方式へ全面変更した。

   角度の基準: パッド上部(12時の方向)を0°とし、時計回りに-180〜180°で
   表す。この値をそのままshadowRig.setShadowDirection(deg)へ渡す
   (directional-shadow.js側の期待値レンジ-180〜180と一致)。
   距離の基準: パッド中心=0(影が短い/太陽が高い)、パッド外周=100
   (影が長い/太陽が低い)。shadowRig.setShadowLength(0〜100)へそのまま渡す
   (shadow-rig.js側で太陽高度88〜4度への変換を担う、ここでは変換しない)。

   意図的にオン/オフ(影自体の表示切替)は実装していない(2026/07/26
   hinya指示、旧版から継続)。既定は常に「自動」で、パネルを開いただけ
   では何も変化しない(手動トグルを明示的にオンにして初めてオーバーライド
   が有効になる)。

   CONSTRAINTS.md「モジュール分割ルール」に従い、main.jsへ直接書かず
   この独立モジュールとして実装している。依存はShadowRigが公開する
   setShadowDirection/setShadowLength/resetShadowManualOverride/
   getShadowManualState のみ。
   ============================================================ */

const DEFAULT_AZIMUTH = 0;
const DEFAULT_LENGTH_PERCENT = 0; // 中心(短い)から開始

/**
 * @param {object} shadowRig js/shadow/shadow-rig.jsのcreateShadowRig()戻り値
 * @returns {{ open: () => void, close: () => void } | null}
 */
export function initShadowControlsUI(shadowRig) {
  const openBtn = document.getElementById('shadow-adjust-btn');
  const panel = document.getElementById('shadow-panel');
  const closeBtn = document.getElementById('shadow-panel-close');
  const manualToggle = document.getElementById('shadow-manual-toggle');
  const resetBtn = document.getElementById('shadow-reset-btn');
  const dial = document.getElementById('shadow-dial');
  const handle = document.getElementById('shadow-dial-handle');

  if (!openBtn || !panel || !manualToggle || !dial || !handle) {
    console.warn('shadow-controls-ui: 必要なDOM要素が見つからないため無効化します');
    return null;
  }

  const DIAL_RADIUS_PX = 78; // ハンドルが動ける中心からの最大距離(パッド半径176/2から余白を引いた値)

  let manualEnabled = false;
  let azimuthDeg = DEFAULT_AZIMUTH;
  let lengthPercent = DEFAULT_LENGTH_PERCENT;

  function placeHandle(dxPx, dyPx) {
    handle.style.transform = `translate(${dxPx}px, ${dyPx}px)`;
  }

  function applyToRig() {
    shadowRig.setShadowDirection(azimuthDeg);
    shadowRig.setShadowLength(lengthPercent);
  }

  /** azimuthDeg(-180〜180、上=0、時計回り)+lengthPercent(0〜100)から、
   *  パッド上のハンドル座標(px, 中心基準)を逆算して表示位置を合わせる。 */
  function syncHandleFromValues() {
    const rad = (azimuthDeg * Math.PI) / 180;
    const dist = (lengthPercent / 100) * DIAL_RADIUS_PX;
    const dx = Math.sin(rad) * dist;
    const dy = -Math.cos(rad) * dist;
    placeHandle(dx, dy);
  }

  function setManualEnabled(v) {
    manualEnabled = v;
    manualToggle.textContent = v ? 'オン(手動)' : 'オフ(自動)';
    manualToggle.classList.toggle('on', v);
    dial.classList.toggle('disabled', !v);
    if (v) {
      applyToRig();
    } else {
      shadowRig.resetShadowManualOverride();
    }
  }

  function resetToDefaults() {
    azimuthDeg = DEFAULT_AZIMUTH;
    lengthPercent = DEFAULT_LENGTH_PERCENT;
    syncHandleFromValues();
    setManualEnabled(false);
  }

  manualToggle.addEventListener('click', () => setManualEnabled(!manualEnabled));
  resetBtn && resetBtn.addEventListener('click', resetToDefaults);

  /* ---- ドラッグ操作: パッド中心からの座標→角度(azimuth)・距離(length) ---- */
  let dragging = false;

  function updateFromPointer(clientX, clientY) {
    const rect = dial.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const dist = Math.min(Math.hypot(dx, dy), DIAL_RADIUS_PX);

    // 中心ぴったり(または極めて近い位置)では、atan2(0,-0)が180°を返す浮動小数点の
    // 仕様上の癖があり、「タップしただけなのに向きが真後ろへ飛ぶ」ように見える不具合が
    // テストで見つかった。長さがほぼ0の間は向きに意味がない(短い影に向きは無い)ため、
    // このケースでは向きの値を更新せず、直前の向きをそのまま保持する。
    const CENTER_DEADZONE_PX = 2;
    if (dist > CENTER_DEADZONE_PX) {
      azimuthDeg = (Math.atan2(dx, -dy) * 180) / Math.PI; // -180〜180
    }
    lengthPercent = (dist / DIAL_RADIUS_PX) * 100;

    const angleRad = (azimuthDeg * Math.PI) / 180;
    const clampedDx = Math.sin(angleRad) * dist;
    const clampedDy = -Math.cos(angleRad) * dist;
    placeHandle(clampedDx, clampedDy);

    if (manualEnabled) applyToRig();
  }

  dial.addEventListener('pointerdown', (e) => {
    if (dial.classList.contains('disabled')) return;
    dragging = true;
    dial.setPointerCapture(e.pointerId);
    updateFromPointer(e.clientX, e.clientY);
  });
  dial.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    updateFromPointer(e.clientX, e.clientY);
  });
  ['pointerup', 'pointercancel'].forEach((ev) => {
    dial.addEventListener(ev, () => { dragging = false; });
  });

  function open() { panel.classList.add('show'); }
  function close() { panel.classList.remove('show'); }

  openBtn.addEventListener('click', () => panel.classList.toggle('show'));
  closeBtn && closeBtn.addEventListener('click', close);

  // 初期表示(常に「自動」から始める)
  syncHandleFromValues();
  setManualEnabled(false);

  return { open, close };
}
