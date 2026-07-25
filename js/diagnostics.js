/* ============================================================
   diagnostics.js — 診断機能の初期化(2026/07新規)
   ------------------------------------------------------------
   環境解析(GPS/太陽位置/カメラ画像解析)・投影整合性チェック・
   距離較正テスト・画面内デバッグコンソールの配線をmain.js本体から
   分離した。main.jsの責務(カメラ・ジェスチャー・撮影・AR固定の
   オーケストレーション)をこれ以上太らせないための切り出し。

   CONSTRAINTS.mdの「AIによる環境認識」節はまだ正式な対象内格上げの
   承認を経ていないため、この一式はドラフト運用の位置づけのまま。

   2026/07/31更新: 実機ログで、EnvironmentAnalyzerの生の値がサンプル
   ごとに大きく暴れる(方位推定が±40°規模で反転する等)ことを確認した。
   environment-analyzer.js本体には手を入れず、受け渡し側である
   このファイルにjs/environment-stabilizer.js(EMA平滑化+
   environmentTypeのヒステリシス)を挟み、getEnvironmentState()/
   getAzimuthConfidence()は常にこの「安定化後」の値を返すようにした。
   下流(lighting.js/js/shadow/*)は変更なしで、より安定した入力を
   受け取れるようになる。
   ============================================================ */
import { createEnvironmentAnalyzer } from './environment-analyzer.js';
import { verifyProjectionConsistency } from './camera-projection.js';
import { runDistanceCalibration } from './calibration-tool.js';
import { createDebugConsole } from './debug-console.js';
import { createEnvironmentStabilizer } from './environment-stabilizer.js';

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
  const stabilizer = createEnvironmentStabilizer();
  let logTimer = null;

  function start() {
    envAnalyzer.start();
    clearInterval(logTimer);
    // ログには生の値と平滑化後の値を両方出す(挙動の違いを目視確認できるように)。
    logTimer = setInterval(() => {
      const raw = envAnalyzer.getState();
      console.log('[env-analyzer:raw]', raw);
      console.log('[env-analyzer:stabilized]', getEnvironmentState());
    }, 5000);
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

  // コンソールから手動で再確認したい時用(実機Safariのリモートデバッグ等で使用)。
  // __envAnalyzerStateは意図的に「生の値」のままにしてある(平滑化前の
  // 実測を直接確認したい時のデバッグ用)。
  window.__verifyProjection = logProjectionConsistency;
  window.__envAnalyzerState = () => envAnalyzer.getState();
  window.__envAnalyzerStateStabilized = () => getEnvironmentState();
  window.__runCalibration = runCalibration;

  /**
   * ShadowRig(js/shadow/shadow-rig.js)がDirectional/Environment Shadowの
   * 主入力として使うEnvironmentState(平滑化・ヒステリシス適用後)。
   */
  function getEnvironmentState() {
    return stabilizer.update(envAnalyzer.getState());
  }

  /**
   * shadow-rig.jsのazimuthConfidence(光源方向ヒントの信頼度、旧APIの
   * フォールバック用)として使う値。平滑化後のEnvironmentStateを使う。
   */
  function getAzimuthConfidence() {
    const s = getEnvironmentState();
    if (!s) return 0.5;
    return s.environmentType === 'indoor' ? 0.15 : Math.max(0.4, Math.min(1, s.outdoorScore / 100));
  }

  return { start, logProjectionConsistency, runCalibration, getAzimuthConfidence, getEnvironmentState };
}
