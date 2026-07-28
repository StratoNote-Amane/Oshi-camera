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

   【2026/08追記(ADR-015案の実機検証で発見、太陽高度による減衰の修正)】
   ホーム画面インストール(SPA)とSafari通常タブの両方で「東京・23時台・
   室内」という同一条件で検証したところ、SPA側は影がほぼContact Shadow
   のみ(意図通り)だったのに対し、Safari側は影が後方向へ長く伸びる
   現象が確認された。原因は、深夜で太陽高度が-34〜-35度(地平線を
   大きく下回る、天文学的に正しい値)であるにも関わらず、従来の
   減衰処理が「sunAltitude<=2度なら一律0.4倍」という単純な閾値の
   ままだったこと。さらにdirectional-shadow.js側で太陽高度を
   4〜88度にクランプしているため、-35度は「影が最も長く伸びる
   4度」に丸められてしまう。indoor/outdoor判定のスコアが50%前後で
   不安定にハンチングする状況(skyColorの青み判定が閾値付近で
   ぶれるため)と組み合わさり、outdoor判定に振れた瞬間だけ
   directionalStrengthが0.4倍(indoor時の0.1倍前後の3倍以上)に
   跳ね上がり、かつ影の長さは常に最大、という組み合わせで
   「Safariだけ後方向に長い影が出る」症状が再現したと考えられる。

   夜間(太陽が地平線を大きく下回っている)は、indoor/outdoor判定が
   どちらに転んでも「太陽由来の指向性影は物理的に存在しない」のが
   正しい。そのため、屋内外判定に頼る一律倍率ではなく、太陽高度
   そのものから「地平線付近〜市民薄明終了(-6度が目安)にかけて
   なだらかに1→0へ収束するスムーズな減衰係数」へ変更した
   (sunAltitudeToDirectionalFactor())。日中の低い太陽(日の出・
   日の入り前後)はむしろ強めの指向性影が自然なため、旧実装の
   一律0.4倍よりも高い係数を返すようになる点にも注意。
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

// smoothstep(端点で傾きが0になる滑らかな0→1補間)。線形補間だと
// 減衰の始まり/終わりで見た目が不自然にカクつくため使用する。
function smoothstep01(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

// 太陽高度(度)から、Directional Shadowの「太陽由来の指向性影」としての
// 妥当性係数(0〜1)を返す。
//   - +6度以上: 通常の日中とみなし1.0(減衰なし)
//   - -8度以下: 市民薄明(-6度)も終えた夜間とみなし0.0(完全に消す)
//   - その間: なだらかにsmoothstepで補間
// 旧実装は「2度以下なら一律0.4倍」という単純な閾値だったため、
// 深夜(-30度台)でも0.4倍というそれなりの強さが残ってしまい、
// indoor/outdoor判定のハンチングと組み合わさって「本来消えるべき
// 夜間の影が時々強く長く出る」不具合の原因になっていた。
const ALTITUDE_FACTOR_FULL_DEG = 6;   // これ以上は減衰なし
const ALTITUDE_FACTOR_ZERO_DEG = -8;  // これ以下は完全に0
export function sunAltitudeToDirectionalFactor(sunAltitudeDeg) {
  if (sunAltitudeDeg == null) return 1;
  if (sunAltitudeDeg >= ALTITUDE_FACTOR_FULL_DEG) return 1;
  if (sunAltitudeDeg <= ALTITUDE_FACTOR_ZERO_DEG) return 0;
  const t = (sunAltitudeDeg - ALTITUDE_FACTOR_ZERO_DEG) / (ALTITUDE_FACTOR_FULL_DEG - ALTITUDE_FACTOR_ZERO_DEG);
  return smoothstep01(t);
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
    // 2026/07/29: 屋内をほぼ0.08(実質Contact Shadowの単純な円形のみ)に
    // していたため、キャラクターのシルエット形状が全く影に出ず、
    // 「影の質が低い」という実機写真フィードバックにつながっていた。
    // 室内でも窓からの採光等でそれなりに柔らかい指向性の光はあり得る
    // ため、完全に消さず、明るさ(averageLuminance)に応じて0.2〜0.4程度
    // 残すようにする(晴天屋外のような硬い影にはならない範囲に留める)。
    directionalStrength = 0.2 + Math.max(0, Math.min(1, averageLuminance)) * 0.2;
  } else if (environmentType === 'outdoor') {
    // 屋外判定でも空色が屋外らしくない場合は、GPSだけで屋外と誤判定
    // している可能性が高いとみなし、フル強度にはしない(安全弁)。
    directionalStrength = plausibleOutdoor ? 1.0 : 0.35;
  } else {
    directionalStrength = 0.08 + (Math.max(0, Math.min(100, outdoorScore)) / 100) * 0.92;
    if (!plausibleOutdoor) directionalStrength = Math.min(directionalStrength, 0.35);
  }

  // 2026/08修正: 従来は「sunAltitude<=2度なら一律0.4倍」という硬い閾値
  // だったため、深夜(-30度台)でもindoor/outdoor判定がoutdoor側に
  // 振れた瞬間だけ0.4倍(indoor時の1/3〜1/4程度に相当)というそれなりの
  // 強さが残り、かつdirectional-shadow.js側の高度クランプ(4〜88度)に
  // より影の長さは常に最大になる、という組み合わせで「本来消えるべき
  // 夜間の影が時々強く長く出る」不具合の原因になっていた。
  // 太陽高度そのものから0〜1へなだらかに減衰する係数に置き換える
  // (sunAltitudeToDirectionalFactor()、市民薄明終了=-6度を目安に
  // -8度でほぼ完全に0になる)。indoor/outdoor判定のハンチングに
  // 関わらず、夜間は確実にDirectional Shadowが消える。
  directionalStrength *= sunAltitudeToDirectionalFactor(sunAltitude);

  const contactContrast = 0.85 + Math.max(0, Math.min(1, averageLuminance)) * 0.3;

  const shadowColor = averageColor
    ? { r: averageColor.r, g: averageColor.g, b: averageColor.b }
    : { r: 1, g: 1, b: 1 };

  return {
    directionalStrength: Math.max(0, Math.min(1, directionalStrength)),
    contactContrast: Math.max(0.5, Math.min(1.15, contactContrast)),
    shadowColor,
    reason: `${environmentType}(outdoorScore=${Math.round(outdoorScore)}, plausibleOutdoor=${plausibleOutdoor}, sunAltitude=${sunAltitude == null ? 'n/a' : sunAltitude.toFixed(1) + '°'})`,
  };
}
