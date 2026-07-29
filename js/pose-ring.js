// js/pose-ring.js — 「常時表示の複数リング」方式(2026/08改訂)
// ------------------------------------------------------------
// 【変更の経緯】旧版はカプセル1個をcat-chipで「ポーズ⇄表情」タブ切替する
// 方式だったが、「表情の操作がどこにあるか分からない」という声を受け、
// カテゴリごとに専用の行を常時表示する構成へ変更した(タブ切替自体を廃止)。
//
// 【重要】main.js側は一切変更していない。main.jsが呼ぶ公開APIの形
//   window.PoseRing.init(categoryList, onSelectCallback)
//   window.PoseRing.setActive(categoryKey, itemKey)
//   window.PoseRing.syncPosition()
// をそのまま維持しているため、main.jsのbuildPoseRing()はこのファイルの
// 内部実装が変わったことを一切意識せずに動く。
//
// レイアウトはindex.html側の #pose-rings (空のコンテナ)へ、
// カテゴリの数だけ行(.pose-ring-row)を動的に生成して差し込む。
//
// 操作方法(カテゴリごとの各行で共通):
//   - カプセル中央を左右にスワイプ → 次/前の項目へ
//   - 矢印(‹ ›)をタップ → 同じく次/前へ
(function () {
  let cats = [];
  let onSelect = null;
  let elRingLabel = null;
  let rootEl = null;

  function showLabel(text) {
    if (!elRingLabel) return;
    elRingLabel.textContent = text;
    elRingLabel.classList.add('show');
    clearTimeout(elRingLabel._t);
    elRingLabel._t = setTimeout(() => elRingLabel.classList.remove('show'), 1000);
  }

  /** 現在のカテゴリの項目数に合わせてドットを作り直し、選択中の項目を光らせる。 */
  function renderDots(cat) {
    if (!cat.dotsEl) return;
    cat.dotsEl.innerHTML = '';
    if (cat.items.length <= 1) return; // 1個以下ならドット自体を出さない
    cat.items.forEach((_, i) => {
      const dot = document.createElement('span');
      if (i === cat.sel) dot.classList.add('active');
      cat.dotsEl.appendChild(dot);
    });
  }

  function updateActiveDot(cat) {
    if (!cat.dotsEl) return;
    Array.from(cat.dotsEl.children).forEach((dot, i) => dot.classList.toggle('active', i === cat.sel));
  }

  /**
   * 現在の項目を(必要ならスライドアニメーション付きで)表示に反映する。
   * @param {object} cat
   * @param {'l'|'r'|null} direction スワイプ/タップの方向。nullなら
   *   アニメーションなしで即座に反映する(初期表示用)。
   */
  function renderCurrent(cat, direction) {
    if (!cat.items.length) {
      if (cat.emojiEl) cat.emojiEl.textContent = '';
      return;
    }
    const item = cat.items[cat.sel];
    if (!cat.emojiEl) return;

    if (!direction) {
      cat.emojiEl.textContent = item.emoji;
      return;
    }
    const outClass = direction === 'l' ? 'slide-out-l' : 'slide-out-r';
    cat.emojiEl.classList.remove('slide-in');
    cat.emojiEl.classList.add(outClass);
    setTimeout(() => {
      cat.emojiEl.textContent = item.emoji;
      cat.emojiEl.classList.remove(outClass);
      cat.emojiEl.classList.add('slide-in');
    }, 120);
  }

  function selectIndex(cat, newIdx, direction) {
    if (!cat.items.length) return;
    const n = cat.items.length;
    newIdx = ((newIdx % n) + n) % n;
    cat.sel = newIdx;
    renderCurrent(cat, direction);
    updateActiveDot(cat);
    const item = cat.items[newIdx];
    showLabel(item.emoji + ' ' + item.label);
    if (typeof onSelect === 'function') onSelect(cat.key, item.key, item);
  }

  function step(cat, delta) {
    selectIndex(cat, cat.sel + delta, delta > 0 ? 'r' : 'l');
  }

  /* --- スワイプ検出 --- */
  const SWIPE_THRESHOLD_PX = 26;

  function attachSwipe(el, cat) {
    if (!el) return;
    let swipeStartX = 0;
    let swipeActive = false;
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
      if (Math.abs(dx) >= SWIPE_THRESHOLD_PX) step(cat, dx < 0 ? 1 : -1);
    }, { passive: true });
    let mouseStartX = null;
    el.addEventListener('mousedown', (e) => { mouseStartX = e.clientX; });
    el.addEventListener('mouseup', (e) => {
      if (mouseStartX == null) return;
      const dx = e.clientX - mouseStartX;
      mouseStartX = null;
      if (Math.abs(dx) >= SWIPE_THRESHOLD_PX) step(cat, dx < 0 ? 1 : -1);
    });
  }

  /** 1カテゴリ分のDOM行(ラベル・前後矢印・現在項目・ドット)を組み立てる。 */
  function buildRow(cat) {
    const row = document.createElement('div');
    row.className = 'pose-ring-row';

    const label = document.createElement('span');
    label.className = 'pose-ring-label';
    label.textContent = cat.label;

    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'dock-arrow';
    prev.setAttribute('aria-label', '前へ');
    prev.textContent = '‹';
    prev.addEventListener('click', () => step(cat, -1));

    const current = document.createElement('div');
    current.className = 'dock-current';
    const emoji = document.createElement('span');
    emoji.className = 'dock-emoji';
    current.appendChild(emoji);
    attachSwipe(current, cat);

    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'dock-arrow';
    next.setAttribute('aria-label', '次へ');
    next.textContent = '›';
    next.addEventListener('click', () => step(cat, 1));

    const dots = document.createElement('div');
    dots.className = 'dock-dots';

    row.appendChild(label);
    row.appendChild(prev);
    row.appendChild(current);
    row.appendChild(next);
    row.appendChild(dots);

    cat.rowEl = row;
    cat.emojiEl = emoji;
    cat.dotsEl = dots;
    return row;
  }

  /**
   * @param {Array<{key:string,label:string,items:Array<{key:string,emoji:string,label:string}>}>} categoryList
   * @param {(catKey:string,itemKey:string,item:object)=>void} onSelectCallback
   */
  function init(categoryList, onSelectCallback) {
    cats = categoryList.map((c) => Object.assign({ sel: 0 }, c));
    onSelect = onSelectCallback || null;
    elRingLabel = document.getElementById('ring-label');
    rootEl = document.getElementById('pose-rings');
    if (!rootEl) return;

    rootEl.innerHTML = '';
    cats.forEach((cat) => {
      rootEl.appendChild(buildRow(cat));
      renderCurrent(cat, null);
      renderDots(cat);
    });
  }

  /** main.js以外から選択状態を外部同期したい場合用(互換維持)。 */
  function setActive(categoryKey, itemKey) {
    const cat = cats.find((c) => c.key === categoryKey);
    if (!cat) return;
    const idx = cat.items.findIndex((it) => it.key === itemKey);
    if (idx < 0) return;
    cat.sel = idx;
    renderCurrent(cat, null);
    updateActiveDot(cat);
  }

  /** レイアウトがCSSのflexに任せてある(位置合わせのJS計算不要)ため、
   * API互換のためだけに残すno-op。 */
  function syncPosition() {}

  window.PoseRing = { init, setActive, syncPosition };
})();
