/* ============================================================
   idle-motion.js — 待機モーション(無操作時の自動アクション)
   ------------------------------------------------------------
   20260721ポージング指示書「待機モーション」＋hinyaさんの補足指示
   （ユーザー操作が30秒以上無ければ自動発動、「ふとモデルが動く」
   感じにしたい）への対応。

   新規のボーンデータ・新規のPMX依存を一切増やさず、既存資産の
   再利用のみで実装している。
     - モーションA「カメラ目線で手を振り、ウインク」:
       既存の poses.wave + expressions.wink をそのまま一時適用する。
     - モーションB「上半身をゆったり左右に揺らす(足は動かさない)」:
       character.js の setGlobalOffset('bodyYaw', …) を正弦波で
       ゆっくり往復させる。bodyYawは上半身/下半身のY軸回転にしか
       マッピングされておらず(GLOBAL_OFFSET_BONES参照)、脚のボーンに
       一切触れないため、「足は動かさない」という要件を自動的に満たす。

   どちらのモーションも、発動前の(ポーズ, 表情)を保存しておき、
   モーション終了後に必ずそこへ戻す。ユーザーが手動でポーズ/表情/
   撮影操作をした場合はタイマーをリセットし、発動中でも次のtickで
   打ち切って良いように「isBusy」フックを用意している(呼び出し側で
   撮影中・ジェスチャー中を弾く用途を想定)。
   ============================================================ */

const DEFAULT_INACTIVITY_MS = 30000;   // 指示書: 30秒以上の無操作で発動
const DEFAULT_MOTION_DURATION_MS = 4500; // モーション自体の再生時間(たたき台、要実機調整)
const SWAY_AMPLITUDE_DEG = 9;          // 上半身の揺れ幅(たたき台)
const SWAY_PERIOD_MS = 2600;

/**
 * @param {object} args
 * @param {() => object|null} args.getCharacter 現在のMMDCharacterを返す関数
 * @param {() => boolean} [args.isBusy] trueを返す間は発動しない(撮影中・ジェスチャー中等)
 * @param {number} [args.inactivityMs]
 * @param {number} [args.motionDurationMs]
 */
export function createIdleMotionManager({ getCharacter, isBusy, inactivityMs = DEFAULT_INACTIVITY_MS, motionDurationMs = DEFAULT_MOTION_DURATION_MS }) {
  let lastActivity = performance.now();
  let playing = false;
  let swayRafId = null;

  function notifyActivity() {
    lastActivity = performance.now();
    // モーション再生中にユーザー操作があった場合は、見た目の破綻(手動ポーズ変更と
    // 待機モーションの巻き戻しが競合する)を避けるため、そのモーションは
    // 「今のポーズをそのまま残す」形で静かに打ち切る(元のポーズへは戻さない。
    // ユーザーが今まさに操作しているのだから、そちらを優先するのが自然なため)。
    if (playing) {
      playing = false;
      if (swayRafId) { cancelAnimationFrame(swayRafId); swayRafId = null; }
    }
  }

  function pickMotion() {
    return Math.random() < 0.5 ? 'wave-wink' : 'sway';
  }

  function playWaveWink(character, onDone) {
    const prevPoseKey = character.activePoseKey;
    const prevExprKey = character.currentExpressionKey || 'normal';
    character.setPose('wave');
    character.setExpression('wink');
    setTimeout(() => {
      if (!playing) return; // 途中でユーザー操作により打ち切られていたら何もしない
      character.setPose(prevPoseKey);
      character.setExpression(prevExprKey);
      onDone();
    }, motionDurationMs);
  }

  function playSway(character, onDone) {
    const start = performance.now();
    function tick() {
      if (!playing) return; // 打ち切り済み
      const t = performance.now() - start;
      if (t >= motionDurationMs) {
        character.setGlobalOffset('bodyYaw', 0);
        onDone();
        return;
      }
      // 開始・終了をなだらかに0へ収束させ、唐突な出入りを避ける(sin包絡線)。
      const envelope = Math.sin(Math.PI * Math.min(1, t / motionDurationMs));
      const deg = Math.sin((t / SWAY_PERIOD_MS) * Math.PI * 2) * SWAY_AMPLITUDE_DEG * envelope;
      character.setGlobalOffset('bodyYaw', deg);
      swayRafId = requestAnimationFrame(tick);
    }
    tick();
  }

  function tryTrigger() {
    if (playing) return;
    if (isBusy && isBusy()) return;
    const character = getCharacter();
    if (!character) return;
    if (performance.now() - lastActivity < inactivityMs) return;

    playing = true;
    const motion = pickMotion();
    const done = () => {
      playing = false;
      // モーション終了後、すぐ再発動しないよう基準時刻を更新する。
      lastActivity = performance.now();
    };
    if (motion === 'wave-wink') playWaveWink(character, done);
    else playSway(character, done);
  }

  const intervalId = setInterval(tryTrigger, 1000);

  /**
   * 指定した要素上のタップ/クリックを「ユーザー操作あり」として自動検知する。
   * stage(カメラ映像+3Dキャンバス)とui-layer(ボタン類)の両方に付けておけば、
   * main.js側で個々のイベントハンドラにnotifyActivity()を書き足す必要がなくなる。
   */
  function attachAutoListeners(rootEl) {
    if (!rootEl) return;
    ['pointerdown', 'touchstart'].forEach((ev) => rootEl.addEventListener(ev, notifyActivity, { passive: true }));
  }

  function dispose() {
    clearInterval(intervalId);
    if (swayRafId) cancelAnimationFrame(swayRafId);
  }

  return { notifyActivity, attachAutoListeners, dispose };
}
