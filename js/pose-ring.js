// js/pose-ring.js — v2「呼吸するカプセル」型ポーズ/表情セレクター
// ------------------------------------------------------------
// 旧実装(扇形リング、v1)は項目数が増えると窮屈になりやすく、UI一新の
// 一環としてカプセル型のスワイプ/タップセレクターへ全面書き換えた。
//
// 【重要】main.js側は一切変更していない。main.jsが呼ぶ公開APIの形
//   window.PoseRing.init(categoryList, onSelectCallback)
//   window.PoseRing.setActive(categoryKey, itemKey)
//   window.PoseRing.syncPosition()
// をそのまま維持しているため、main.jsのbuildPoseRing()はこのファイルの
// 内部実装が変わったことを一切意識せずに動く。
//
// 操作方法（斬新な操作方法歓迎、との方針を反映）:
//   - カプセル中央を左右にスワイプ → 次/前の項目へ
//   - 矢印(‹ ›)をタップ → 同じく次/前へ(親指1本の片手操作用フォールバック)
//   - 左端の「ポーズ/表情」タブをタップ → カテゴリを切り替え
(function () {
  let cats = [];
  let catIdx = 0;
  let onSelect = null;

  let elChip, elLabelSpan, elPrev, elNext, elCurrent, elEmoji, elRingLabel;

  function currentCat() {
    return cats[catIdx];
  }

  function showLabel(text) {
    if (!elRingLabel) return;
    elRingLabel.textContent = text;
    elRingLabel.classList.add('show');
    clearTimeout(elRingLabel._t);
    elRingLabel._t = setTimeout(() => elRingLabel.classList.remove('show'), 1000);
  }

  /**
   * 現在の項目を(必要ならスライドアニメーション付きで)表示に反映する。
   * @param {'l'|'r'|null} direction スワイプ/タップの方向。nullなら
   *   アニメーションなしで即座に反映する(初期表示・カテゴリ切替用)。
   */
  function renderCurrent(direction) {
    const cat = currentCat();
    if (!cat || !cat.items.length) {
      if (elEmoji) elEmoji.textContent = '';
      return;
    }
    const item = cat.items[cat.sel];
    if (!elEmoji) return;

    if (!direction) {
      elEmoji.textContent = item.emoji;
      return;
    }
    const outClass = direction === 'l' ? 'slide-out-l' : 'slide-out-r';
    elEmoji.classList.remove('slide-in');
    elEmoji.classList.add(outClass);
    setTimeout(() => {
      elEmoji.textContent = item.emoji;
      elEmoji.classList.remove(outClass);
      elEmoji.classList.add('slide-in');
    }, 120);
  }

  function selectIndex(newIdx, direction) {
    const cat = currentCat();
    if (!cat || !cat.items.length) return;
    const n = cat.items.length;
    newIdx = ((newIdx % n) + n) % n;
    cat.sel = newIdx;
    renderCurrent(direction);
    const item = cat.items[newIdx];
    showLabel(item.emoji + ' ' + item.label);
    if (typeof onSelect === 'function') onSelect(cat.key, item.key, item);
  }

  function step(delta) {
    const cat = currentCat();
    if (!cat) return;
    selectIndex(cat.sel + delta, delta > 0 ? 'r' : 'l');
  }

  function cycleCategory() {
    if (cats.length < 2) return;
    catIdx = (catIdx + 1) % cats.length;
    if (elLabelSpan) elLabelSpan.textContent = cats[catIdx].label;
    renderCurrent(null);
    const cat = currentCat();
    if (cat && cat.items.length) showLabel(cat.label + ': ' + cat.items[cat.sel].emoji + ' ' + cat.items[cat.sel].label);
  }

  /* --- スワイプ検出(カプセル中央のみが対象。カメラ映像側のジェスチャーとは
     完全に独立したDOM要素なので、main.jsの1本指ドラッグ等とは競合しない) --- */
  const SWIPE_THRESHOLD_PX = 26;
  let swipeStartX = 0;
  let swipeActive = false;

  function attachSwipe(el) {
    if (!el) return;
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      swipeActive = true;
      swipeStartX = e.touches[0].clientX;
    }, { passive: true });
    el.addEventListener('touchend', (e) => {
      if (!swipeActive) return;
      swipeActive = false;
      const endX = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientX : swipeStartX;
      const dx = endX - swipeStartX;
      if (Math.abs(dx) >= SWIPE_THRESHOLD_PX) step(dx < 0 ? 1 : -1);
    }, { passive: true });
    // マウス操作(dev環境等)でも一応使えるようにフォールバック
    let mouseStartX = null;
    el.addEventListener('mousedown', (e) => { mouseStartX = e.clientX; });
    el.addEventListener('mouseup', (e) => {
      if (mouseStartX == null) return;
      const dx = e.clientX - mouseStartX;
      mouseStartX = null;
      if (Math.abs(dx) >= SWIPE_THRESHOLD_PX) step(dx < 0 ? 1 : -1);
    });
  }

  function init(categoryList, onSelectCallback) {
    cats = categoryList.map((c) => Object.assign({ sel: 0 }, c));
    catIdx = 0;
    onSelect = onSelectCallback || null;

    elChip = document.getElementById('cat-chip');
    elLabelSpan = document.getElementById('cat-label');
    elPrev = document.getElementById('dock-prev');
    elNext = document.getElementById('dock-next');
    elCurrent = document.getElementById('dock-current');
    elEmoji = document.getElementById('dock-emoji');
    elRingLabel = document.getElementById('ring-label');

    if (elLabelSpan && cats[0]) elLabelSpan.textContent = cats[0].label;
    if (elChip) elChip.addEventListener('click', cycleCategory);
    if (elPrev) elPrev.addEventListener('click', () => step(-1));
    if (elNext) elNext.addEventListener('click', () => step(1));
    attachSwipe(elCurrent);

    renderCurrent(null);
  }

  /** main.js以外から選択状態を外部同期したい場合用(現状呼び出し元なし、互換維持)。 */
  function setActive(categoryKey, itemKey) {
    const cat = cats.find((c) => c.key === categoryKey);
    if (!cat) return;
    const idx = cat.items.findIndex((it) => it.key === itemKey);
    if (idx < 0) return;
    cat.sel = idx;
    if (cats[catIdx] === cat) renderCurrent(null);
  }

  /** v1はSVGリングの絶対位置をシャッター実測位置に合わせていたが、
   * v2はカプセルが#bottom-controlsのflexレイアウトに乗っているだけなので
   * 位置合わせのJS計算は不要になった。API互換のためだけに残す no-op。 */
  function syncPosition() {}

  window.PoseRing = { init, setActive, syncPosition };
})();
