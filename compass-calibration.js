/* ============================================================
   js/compass-calibration.js — コンパス較正
   ------------------------------------------------------------
   2026/07/26 更新: camera.quaternionをジャイロで動かす「3DoF AR固定」
   機能自体を廃止した(main.js「方位センサー」セクションのコメント参照)。
   これに伴い、以前の「ジャイロの基準姿勢を設定した瞬間のコンパス方位を
   記録し、そこからの差分を使う」という設計は不要になった。カメラの
   向き自体がもう仮想的に回転しないため、「ARワールドの-Z方向」は
   常に「今まさに端末が向いている実際の方角」と一致する。そのため、
   最新のwebkitCompassHeadingをそのまま基準として使うだけでよい
   (基準のスナップショットを取り直す操作は不要)。

   【既知の限界(実機確認必須、たたき台)】
   - webkitCompassHeadingはiOS Safari固有の非標準プロパティ。
     取得できない環境では常にisAvailable()がfalseになり、
     呼び出し側は自動的に画像ベース推定(lighting.js)へフォールバックする。
   - 符号やオフセットが実機で逆/ズレて見える場合は、
     toARRelativeAzimuth()内の符号を反転することを想定している。
   ============================================================ */

export function createCompassCalibration() {
  let lastHeadingDeg = null;

  /**
   * main.jsのonDeviceOrientation内から、受信するたびに呼ぶ。
   * @param {number|undefined} headingDeg e.webkitCompassHeading
   */
  function recordHeading(headingDeg) {
    if (typeof headingDeg === 'number' && Number.isFinite(headingDeg)) {
      lastHeadingDeg = headingDeg;
    }
  }

  function isAvailable() {
    return lastHeadingDeg != null;
  }

  /**
   * @param {number} geoAzimuthDeg EnvironmentAnalyzerのsunAzimuth(地理方位、北基準)
   * @returns {number|null} AR相対角(度)。コンパス値が未取得/入力不正ならnull。
   */
  function toARRelativeAzimuth(geoAzimuthDeg) {
    if (!isAvailable() || typeof geoAzimuthDeg !== 'number' || !Number.isFinite(geoAzimuthDeg)) return null;
    let rel = geoAzimuthDeg - lastHeadingDeg;
    rel = ((rel % 360) + 360) % 360;
    return rel;
  }

  function getLastHeadingDeg() {
    return lastHeadingDeg;
  }

  return { recordHeading, isAvailable, toARRelativeAzimuth, getLastHeadingDeg };
}
