/* ============================================================
   calibration-tool.js — 距離スケール検証ツール(dev.html専用)
   ------------------------------------------------------------
   【背景・目的】
   「遠距離に配置するほど実写背景よりキャラクターが小さく見える」
   という報告に対し、指示書は複数の思い込みによる修正
   (距離比例スケール補正、Billboard化等)を明確に禁止し、
   まず数学的な原因特定を求めている。

   このツールは「レンダリング結果を見る」代わりに、
   camera.fov・camera.aspect・実際のプロジェクション行列から
   算出される「理論値」と、キャラクターの実ワールド座標
   バウンディングボックスをprojectionMatrixで実際に投影した
   「実測値(px)」を、複数の距離で突き合わせる。

   両者が全距離で一致する(比率が常に1.0付近)ならば、
   Three.js側の透視投影・カメラ設定は数学的に正しく、
   「小さく見える」原因はここではない(video側のobject-fit:cover
   のクロップ率とcamera.aspectの不一致、あるいはunitToMeter/
   getWidth()側の値の問題等、別の箇所を疑うべき)ということが
   数値で切り分けられる。

   逆に、距離が伸びるほど比率が1.0から乖離していく場合は、
   透視投影そのものに距離依存の誤差があることになり、
   camera.near/far・深度精度・あるいはZドラッグのクランプ範囲
   (MIN_CHARACTER_DISTANCE_Z等)との関係を疑う根拠になる。

   【重要】
   このツールは「見た目を合わせる補正」を一切行わない。
   数値を表示するだけで、スケールや位置には一切手を触れない。
   ============================================================ */
import * as THREE from 'three';

// 検証する距離プリセット(m)。実際の想定撮影距離(無人駅の対向ホーム
// 想定20m)をカバーするよう、近距離〜20m超まで並べる。
export const TEST_DISTANCES_M = [2, 5, 10, 15, 20, 25];

/**
 * 理論上の見かけの高さ(px)を、ピンホールカメラモデルで計算する。
 * 実写のvideo要素とThree.jsのcanvasが同じ矩形に重なっている前提
 * (このアプリの設計通り)であれば、実写の被写体も同じ式に従うはずなので、
 * この式自体が正しいかどうかは別途「camera.fovが実機レンズと一致しているか」
 * の検証が必要(これは実機なしでは完結できず、SPRINT_1_REPORT.mdの
 * 遠近法の節にある通り公開スペックからの近似に留まる)。
 *
 * @param {number} realHeightMeters 実際の高さ(m)
 * @param {number} distanceMeters カメラからの距離(m)
 * @param {number} verticalFovDeg camera.fov(度、three.jsでは垂直画角)
 * @param {number} rendererHeightPx 出力(video/canvas)の高さ(px)
 */
export function theoreticalPixelHeight(realHeightMeters, distanceMeters, verticalFovDeg, rendererHeightPx) {
  const halfFovRad = THREE.MathUtils.degToRad(verticalFovDeg / 2);
  // 距離distanceMetersにおいて画面全体が覆う実世界の高さ(m)
  const visibleWorldHeightAtDistance = 2 * distanceMeters * Math.tan(halfFovRad);
  return (realHeightMeters / visibleWorldHeightAtDistance) * rendererHeightPx;
}

/**
 * キャラクターのワールド空間バウンディングボックスを、実際に
 * camera.projectionMatrix × camera.matrixWorldInverse で投影し、
 * NDC→ピクセル変換した「実測の見かけの高さ(px)」を返す。
 * これは「実際にThree.jsが今その距離でどれだけの大きさとして
 * 描画しているか」そのものであり、レンダリング結果を目視せずに
 * 数値として取得できる。
 */
export function projectedPixelHeight(root, camera, rendererHeightPx) {
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return null;

  const corners = [];
  for (let ix = 0; ix <= 1; ix++) {
    for (let iy = 0; iy <= 1; iy++) {
      for (let iz = 0; iz <= 1; iz++) {
        corners.push(new THREE.Vector3(
          ix ? box.max.x : box.min.x,
          iy ? box.max.y : box.min.y,
          iz ? box.max.z : box.min.z
        ));
      }
    }
  }

  let minYNdc = Infinity, maxYNdc = -Infinity;
  corners.forEach((c) => {
    const p = c.clone().project(camera); // NDC(-1〜1)
    if (p.y < minYNdc) minYNdc = p.y;
    if (p.y > maxYNdc) maxYNdc = p.y;
  });

  // NDCの高さ差(0〜2)をピクセル高さへ変換
  const ndcHeight = maxYNdc - minYNdc;
  return (ndcHeight / 2) * rendererHeightPx;
}

