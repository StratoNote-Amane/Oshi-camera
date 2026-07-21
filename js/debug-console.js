/* ============================================================
   debug-console.js — 画面内デバッグコンソール
   ------------------------------------------------------------
   Web Inspector(Mac+ケーブルでのリモートデバッグ)が使えない状況でも、
   実機iPhone単体でconsole.log/warn/errorの内容を確認・コピーできる
   ようにするための汎用オンスクリーンコンソール。

   2026/07: AR精度検証セッション専用だった3つのクイックボタン
   (投影チェック/環境情報/距離較正)は検証完了に伴い撤去した。
   ログ閲覧・コピー・クリアの汎用機能のみ残している。個別の診断は
   引き続きjs/diagnostics.jsがwindow.__verifyProjection() /
   window.__envAnalyzerState() / window.__runCalibration() として
   グローバル公開しているため、必要な場面ではこのコンソールを開いた
   状態でコンソール入力可能な環境から手動で呼び出せる。

   既存のCSS(style.css)には触れず、このファイル単体で完結するよう
   インラインスタイルでDOM要素を組み立てる(既存レイアウトへの影響を
   最小化するため)。
   ============================================================ */

const MAX_LINES = 400;

function formatArg(a) {
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  if (typeof a === 'object' && a !== null) {
    try { return JSON.stringify(a, null, 2); } catch (e) { return String(a); }
  }
  return String(a);
}

export function createDebugConsole() {
  const buffer = [];

  const toggleBtn = document.createElement('button');
  toggleBtn.textContent = '🐛';
  toggleBtn.setAttribute('aria-label', 'デバッグパネル');
  Object.assign(toggleBtn.style, {
    position: 'fixed', top: 'calc(env(safe-area-inset-top, 0px) + 8px)', left: '8px',
    zIndex: 9999, width: '38px', height: '38px', borderRadius: '50%',
    background: 'rgba(20,22,28,.55)', border: '1px solid rgba(255,255,255,.25)',
    color: '#fff', fontSize: '16px', lineHeight: '1',
  });

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'fixed', left: '0', right: '0', bottom: '0',
    height: '52vh', zIndex: 9998,
    background: 'rgba(10,11,15,.96)', borderTop: '1px solid rgba(231,185,76,.4)',
    display: 'none', flexDirection: 'column',
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
    fontFamily: 'monospace',
  });

  const toolbar = document.createElement('div');
  Object.assign(toolbar.style, {
    display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '8px',
    borderBottom: '1px solid rgba(255,255,255,.15)',
  });

  function makeBtn(label) {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, {
      padding: '7px 11px', borderRadius: '6px', fontSize: '11.5px',
      background: 'rgba(255,255,255,.1)', border: '1px solid rgba(255,255,255,.2)',
      color: '#fff',
    });
    return b;
  }
  const btnCopy = makeBtn('コピー');
  const btnClear = makeBtn('クリア');
  const btnClose = makeBtn('閉じる');
  toolbar.append(btnCopy, btnClear, btnClose);

  const output = document.createElement('div');
  Object.assign(output.style, {
    flex: '1', overflowY: 'auto', padding: '8px',
    fontSize: '10.5px', lineHeight: '1.5', color: '#cfe3cf',
    whiteSpace: 'pre-wrap', wordBreak: 'break-all',
  });

  const copyFeedback = document.createElement('div');
  Object.assign(copyFeedback.style, {
    padding: '4px 8px', fontSize: '11px', color: '#e7b94c', minHeight: '16px',
  });

  panel.append(toolbar, output, copyFeedback);
  document.body.appendChild(panel);
  document.body.appendChild(toggleBtn);

  function render() {
    output.textContent = buffer.join('\n\n');
    output.scrollTop = output.scrollHeight;
  }
  function pushLine(level, args) {
    const time = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    const text = Array.from(args).map(formatArg).join(' ');
    buffer.push(`[${time}] [${level}] ${text}`);
    while (buffer.length > MAX_LINES) buffer.shift();
    if (panel.style.display !== 'none') render();
  }

  // console.log/warn/errorを横取りしつつ、元の動作(実機で万一Web Inspector等が
  // 使える時のため)も維持する。
  const orig = { log: console.log.bind(console), warn: console.warn.bind(console), error: console.error.bind(console) };
  console.log = (...a) => { orig.log(...a); pushLine('LOG', a); };
  console.warn = (...a) => { orig.warn(...a); pushLine('WARN', a); };
  console.error = (...a) => { orig.error(...a); pushLine('ERROR', a); };

  // ページ内の未捕捉エラーもここに流す(main.jsの実行時エラーに気付けるように)
  window.addEventListener('error', (e) => pushLine('ERROR', [`${e.message} (${e.filename}:${e.lineno})`]));
  window.addEventListener('unhandledrejection', (e) => pushLine('ERROR', [`unhandledrejection: ${e.reason}`]));

  function show() { panel.style.display = 'flex'; render(); }
  function hide() { panel.style.display = 'none'; }
  toggleBtn.addEventListener('click', () => { panel.style.display === 'none' ? show() : hide(); });
  btnClose.addEventListener('click', hide);
  btnClear.addEventListener('click', () => { buffer.length = 0; render(); });

  btnCopy.addEventListener('click', async () => {
    const text = buffer.join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      copyFeedback.textContent = 'コピーしました(このままメッセージに貼り付けてください)';
    } catch (e) {
      // クリップボードAPIが使えない環境向けのフォールバック:
      // 選択状態のテキストエリアを表示し、手動での長押しコピーを促す。
      const ta = document.createElement('textarea');
      ta.value = text;
      Object.assign(ta.style, { width: '100%', height: '80px', fontSize: '10px', marginTop: '4px' });
      copyFeedback.textContent = '自動コピーに失敗しました。下の欄を長押しして全選択→コピーしてください:';
      copyFeedback.appendChild(ta);
      ta.focus();
      ta.select();
    }
  });

  return { show, hide, toggle: () => (panel.style.display === 'none' ? show() : hide()) };
}
