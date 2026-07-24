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

   【2026/07/28追記: 屋外判定の妥当性チェックを追加】
   実機ログで、室内の窓際でGPSが良好に測位できたケースにおいて、
   environmentType='outdoor'(outdoorScore=100)と判定されている一方、
   skyColor/groundColorは明らかに室内照明・木製床の色(青みがほぼ無い
   暖色)だったことを確認した。これは「GPS取得成功→屋外」という
   EnvironmentAnalyzer側の補正が、画像から得られる色情報と矛盾していても
   無条件に信用してしまうために起きていると考えられる。
   EnvironmentAnalyzer本体の判定ロジック(GPS/画像の重み付け)を直すのが
   本筋だが、その内部コードを確認できていないため、ここでは受け手側の
   安全弁として「outdoor判定でも空色が青くなければDirectional Shadowを
   全開にはしない」という妥当性チェックを追加する。あくまで対症療法で
   あり、EnvironmentAnalyzer本体のGPS/画像の重み付け見直し(EMA・
   ヒステリシス化)が正式な対応になる。
   ============================================================ */

/**
 * skyColorが「屋外の空らしい色(青みがある)」かどうかを簡易判定する。
 * 室内の暖色照明・木材色等は赤/緑に対して青が少ない傾向を利用する。
 * @param {{r:number,g:number,b:number}|null} skyColor
 * @returns {boolean} 判定材料が無い場合はtrue(妥当性チェックをスキップし、
 *   従来通りenvironmentTypeをそのまま信用する)。
 */
export function looksLikeOutdoorSky(skyColor) {
  if (!skyColor) return true;
  const blueExcess = skyColor.b - (skyColor.r + skyColor.g) / 2;
  // 青空は本来 blueExcess > 0 になりやすい。曇天等でほぼ無彩色の
  // ケースも許容するため、閾値はマイナス側に少し余裕を持たせている。
  return blueExcess > -0.05;
}

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

  const averageColor = (skyColor && groundColor)
    ? { r: (skyColor.r + groundColor.r) / 2, g: (skyColor.g + groundColor.g) / 2, b: (skyColor.b + groundColor.b) / 2 }
    : (groundColor || skyColor || null);

  const plausibleOutdoor = looksLikeOutdoorSky(skyColor);

  let directionalStrength;
  if (environmentType === 'indoor') {
    directionalStrength = 0.08;
  } else if (environmentType === 'outdoor') {
    // 屋外判定でも空色が屋外らしくない場合は、GPSだけで屋外と誤判定
    // している可能性が高いとみなし、フル強度にはしない(安全弁)。
    directionalStrength = plausibleOutdoor ? 1.0 : 0.35;
  } else {
    directionalStrength = 0.08 + (Math.max(0, Math.min(100, outdoorScore)) / 100) * 0.92;
    if (!plausibleOutdoor) directionalStrength = Math.min(directionalStrength, 0.35);
  }

  if (sunAltitude != null && sunAltitude <= 2) {
    directionalStrength *= 0.4;
  }

  const contactContrast = 0.85 + Math.max(0, Math.min(1, averageLuminance)) * 0.3;

  const shadowColor = averageColor
    ? { r: averageColor.r, g: averageColor.g, b: averageColor.b }
    : { r: 1, g: 1, b: 1 };

  return {
    directionalStrength: Math.max(0, Math.min(1, directionalStrength)),
    contactContrast: Math.max(0.5, Math.min(1.15, contactContrast)),
    shadowColor,
    reason: `${environmentType}(outdoorScore=${Math.round(outdoorScore)}, plausibleOutdoor=${plausibleOutdoor})`,
  };
}