/**
 * 距離較正テストの本体。DOM非依存(コンソールから直接呼び出す用途にも使える)。
 *
 * 【2026/07 重要な修正】
 * 当初の実装は「placement.z = camera.position.z - d」として、カメラの
 * z座標からの単純な差分を距離とみなしていた。これはカメラが原点付近から
 * ワールド-Z方向を向いている場合(main.jsの実カメラ、静止時)にのみ正しく、
 * dev.htmlのOrbitControlsカメラ(斜め上の位置から原点付近を見下ろす)では
 * 前提が崩れ、指定した距離dと実際のカメラ視線方向の深度が一致しなくなる
 * (dが小さいほど実深度がdより大きく、dが大きいほど実深度がdより小さくなる
 * 方向にズレる。実際にdev.htmlで比率が0.925→1.130と単調に伸びる結果が
 * 出たのはこれが原因だった)。
 *
 * 修正: キャラクターを配置した後の実際のワールド座標から、カメラの
 * 実際の前方ベクトル(camera.getWorldDirection())への射影(=視線方向の
 * 深度、ピンホール投影の式が本来必要とする量)を毎回計算し直し、
 * 理論値の計算にはその実測深度を使う。これによりカメラの向き・位置に
 * 依存せず正しく検証できる(main.js・dev.htmlのどちらでも同じ関数が使える)。
 *
 * @param {object} args
 * @param {THREE.PerspectiveCamera} args.camera
 * @param {THREE.WebGLRenderer} args.renderer
 * @param {object} args.character MMDCharacter/SpriteCharacter
 * @param {object} args.placement {x,y,z,rotY,scale} (呼び出し前後でzを書き換えて戻す)
 * @param {() => void} args.applyPlacement
 * @param {number} [args.realHeightMeters=1.6]
 * @param {number[]} [args.distances=TEST_DISTANCES_M]
 * @returns {{ lines: string[], rows: object[], maxFootYDriftMm: number }}
 */
export function runDistanceCalibration({ camera, renderer, character, placement, applyPlacement, realHeightMeters = 1.6, distances = TEST_DISTANCES_M }) {
  const rendererHeightPx = renderer.domElement.height || renderer.getSize(new THREE.Vector2()).y;
  const originalZ = placement.z;

  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward); // 正規化済み、カメラの実際の前方ベクトル(ワールド空間)

  const lines = [];
  const rows = [];
  lines.push('指定d(m) 実深度(m) 理論px   実測px   比率     footY(m)  footYずれ(mm)');
  let baselineFootY = null;
  let maxFootYDriftMm = 0;

  distances.forEach((d) => {
    // 従来通り「カメラのz座標からd引いた位置」に置く(main.jsの実際の
    // 配置ロジックと同じ考え方)。ただし理論値の計算には、この配置の
    // 結果として実際に生じたカメラ視線方向の深度を別途測って使う
    // (カメラが斜めを向いていても正しく評価できるようにするため)。
    placement.z = camera.position.z - d;
    applyPlacement();

    const charWorldPos = new THREE.Vector3();
    character.root.getWorldPosition(charWorldPos);
    const toChar = charWorldPos.clone().sub(camera.position);
    const viewDepth = toChar.dot(forward); // カメラ前方ベクトルへの射影 = 真の深度

    const theoretical = viewDepth > 0
      ? theoreticalPixelHeight(realHeightMeters, viewDepth, camera.fov, rendererHeightPx)
      : NaN;
    const actual = projectedPixelHeight(character.root, camera, rendererHeightPx);
    const ratio = (actual != null && theoretical > 0) ? (actual / theoretical) : NaN;

    // GroundEstimator相当のチェック(AR精度検証項目②)。
    const footY = character.getFootY();
    if (baselineFootY === null) baselineFootY = footY;
    const driftMm = Math.abs(footY - baselineFootY) * 1000;
    maxFootYDriftMm = Math.max(maxFootYDriftMm, driftMm);

    rows.push({ d, viewDepth, theoretical, actual, ratio, footY, driftMm });
    lines.push(
      `${String(d).padStart(7)}  ${viewDepth.toFixed(2).padStart(8)}  ${theoretical.toFixed(1).padStart(6)}   ` +
      `${(actual == null ? 'N/A' : actual.toFixed(1)).padStart(6)}   ` +
      `${(isNaN(ratio) ? '—' : ratio.toFixed(3)).padStart(6)}   ` +
      `${footY.toFixed(4).padStart(7)}   ${driftMm.toFixed(3)}`
    );
  });

  lines.push('');
  lines.push(
    maxFootYDriftMm < 1
      ? `✓ footY(接地高さ)は全距離で一定(最大ずれ ${maxFootYDriftMm.toFixed(4)}mm、浮動小数点誤差の範囲内)`
      : `⚠ footYが距離とともにずれています(最大 ${maxFootYDriftMm.toFixed(2)}mm)。` +
        `position.z以外の値が意図せず変化している可能性があります。`
  );
  lines.push(
    '注記: 「指定d」はplacement.zへ渡した値、「実深度」はカメラの実際の前方ベクトルへの' +
    '射影(真の値)。カメラが原点付近からワールド-Z方向を向いている場合(main.jsの静止時)は' +
    '両者はほぼ一致する。dev.htmlのOrbitControlsのように斜めの位置・向きのカメラでは' +
    '両者がズレるのが正常(バグではない)。比率の妥当性は必ず「実深度」列を基準に判断すること。'
  );

  // 測定終了後は必ず元の距離へ戻す(このツールが見た目に影響を残さないため)
  placement.z = originalZ;
  applyPlacement();

  return { lines, rows, maxFootYDriftMm };
}

