const { JSDOM } = require('jsdom');
const fs = require('fs');

let html = fs.readFileSync('index.html', 'utf8');
// main.js(type=module)は three.js の解決ができないため今回のDOMスモークテスト対象外にする。
// pose-ring.js / ui-gestures.js (通常script) だけを評価対象にする。
html = html.replace(/<script type="importmap">[\s\S]*?<\/script>/, '');
html = html.replace(/<script type="module" src="main\.js"><\/script>/, '');

const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;

// requestAnimationFrame / navigator.vibrate 等、ui-gestures.js が触れうるAPIを軽くstub
window.navigator.vibrate = () => {};

function loadScript(path) {
  const src = fs.readFileSync(path, 'utf8');
  dom.window.eval(src);
}

loadScript('js/pose-ring.js');
loadScript('js/ui-gestures.js');

// DOMContentLoadedを手動発火(ui-gestures.jsのready()フックのため)
window.document.dispatchEvent(new window.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));

const doc = window.document;
const results = [];
function check(name, cond) { results.push([name, !!cond]); }

/* ---- 1. window.PoseRing の公開APIが揃っているか ---- */
check('window.PoseRing.init exists', typeof window.PoseRing.init === 'function');
check('window.PoseRing.setActive exists', typeof window.PoseRing.setActive === 'function');
check('window.PoseRing.syncPosition exists', typeof window.PoseRing.syncPosition === 'function');

/* ---- 2. PoseRing.init + カテゴリ切替 + スワイプ相当 + ドット ---- */
const poseItems = [
  { key: 'standing', emoji: '🧍', label: '直立' },
  { key: 'wave', emoji: '👋', label: '手を振る' },
  { key: 'peace', emoji: '✌️', label: 'ピース' },
];
const exprItems = [
  { key: 'normal', emoji: '😐', label: '通常' },
  { key: 'smile', emoji: '😊', label: '笑顔' },
];
let lastSelect = null;
window.PoseRing.init(
  [{ key: 'pose', label: 'ポーズ', items: poseItems }, { key: 'expr', label: '表情', items: exprItems }],
  (catKey, itemKey, item) => { lastSelect = { catKey, itemKey, item }; }
);
check('initial dock-emoji = standing pose emoji', doc.getElementById('dock-emoji').textContent === '🧍');
check('dock-dots rendered 3 dots for 3-item pose category', doc.getElementById('dock-dots').children.length === 3);
check('dock-dots first dot active initially', doc.getElementById('dock-dots').children[0].classList.contains('active'));

// 「次へ」ボタンをクリック(スワイプの代わり)
doc.getElementById('dock-next').click();
check('after next(): onSelect called with pose/wave', lastSelect && lastSelect.catKey === 'pose' && lastSelect.itemKey === 'wave');
check('after next(): 2nd dot becomes active', doc.getElementById('dock-dots').children[1].classList.contains('active'));

// カテゴリ切替(ポーズ→表情)
doc.getElementById('cat-chip').click();
check('cat-label switched to 表情', doc.getElementById('cat-label').textContent === '表情');
check('dock-dots rebuilt to 2 dots for expr category', doc.getElementById('dock-dots').children.length === 2);

/* ---- 3. ui-gestures.js: ファン・ドックの開閉 ---- */
const dockToggle = doc.getElementById('dock-toggle');
const dock = doc.getElementById('top-dock');
check('dock initially closed', !dock.classList.contains('open'));
dockToggle.click();
check('dock opens after toggle click', dock.classList.contains('open'));
check('dock-toggle gets open class', dockToggle.classList.contains('open'));
dockToggle.click();
check('dock closes after 2nd toggle click', !dock.classList.contains('open'));

// ファンボタンを押すと自動で閉じる(setTimeout 260ms)
dockToggle.click();
doc.getElementById('reticle-btn').click();
setTimeout(() => {
  check('dock auto-closes ~260ms after a fan button click', !dock.classList.contains('open'));
  printResults();
}, 320);

function printResults() {
  let pass = 0;
  for (const [name, ok] of results) {
    console.log((ok ? 'PASS' : 'FAIL') + ' - ' + name);
    if (ok) pass++;
  }
  console.log(`\n${pass}/${results.length} checks passed`);
  if (pass !== results.length) process.exitCode = 1;
}
