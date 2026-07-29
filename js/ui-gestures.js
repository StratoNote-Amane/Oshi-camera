// js/ui-gestures.js — UI一新(v3「Halo」ADR-016)の上乗せレイヤー
// ------------------------------------------------------------
// このファイルはmain.jsを一切変更せずに動く。既存ボタンのIDを
// そのまま参照し、必要なら.click()を呼ぶだけなので、AR/Three.js/MMD/
// カメラ制御/推定処理には触れない(CONSTRAINTS.mdの制約を満たす)。
// main.jsより後、type=moduleではない通常scriptとして読み込む想定。
(function () {
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(() => {
    /* ---- ファン・ドックの開閉 ---- */
    const dockToggle = document.getElementById('dock-toggle');
    const dock = document.getElementById('top-dock');
    const stage = document.getElementById('stage');

    function openDock() {
      dock.classList.add('open');
      dockToggle.classList.add('open');
    }
    function closeDock() {
      dock.classList.remove('open');
      dockToggle.classList.remove('open');
    }
    if (dockToggle && dock) {
      dockToggle.addEventListener('click', () => {
        dock.classList.contains('open') ? closeDock() : openDock();
      });
      // ドック内のボタンを押したら、扇が開いた見た目のフィードバックが
      // 見えた直後に自動でしまう(押した瞬間の一瞬の拡大演出はCSS側で処理)。
      dock.addEventListener('click', (e) => {
        const btn = e.target.closest('.fan-btn');
        if (btn) setTimeout(closeDock, 260);
      });
      // カメラ映像側をタップしたら(=撮影に集中したいはず)自動でしまう。
      if (stage) {
        stage.addEventListener('touchstart', () => {
          if (dock.classList.contains('open')) closeDock();
        }, { passive: true, capture: true });
      }
    }

    /* ---- 撮影結果画面：下スワイプで「もう一度撮る」 ---- */
    const resultScreen = document.getElementById('result-screen');
    const resultImgWrap = document.getElementById('result-imgwrap');
    const retakeBtn = document.getElementById('retake-btn');
    if (resultImgWrap && retakeBtn && resultScreen) {
      const DISMISS_THRESHOLD_PX = 90;
      let startY = null;

      resultImgWrap.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        startY = e.touches[0].clientY;
        resultImgWrap.style.transition = 'none';
      }, { passive: true });

      resultImgWrap.addEventListener('touchmove', (e) => {
        if (startY == null || e.touches.length !== 1) return;
        const dy = Math.max(0, e.touches[0].clientY - startY);
        resultImgWrap.style.transform = `translateY(${dy}px)`;
        resultImgWrap.style.opacity = String(Math.max(0.3, 1 - dy / 260));
      }, { passive: true });

      resultImgWrap.addEventListener('touchend', (e) => {
        if (startY == null) return;
        const endY = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0].clientY : startY;
        const dy = endY - startY;
        startY = null;
        resultImgWrap.style.transition = '';
        resultImgWrap.style.transform = '';
        resultImgWrap.style.opacity = '';
        if (dy >= DISMISS_THRESHOLD_PX) {
          retakeBtn.click();
        }
      });
    }

    /* ---- シャッター発火時の演出: 金の開花 + 波紋(nova ring)が
       中心から2つ連続して広がって消える。main.jsのonShutterPress()
       自体には手を触れず、shutter-btnのclickを外側から観測するだけ。 ---- */
    const shutterBtn = document.getElementById('shutter-btn');
    const captureRow = document.getElementById('capture-row');
    if (shutterBtn) {
      shutterBtn.addEventListener('click', () => {
        shutterBtn.classList.add('bloom');
        setTimeout(() => shutterBtn.classList.remove('bloom'), 520);
        if (captureRow) {
          for (let i = 0; i < 2; i++) {
            const ring = document.createElement('div');
            ring.className = 'nova-ring';
            ring.style.animationDelay = `${i * 0.12}s`;
            captureRow.appendChild(ring);
            setTimeout(() => ring.remove(), 800);
          }
        }
      });
    }
  });
})();
