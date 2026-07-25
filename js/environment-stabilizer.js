/* ============================================================
   js/environment-stabilizer.js — EnvironmentStateの平滑化(新規)
   ------------------------------------------------------------
   実機ログで、environment-analyzer.jsの生の値(skyColor/groundColor/
   averageLuminance/estimatedColorTemperature/estimatedLightDirection等)
   が数秒おきのサンプルごとに大きく暴れていることを確認した
   (例: azimuthDegが-40°〜+28°の範囲で頻繁に反転)。加えて
   indoorScore/outdoorScoreの揺れにより、environmentTypeが
   indoor/outdoor/ambiguousの間で頻繁に切り替わりうる状態だった。

   environment-analyzer.js本体(GPS/画像解析のアルゴリズム自体)は
   変更せず、その「受け渡し側」でこのファイルが以下を行う:
     1. 数値・色フィールドに指数移動平均(EMA)を適用し、サンプルごとの
        急激な変化を緩和する。
     2. environmentTypeにヒステリシスを持たせる。一度indoor/outdoorに
        determineされたら、outdoorScore(平滑化後)がしきい値を大きく
        超えるまでは前回の分類を維持し、閾値付近での細かい切り替わりを防ぐ。

   呼び出し側(diagnostics.js)は、envAnalyzer.getState()の生の値を
   毎回このモジュールのupdate()に通してから使うことで、lighting.js/
   shadow-rig.js等の下流モジュールは常に安定した値だけを受け取る。
   ============================================================ */

const EMA_ALPHA = 0.25; // 新しいサンプルへ寄せる割合(小さいほど滑らか、反応は遅くなる)
const OUTDOOR_ENTER_THRESHOLD = 65; // indoor→outdoorへ切り替わるのに必要な平滑化後outdoorScore
const INDOOR_ENTER_THRESHOLD = 35;  // outdoor→indoorへ切り替わるのに必要な平滑化後outdoorScore

const NUMBER_FIELDS = [
  'sunAltitude', 'sunAzimuth', 'averageLuminance', 'estimatedColorTemperature',
  'gpsAccuracy', 'altitudeMeters', 'latitude', 'longitude', 'indoorScore', 'outdoorScore',
];
const COLOR_FIELDS = ['skyColor', 'groundColor'];

function lerp(a, b, t) { return a + (b - a) * t; }

function smoothNumber(prevVal, rawVal) {
  if (typeof rawVal !== 'number' || !Number.isFinite(rawVal)) return rawVal;
  if (typeof prevVal !== 'number' || !Number.isFinite(prevVal)) return rawVal;
  return lerp(prevVal, rawVal, EMA_ALPHA);
}
function smoothColor(prevVal, rawVal) {
  if (!rawVal) return rawVal;
  if (!prevVal) return rawVal;
  return {
    r: lerp(prevVal.r, rawVal.r, EMA_ALPHA),
    g: lerp(prevVal.g, rawVal.g, EMA_ALPHA),
    b: lerp(prevVal.b, rawVal.b, EMA_ALPHA),
  };
}

export function createEnvironmentStabilizer() {
  let smoothed = null;
  let stableType = null; // ヒステリシスのために保持する「現在の確定分類」

  function resolveEnvironmentType(smoothedOutdoorScore, rawType) {
    if (typeof smoothedOutdoorScore !== 'number') return rawType;
    if (stableType == null) {
      stableType = smoothedOutdoorScore >= 50 ? 'outdoor' : 'indoor';
      return stableType;
    }
    if (stableType === 'indoor' && smoothedOutdoorScore >= OUTDOOR_ENTER_THRESHOLD) {
      stableType = 'outdoor';
    } else if (stableType === 'outdoor' && smoothedOutdoorScore <= INDOOR_ENTER_THRESHOLD) {
      stableType = 'indoor';
    }
    // しきい値の間(ambiguous寄り)にいる間は、前回確定した分類を維持する。
    return stableType;
  }

  /**
   * @param {object|null} raw environment-analyzer.jsのgetState()の生の戻り値
   * @returns {object|null} 平滑化・ヒステリシス適用後のEnvironmentState
   *   (rawがnullで、かつ過去の平滑化状態も無ければnullを返す)
   */
  function update(raw) {
    if (!raw) return smoothed;
    if (!smoothed) {
      // 初回はそのまま採用する(いきなり0から平滑化を始めると、起動直後に
      // 「本来の値へ数秒かけて追いつく」不自然な過渡期間ができてしまうため)。
      smoothed = { ...raw };
      stableType = raw.environmentType || null;
      return smoothed;
    }
    const next = { ...raw };
    NUMBER_FIELDS.forEach((key) => { next[key] = smoothNumber(smoothed[key], raw[key]); });
    COLOR_FIELDS.forEach((key) => { next[key] = smoothColor(smoothed[key], raw[key]); });
    next.environmentType = resolveEnvironmentType(next.outdoorScore, raw.environmentType);
    smoothed = next;
    return smoothed;
  }

  function getSmoothedState() {
    return smoothed;
  }

  return { update, getSmoothedState };
}
