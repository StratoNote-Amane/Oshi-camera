/* ============================================================
   js/compass-calibration.js — コンパス較正(新規)
   ------------------------------------------------------------
   ADR-014の既知の制約「本アプリのAR座標系はコンパス(磁気方位)で
   較正されていないため、EnvironmentAnalyzerの太陽方位角(sunAzimuth、
   地理的な絶対方位)をそのままDirectional Shadowの向きに使うと、
   実際にカメラに映っている光の向きとは無関係な方向へ影が伸びる
   可能性がある」への対応(ROADMAP.md「太陽方位角のコンパス較正」)。

   【方式】
   iOS Safariのdeviceorientationイベントに含まれる非標準プロパティ
   `webkitCompassHeading`(true northから見た「端末が向いている方角」、
   0〜360度、時計回り)を使う。追加の権限ダイアログは不要
   (main.jsが既にrequestGyroPermission()でdeviceorientationの許可を
   得ている前提に相乗りする)。

   AR世界座標のZ軸(カメラのデフォルト視線方向、-Z)は、ジャイロの
   基準姿勢(gyroRefQuat)を設定した瞬間の端末の実際の向きを基準にして
   いる。そのため、基準設定と同じ瞬間のwebkitCompassHeadingを
   「referenceHeadingDeg」として記録しておけば、
     ARワールド相対角 = 地理方位角 - referenceHeadingDeg (mod 360)
   という単純な差分だけで、地理的な太陽方位をこのアプリのAR空間内での
   相対角(lighting.js/shadow-rigが使うazimuthDegと同じ土俵の値)へ
   変換できる。

   【既知の限界(実機確認必須、たたき台)】
   - webkitCompassHeadingはiOS Safari固有の非標準プロパティ。
     Androidや将来のブラウザでは値が取れない可能性がある
     (取れない場合はisCalibrated()がfalseのままになり、
     呼び出し側は自動的に画像ベース推定へフォールバックする設計)。
   - 「ARワールドの-Z方向 ≒ 基準設定時に端末が向いていた方角」という
     近似は、基準設定時に端末を体の正面に構えていることを前提にした
     ものであり、厳密な検証はできていない。符号やオフセットが実機で
     逆/ズレて見える場合は、下記toARRelativeAzimuth()の符号を反転する
     か、90度単位のオフセットを追加することを想定している。
   ============================================================ */

export function createCompassCalibration() {
  let lastHeadingDeg = null;
  let referenceHeadingDeg = null;

  /**
   * main.jsのonDeviceOrientation内から、受信するたびに呼ぶ。
   * @param {number|undefined} headingDeg e.webkitCompassHeading
   */
  function recordHeading(headingDeg) {
    if (typeof headingDeg === 'number' && Number.isFinite(headingDeg)) {
      lastHeadingDeg = headingDeg;
    }
  }

  /**
   * ジャイロの基準姿勢(gyroRefQuat)を設定/再設定するのと同じタイミングで
   * 呼ぶ(main.jsの初回onDeviceOrientation、およびreanchorGyro()内)。
   */
  function setReference() {
    referenceHeadingDeg = lastHeadingDeg;
  }

  function isCalibrated() {
    return referenceHeadingDeg != null;
  }

  /**
   * @param {number} geoAzimuthDeg EnvironmentAnalyzerのsunAzimuth(地理方位、北基準)
   * @returns {number|null} AR相対角(度)。較正未完了/入力不正ならnull。
   */
  function toARRelativeAzimuth(geoAzimuthDeg) {
    if (!isCalibrated() || typeof geoAzimuthDeg !== 'number' || !Number.isFinite(geoAzimuthDeg)) return null;
    let rel = geoAzimuthDeg - referenceHeadingDeg;
    rel = ((rel % 360) + 360) % 360;
    return rel;
  }

  function getReferenceHeadingDeg() {
    return referenceHeadingDeg;
  }
  function getLastHeadingDeg() {
    return lastHeadingDeg;
  }

  return { recordHeading, setReference, isCalibrated, toARRelativeAzimuth, getReferenceHeadingDeg, getLastHeadingDeg };
}
