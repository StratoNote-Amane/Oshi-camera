/* ============================================================
   diagnostics.js — 診断機能の初期化(2026/07新規)
   ------------------------------------------------------------
   環境解析(GPS/太陽位置/カメラ画像解析)・投影整合性チェック・
   距離較正テスト・画面内デバッグコンソールの配線をmain.js本体から
   分離した。main.jsの責務(カメラ・ジェスチャー・撮影・AR固定の
   オーケストレーション)をこれ以上太らせないための切り出し。

   CONSTRAINTS.mdの「AIによる環境認識」節はまだ正式な対象内格上げの
   承認を経ていないため、この一式はドラフト運用の位置づけのまま。
   ============================================================ */
import { createEnvironmentAnalyzer } from './environment-analyzer.js';
import { verifyProjectionConsistency } from './camera-projection.js';
import { runDistanceCalibration } from './calibration-tool.js';
import { createDebugConsole } from './debug-console.js';

/**
 * @param {object} args
 * @param {HTMLVideoElement} args.video
 * @param {HTMLElement} args.stage object-fit:coverが指定されている表示コンテナ
 * @param {THREE.PerspectiveCamera} args.camera
 * @param {THREE.WebGLRenderer} args.renderer
 * @param {() => object|null} args.getCharacter
 * @param {object} args.placement main.jsのplacement状態オブジェクト
 * @param {() => void} args.applyPlacement
 * @param {() => number} args.baseVerticalFovDeg 現在のcamera.fov相当値を返す関数
 */
export function initDiagnostics({ video, stage, camera, renderer, getCharacter, placement, applyPlacement, baseVerticalFovDeg }) {
  createDebugConsole();

  const envAnalyzer = createEnvironmentAnalyzer({ video, useGps: true });
  let logTimer = null;

  function start() {
    envAnalyzer.start();
    clearInterval(logTimer);
    logTimer = setInterval(() => console.log('[env-analyzer]', envAnalyzer.getState()), 5000);
  }

  function logProjectionConsistency() {
    if (!video.videoWidth) return null;
    const report = verifyProjectionConsistency({
      video, stageEl: stage, camera, baseVerticalFovDeg: baseVerticalFovDeg(),
    });
    console.log('[camera-projection] 投影整合性チェック:', report);
    return report;
  }

  function runCalibration(realHeightMeters = 1.55) {
    const character = getCharacter();
    if (!character) { console.warn('[calibration] キャラクターが読み込まれていません'); return null; }
    const result = runDistanceCalibration({ camera, renderer, character, placement, applyPlacement, realHeightMeters });
    console.log('[calibration] main.js(実カメラ)での検証結果:\n' + result.lines.join('\n'));
    return result;
  }

  // コンソールから手動で再確認したい時用(実機Safariのリモートデバッグ等で使用)
  window.__verifyProjection = logProjectionConsistency;
  window.__envAnalyzerState = () => envAnalyzer.getState();
  window.__runCalibration = runCalibration;

  /**
   * shadow-rig.jsのazimuthConfidence(光源方向ヒントの信頼度)として使う値。
   * 屋内判定時は大きく減衰させる(理由はshadow-rig.js側のJSDoc参照)。
   */
  function getAzimuthConfidence() {
    const s = envAnalyzer.getState();
    return s.environmentType === 'indoor' ? 0.15 : Math.max(0.4, Math.min(1, s.outdoorScore / 100));
  }

  // ShadowRig(js/shadow/shadow-rig.js)がDirectional/Environment Shadowの
  // 主入力として使うEnvironmentState全体。getAzimuthConfidence()は
  // 後方互換のフォールバック用にそのまま残す(ADR-014)。
  function getEnvironmentState() {
    return envAnalyzer.getState();
  }

  return { start, logProjectionConsistency, runCalibration, getAzimuthConfidence, getEnvironmentState };
}
