/* ============================================================
   camera-projection.js — 投影整合性の検証ユーティリティ(新規)
   ------------------------------------------------------------
   「遠距離でキャラクターが実写背景より小さく見える」問題への対応の一環。
   指示書が要求するcomputeCoveredVerticalFovDeg()/computeCoverCrop()は
   これまでこのプロジェクトのどのファイルにも存在しなかった
   (main.jsを確認したが、camera.aspectはvideo実寸から都度再計算している
   ものの、object-fit:coverによるクロップを補正する専用関数は無かった)。

   【重要な前提の確認】
   style.cssは #camera-video に object-fit:cover を指定しているが、
   main.jsのsizeStageToVideo()は #stage の箱そのものをvideo本来の
   アスペクト比(vw/vh)ぴったりに作っている(はみ出す場合はcontain的に
   収める)。そのため、現状の設計では#stageとvideoのアスペクト比は
   常に一致しており、coverによる実質的なクロップは発生しない
   (crop factor = 1.0 = 'none' が期待値)。
   つまり「object-fit:coverのクロップとFOVの不一致」という仮説は、
   現在の実装においては数学的に該当しない可能性が高い。
   ただし将来レイアウトを「画面いっぱいに映像を敷き詰める(真のcover)」
   方式へ変更した場合は、この不一致が実際に効いてくる。
   このモジュールはその両方のケースを検証できるよう汎用的に作った。
   ============================================================ */

/**
 * object-fit:cover 適用時に、ソース画像のどちらの軸がクロップされるかと、
 * 残る可視割合を計算する。
 * @param {number} nativeAspect ソース(video)本来のアスペクト比(幅/高さ)
 * @param {number} containerAspect 表示先コンテナのアスペクト比(幅/高さ)
 * @returns {{cropAxis: 'vertical'|'horizontal'|'none', visibleFraction: number}}
 *   visibleFractionは「クロップされる軸」について、ソース全体のうち
 *   実際に画面に残る割合(0〜1)。cropAxisが'none'の場合は1。
 */
export function computeCoverCrop(nativeAspect, containerAspect) {
  const EPS = 1e-4;
  if (Math.abs(nativeAspect - containerAspect) < EPS) {
    return { cropAxis: 'none', visibleFraction: 1 };
  }
  if (containerAspect > nativeAspect) {
    // コンテナの方が横長 → 幅を合わせるため縦がはみ出し、上下がクロップされる
    return { cropAxis: 'vertical', visibleFraction: nativeAspect / containerAspect };
  }
  // コンテナの方が縦長 → 高さを合わせるため横がはみ出し、左右がクロップされる
  // (垂直方向のFOVには影響しない)
  return { cropAxis: 'horizontal', visibleFraction: 1 };
}

/**
 * object-fit:coverによる垂直方向のクロップを考慮した、実効垂直画角(度)を計算する。
 * ピンホールカメラモデルでは、画像平面上の可視範囲の割合と
 * tan(画角/2) が線形に対応するため、単純な角度の比例計算ではなく
 * tan/atanを介した変換を行う(小さなクロップ量では近似的にほぼ線形だが、
 * 大きなクロップでは非線形性が無視できなくなるため正しい式を使う)。
 *
 * @param {number} baseVerticalFovDeg クロップ前(ソース全体表示時)の
 *   垂直画角(度)。実機レンズの実効画角に相当する値。
 * @param {number} nativeAspect ソース本来のアスペクト比
 * @param {number} containerAspect 表示先コンテナのアスペクト比
 * @returns {{ verticalFovDeg: number, crop: {cropAxis:string, visibleFraction:number} }}
 */
export function computeCoveredVerticalFovDeg(baseVerticalFovDeg, nativeAspect, containerAspect) {
  const crop = computeCoverCrop(nativeAspect, containerAspect);
  if (crop.cropAxis !== 'vertical') {
    // 垂直方向はクロップされない(水平クロップのみ、またはクロップなし)ので
    // 垂直画角はそのまま
    return { verticalFovDeg: baseVerticalFovDeg, crop };
  }
  const halfBaseRad = (baseVerticalFovDeg / 2) * (Math.PI / 180);
  const halfCoveredRad = Math.atan(crop.visibleFraction * Math.tan(halfBaseRad));
  return { verticalFovDeg: (halfCoveredRad * 2) * (180 / Math.PI), crop };
}

/**
 * 現在のDOM状態を実測し、video/stage/camera.aspectの整合性を検証する。
 * レンダリング結果を見ずに、数値だけで「どこにズレがあるか」を特定するための関数。
 * @param {object} args
 * @param {HTMLVideoElement} args.video
 * @param {HTMLElement} args.stageEl object-fit:coverが指定されている実際の表示コンテナ
 *   (このアプリでは#stage。video要素自身ではなく、videoを内包する箱の
 *   実際のCSSレンダリング結果(getBoundingClientRect)を見る必要がある)
 * @param {THREE.PerspectiveCamera} args.camera
 * @param {number} args.baseVerticalFovDeg 現在camera.fovに設定している値
 *   (例: main.jsのFOV_BY_FACING.environment=42)。実機レンズ根拠の近似値。
 */
export function verifyProjectionConsistency({ video, stageEl, camera, baseVerticalFovDeg }) {
  const nativeAspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : NaN;
  const stageRect = stageEl.getBoundingClientRect();
  const stageAspect = stageRect.height > 0 ? stageRect.width / stageRect.height : NaN;

  const crop = (isFinite(nativeAspect) && isFinite(stageAspect))
    ? computeCoverCrop(nativeAspect, stageAspect)
    : { cropAxis: 'unknown', visibleFraction: NaN };

  const covered = (isFinite(nativeAspect) && isFinite(stageAspect))
    ? computeCoveredVerticalFovDeg(baseVerticalFovDeg, nativeAspect, stageAspect)
    : { verticalFovDeg: NaN, crop };

  const cameraAspectMatchesStage = isFinite(stageAspect) && Math.abs(camera.aspect - stageAspect) < 0.01;
  const fovAlreadyCorrect = Math.abs(covered.verticalFovDeg - baseVerticalFovDeg) < 0.05;

  const report = {
    videoNativeSize: { w: video.videoWidth, h: video.videoHeight },
    videoNativeAspect: nativeAspect,
    stageBoxSize: { w: stageRect.width, h: stageRect.height },
    stageAspect,
    cameraAspect: camera.aspect,
    cameraAspectMatchesStage,
    cameraFovDeg: camera.fov,
    baseVerticalFovDeg,
    coverCrop: crop,
    requiredVerticalFovDeg: covered.verticalFovDeg,
    fovAlreadyCorrect,
    verdict: !cameraAspectMatchesStage
      ? 'NG: camera.aspectがstageの実測アスペクト比と一致していません(resize取りこぼしの疑い)'
      : (crop.cropAxis === 'vertical' && !fovAlreadyCorrect)
        ? `NG: object-fit:coverが垂直方向をクロップしていますが、camera.fov(${baseVerticalFovDeg}°)が` +
          `補正されていません。本来は${covered.verticalFovDeg.toFixed(2)}°にすべきです。`
        : 'OK: 現在の計測範囲では投影のアスペクト比・クロップに矛盾は見つかりませんでした',
  };
  return report;
}
