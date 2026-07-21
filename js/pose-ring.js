// js/pose-ring.js
// シャッターを中心とした「分割リング」型のポーズ/表情セレクター。
//
// 経緯: 以前はpose-bar/expression-barという横スクロール帯を2本重ねる方式だったが、
// 項目数が増えると画面外にはみ出す・一部が隠れる問題が繰り返し発生していた
// (DECISION_LOG.md 追記予定のADR参照)。シャッターを取り囲む1枚の円盤を扇形に
// 分割する方式に変更し、カテゴリ(ポーズ/表情)はcat-chipのタップで巡回する。
//
// main.js側の使い方:
//   PoseRing.init([
//     { key:'pose', label:'ポーズ', items:[{key:'stand', emoji:'🧍', label:'直立'}, ...] },
//     { key:'expr', label:'表情',   items:[{key:'smile', emoji:'😊', label:'笑顔'}, ...] },
//   ], (categoryKey, itemKey, item) => {
//     if (categoryKey === 'pose') Character.setPose(itemKey);
//     if (categoryKey === 'expr') Character.setExpression(itemKey);
//   });
//
// 外部からの状態同期(例: リセットボタンで直立に戻した時など)は
//   PoseRing.setActive('pose', 'stand') を呼べばリング側のハイライトも追従する。
//
// 注意: main.jsの実際の関数名(setPose等)はプロジェクト側の実装に合わせて
// 書き換えが必要。ここでは呼び出し側が自由に決められるよう、コールバック経由の
// 汎用APIとして実装している。

(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const R_OUT = 88, R_IN = 40, GAP_DEG = 1; // 扇の隙間は1度(3度は開きすぎとのフィードバックで調整済み)
  const CX = R_OUT, CY = R_OUT;

  let cats = [];
  let catIdx = 0;
  let onSelect = null;

  function wedgePath(a0deg, a1deg) {
    const a0 = a0deg * Math.PI / 180, a1 = a1deg * Math.PI / 180;
    const p = (r, a) => [CX + r * Math.cos(a), CY + r * Math.sin(a)];
    const [x1, y1] = p(R_OUT, a0), [x2, y2] = p(R_OUT, a1);
    const [x3, y3] = p(R_IN, a1), [x4, y4] = p(R_IN, a0);
    const large = (a1deg - a0deg) > 180 ? 1 : 0;
    return `M${x1},${y1} A${R_OUT},${R_OUT} 0 ${large} 1 ${x2},${y2} ` +
           `L${x3},${y3} A${R_IN},${R_IN} 0 ${large} 0 ${x4},${y4} Z`;
  }

  function showLabel(text) {
    const el = document.getElementById('ring-label');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 900);
  }

  function buildRing() {
    const cat = cats[catIdx];
    const svg = document.getElementById('ring-svg');
    if (!cat || !svg) return;
    const n = cat.items.length;
    const step = 360 / n;
    svg.innerHTML = '';
    cat.items.forEach((it, i) => {
      const start = -90 + step * i + GAP_DEG / 2;
      const end = -90 + step * (i + 1) - GAP_DEG / 2;
      const mid = (start + end) / 2 * Math.PI / 180;
      const tx = CX + (R_IN + R_OUT) / 2 * Math.cos(mid);
      const ty = CY + (R_IN + R_OUT) / 2 * Math.sin(mid) + 6;

      const g = document.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', 'wedge enter');
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', wedgePath(start, end));
      setWedgeStyle(path, i === cat.sel);
      const text = document.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', tx);
      text.setAttribute('y', ty);
      text.setAttribute('text-anchor', 'middle');
      text.textContent = it.emoji;
      g.appendChild(path);
      g.appendChild(text);
      g.addEventListener('click', () => {
        cat.sel = i;
        svg.querySelectorAll('path').forEach(p => setWedgeStyle(p, false));
        setWedgeStyle(path, true);
        showLabel(it.emoji + ' ' + it.label);
        if (typeof onSelect === 'function') onSelect(cat.key, it.key, it);
      });
      svg.appendChild(g);
      requestAnimationFrame(() => g.classList.remove('enter'));
    });
  }

  function setWedgeStyle(pathEl, active) {
    pathEl.setAttribute('fill', active ? 'rgba(231,185,76,.30)' : 'rgba(255,255,255,.05)');
    pathEl.setAttribute('stroke', active ? '#e7b94c' : 'rgba(255,255,255,.16)');
    pathEl.setAttribute('stroke-width', '1.3');
  }

  // シャッターの実際の描画座標からリングの縦位置を毎回算出する。
  // CSSの決め打ち値に頼らないことで、シャッター側のサイズ・位置を
  // 後から変更した時に再びズレる事故を防ぐ。
  function syncPosition() {
    const shutter = document.getElementById('shutter-btn');
    const ring = document.getElementById('ring-svg');
    if (!shutter || !ring) return;
    const rect = shutter.getBoundingClientRect();
    if (rect.width === 0) return; // まだ表示されていない(start-screen中など)
    const centerY = rect.top + rect.height / 2;
    const size = ring.viewBox.baseVal.height || R_OUT * 2;
    ring.style.bottom = (window.innerHeight - centerY - size / 2) + 'px';
  }

  function cycleCategory() {
    catIdx = (catIdx + 1) % cats.length;
    const label = document.getElementById('cat-label');
    if (label) label.textContent = cats[catIdx].label;
    buildRing();
  }

  function init(categoryList, onSelectCallback) {
    cats = categoryList.map(c => Object.assign({ sel: 0 }, c));
    catIdx = 0;
    onSelect = onSelectCallback || null;
    const label = document.getElementById('cat-label');
    if (label && cats[0]) label.textContent = cats[0].label;
    const chip = document.getElementById('cat-chip');
    if (chip) chip.addEventListener('click', cycleCategory);
    buildRing();
    syncPosition();
    window.addEventListener('resize', syncPosition);
    window.addEventListener('orientationchange', syncPosition);
  }

  // 外部(main.js)から選択状態を更新したい時に呼ぶ。リングが今そのカテゴリを
  // 表示中であれば見た目も即座に更新される。
  function setActive(categoryKey, itemKey) {
    const cat = cats.find(c => c.key === categoryKey);
    if (!cat) return;
    const idx = cat.items.findIndex(it => it.key === itemKey);
    if (idx < 0) return;
    cat.sel = idx;
    if (cats[catIdx] === cat) buildRing();
  }

  window.PoseRing = { init, setActive, syncPosition };
})();