/**
 * 較正パネルを構築する(dev.html用のUIラッパー)。
 * @param {HTMLElement} container
 * @param {object} deps
 * @param {THREE.PerspectiveCamera} deps.camera
 * @param {THREE.WebGLRenderer} deps.renderer 出力サイズ取得用
 * @param {() => object|null} deps.getCharacter MMDCharacter/SpriteCharacter
 * @param {object} deps.placement main.js/dev.jsのplacement状態オブジェクト
 *   ({x,y,z,rotY,scale})。このツールは呼び出し前後でzの値を書き換えて
 *   戻す(=一時的にテスト距離へ動かして測定し、終わったら元に戻す)。
 * @param {(p:object)=>void} deps.applyPlacement placement変更をcharacterへ
 *   反映する既存関数(main.js/dev.jsのapplyPlacement相当)。測定のためだけに
 *   一時的に距離を変えるので、必ずこれを呼んで実際に反映させてから測る。
 */
export function buildCalibrationPanel(container, { camera, renderer, getCharacter, placement, applyPlacement }) {
  container.innerHTML = `
    <div class="dsp-row">
      <label>実身長(m)</label>
      <input type="number" id="calib-real-height" min="0.3" max="3" step="0.01" value="1.6">
    </div>
    <button id="calib-run-btn" class="dsp-btn">距離ごとに検証を実行</button>
    <div id="calib-results" style="margin-top:10px; font-size:11px; color:#cfd3de; line-height:1.7; font-family:monospace; white-space:pre"></div>
    <div class="dsp-info" style="margin-top:8px">
      「実深度」基準の比率が全距離で1.0付近 → 投影は正しく、原因は別箇所(video側のcover/crop、
      unitToMeter、getWidth()等)。実深度が伸びるほど比率が1.0から乖離 → 投影/深度側の距離依存バグ。
      dev.htmlはOrbitControlsで視点が斜めのため、main.jsの実カメラでの再検証を推奨。
      このツールは数値を表示するだけで、見た目やスケールには一切手を加えない。
    </div>
  `;

  const heightInput = container.querySelector('#calib-real-height');
  const runBtn = container.querySelector('#calib-run-btn');
  const resultsEl = container.querySelector('#calib-results');

  runBtn.addEventListener('click', () => {
    const character = getCharacter();
    if (!character) {
      resultsEl.textContent = 'キャラクターが読み込まれていません。';
      return;
    }
    const realHeightMeters = parseFloat(heightInput.value) || 1.6;
    const result = runDistanceCalibration({ camera, renderer, character, placement, applyPlacement, realHeightMeters });
    resultsEl.textContent = result.lines.join('\n');
    console.log('[calibration-tool] results:\n' + result.lines.join('\n'));
  });
}
