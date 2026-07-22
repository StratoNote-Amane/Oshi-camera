/* ============================================================
   environment-shadow.js — 環境情報による影の補正計算
   ------------------------------------------------------------
   このファイルはThree.jsのオブジェクトを一切保持・生成しない
   「純粋な計算のみ」のモジュールにしている。理由:
   指示書は「EnvironmentAnalyzerは環境情報のみ提供する」
   「Shadow RigはEnvironmentStateのみを利用する」ことを求めており、
   環境認識(EnvironmentAnalyzer)→影の見た目(Directional/Contact
   Shadow)という一方向の依存だけを許し、逆方向や横方向の依存
   (循環参照)を禁止している。ここを「計算のみ」に限定しておけば、
   将来EnvironmentAnalyzerの実装が変わっても、この関数のシグネチャ
   (入力: EnvironmentState、出力: 数値のプレーンオブジェクト)さえ
   保てば他モジュールへの影響がゼロで済む。

   屋内照明の推定を行わない(指示書の要件)ことの意味:
   屋内では「主光源がどこにあるか」を推定しようとしない。
   代わりに「屋内らしいと判定されたら、太陽方位に基づく指向性の
   強い影(Directional Shadow)を弱める/無効化し、Contact Shadowを
   主役にする」という保守的な方針に徹する。これにより、精度の
   低い屋内光源推定を実装する複雑さとリスクを避けつつ、
   「屋内でも不自然に伸びた影が出ない」という実用上の要件を満たす。
   ============================================================ */

/**
 * @param {object|null} environmentState environment-analyzer.jsのgetState()の戻り値。
 *   nullの場合(未取得/GPS権限なし等)は「情報がない」前提で保守的な既定値を返す。
 * @returns {{
 *   directionalStrength: number,   // 0〜1。Directional Shadowの最終的な強さ
 *   contactContrast: number,       // Contact Shadowの濃さ補正(0.5〜1.15程度)
 *   shadowColor: {r:number,g:number,b:number}, // 影に乗せる色味(環境色寄せ)
 *   reason: string                 // デバッグ表示用の判定理由
 * }}
 */
export function computeEnvironmentShadowParams(environmentState) {
  if (!environmentState) {
    return {
      directionalStrength: 0.5, // 情報がない間は中庸(屋外寄りに倒しすぎない)
      contactContrast: 1.0,
      shadowColor: { r: 1, g: 1, b: 1 },
      reason: 'no-environment-data',
    };
  }

  const {
    environmentType = 'ambiguous',
    outdoorScore = 50,
    averageLuminance = 0.5,
    skyColor = null,
    groundColor = null,
    sunAltitude = null,
  } = environmentState;

  // 注意: environment-analyzer.jsのEnvironmentStateに`averageColor`という
  // フィールドは存在しない(analyzeImage()内部でのみ計算され、stateへは
  // コピーされていない)。影に乗せる環境色は、代わりに常時保持されている
  // skyColor/groundColorから合成する(両方あれば平均、片方のみならそれを使う)。
  const averageColor = (skyColor && groundColor)
    ? { r: (skyColor.r + groundColor.r) / 2, g: (skyColor.g + groundColor.g) / 2, b: (skyColor.b + groundColor.b) / 2 }
    : (groundColor || skyColor || null);

  // 屋内outdoorScoreが低いほどDirectional Shadowを弱める。完全な0にはしない
  // (指示書: 屋内は「弱める、または無効化」であり、判定が際どいケースで
   // 影が一瞬で消えるより、緩やかに薄くなる方が見た目の破綻が少ない)。
  let directionalStrength;
  if (environmentType === 'indoor') {
    directionalStrength = 0.08;
  } else if (environmentType === 'outdoor') {
    directionalStrength = 1.0;
  } else {
    // ambiguous: outdoorScore(0-100)を0.08〜1.0へ線形に写像
    directionalStrength = 0.08 + (Math.max(0, Math.min(100, outdoorScore)) / 100) * 0.92;
  }

  // 太陽が地平線付近/下にある(sunAltitude<=2度)場合は、方位の精度が
  // 特に信用できず影が極端に伸びやすいため、追加で弱める。
  if (sunAltitude != null && sunAltitude <= 2) {
    directionalStrength *= 0.4;
  }

  // Contact Shadowの濃さ: 明るい環境ほどコントラストが実際には強く出るはずなので
  // わずかに濃く、暗い環境ではわずかに薄くする(常に完全に消えはしない)。
  const contactContrast = 0.85 + Math.max(0, Math.min(1, averageLuminance)) * 0.3;

  const shadowColor = averageColor
    ? { r: averageColor.r, g: averageColor.g, b: averageColor.b }
    : { r: 1, g: 1, b: 1 };

  return {
    directionalStrength: Math.max(0, Math.min(1, directionalStrength)),
    contactContrast: Math.max(0.5, Math.min(1.15, contactContrast)),
    shadowColor,
    reason: `${environmentType}(outdoorScore=${Math.round(outdoorScore)})`,
  };
}
