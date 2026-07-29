// js/pose-ring.js — v3「呼吸するカプセル」+ ドット・インジケータ(ADR-016)
// ------------------------------------------------------------
// v2(カプセル型スワイプ/タップセレクター)の内部実装はそのまま維持し、
// 「今どこにいるか」を分かりやすくするため、カプセル下部に現在位置を
// 示すドットのインジケータ(#dock-dots)を追加した。
//
// 【重要】main.js側は一切変更していない。main.jsが呼ぶ公開APIの形
//   window.PoseRing.init(categoryList, onSelectCallback)
//   window.PoseRing.setActive(categoryKey, itemKey)
//   window.PoseRing.syncPosition()
// をそのまま維持しているため、main.jsのbuildPoseRing()はこのファイルの
// 内部実装が変わったことを一切意識せずに動く。#dock-dots要素が
// index.html側に存在しない場合も静かに無効化されるだけで、他の動作には
// 影響しない(既存挙動を壊さない設計)。
//
// 操作方法(v2から変更なし):
//   - カプセル中央を左右にスワイプ → 次/前の項目へ
//   - 矢印(‹ ›)をタップ → 同じく次/前へ
//   - 左端の「ポーズ/表情」タブをタップ → カテゴリを切り替え
(function () {
  let cats = [];
  let catIdx = 0;
  let onSelect = null;

  let elChip, elLabelSpan, elPrev, elNext, elCurrent, elEmoji, elRingLabel, elDots;

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

  /** 現在のカテゴリの項目数に合わせてドットを作り直し、選択中の項目を光らせる。 */
  function renderDots() {
    if (!elDots) return;
    const cat = currentCat();
    elDots.innerHTML = '';
    if (!cat || cat.items.length <= 1) return; // 1個以下ならドット自体を出さない
    cat.items.forEach((_, i) => {
      const dot = document.createElement('span');
      if (i === cat.sel) dot.classList.add('active');
      elDots.appendChild(dot);
    });
  }

  function updateActiveDot() {
    if (!elDots) return;
    const cat = currentCat();
    if (!cat) return;
    Array.from(elDots.children).forEach((dot, i) => dot.classList.toggle('active', i === cat.sel));
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
    updateActiveDot();
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
    renderDots();
    const cat = currentCat();
    if (cat && cat.items.length) showLabel(cat.label + ': ' + cat.items[cat.sel].emoji + ' ' + cat.items[cat.sel].label);
  }

  /* --- スワイプ検出 --- */
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
    elDots = document.getElementById('dock-dots');

    if (elLabelSpan && cats[0]) elLabelSpan.textContent = cats[0].label;
    if (elChip) elChip.addEventListener('click', cycleCategory);
    if (elPrev) elPrev.addEventListener('click', () => step(-1));
    if (elNext) elNext.addEventListener('click', () => step(1));
    attachSwipe(elCurrent);

    renderCurrent(null);
    renderDots();
  }

  /** main.js以外から選択状態を外部同期したい場合用(現状呼び出し元なし、互換維持)。 */
  function setActive(categoryKey, itemKey) {
    const cat = cats.find((c) => c.key === categoryKey);
    if (!cat) return;
    const idx = cat.items.findIndex((it) => it.key === itemKey);
    if (idx < 0) return;
    cat.sel = idx;
    if (cats[catIdx] === cat) { renderCurrent(null); updateActiveDot(); }
  }

  /** v1はSVGリングの絶対位置をシャッター実測位置に合わせていたが、
   * v2/v3はカプセルが#bottom-controlsのflexレイアウトに乗っているだけなので
   * 位置合わせのJS計算は不要。API互換のためだけに残すno-op。 */
  function syncPosition() {}

  window.PoseRing = { init, setActive, syncPosition };
})();
