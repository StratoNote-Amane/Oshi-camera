/* ============================================================
   js/perceptual-scale.js — 知覚スケール補正(新規、演出専用)
   ------------------------------------------------------------
   20260722平面推定指示書 Part7 対応。

   Three.jsの投影計算自体は数学的に正しいが、実際のスマートフォン
   撮影では遠距離の人物が小さく見えすぎ「模型のような」印象になり
   やすい。この違和感を軽減するため、距離に応じて見た目のスケール
   „だけ“ を補正する。これは演出であり、物理計算の一部ではない
   (unitToMeter・placement.scale・calibration-tool.jsの物理計算には
   一切触れない、指示書Part7/Part10の要件)。

   呼び出し側(main.js)は、この関数の戻り値を
   character.setTransform()へ渡す直前にだけ乗算し、
   placement.scale自体には書き戻さないこと(Part8参照)。
   ============================================================ */

const DEFAULT_OPTIONS = {
  // 2026/07/28: 実機写真で「部屋の家具と比べてキャラクターがやや小さい」
  // というフィードバックを受け、補正が効き始める距離を3m→1.5mへ前倒しし、
  // 頭打ちの倍率も1.3→1.4へわずかに引き上げた。いずれも実機確認前の
  // たたき台であり、まだ小さい/逆に大きすぎる場合は数値の再調整が必要。
  nearMeters: 1.5,   // ここまでは補正なし(倍率1.0)
  farMeters: 15,     // ここで補正が頭打ちになる
  maxFactor: 1.4,    // 頭打ち時の最大倍率
};

function smoothstep(edge0, edge1, x) {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t); // 線形補間は禁止(指示書)なのでsmoothstepを使用
}

/**
 * @param {number} distanceMeters カメラからキャラクターまでの距離(m)
 * @param {object} [options]
 * @param {number} [options.nearMeters]
 * @param {number} [options.farMeters]
 * @param {number} [options.maxFactor]
 * @returns {number} 1.0(補正なし)〜maxFactor程度の倍率
 */
export function computePerceptualScaleFactor(distanceMeters, options = {}) {
  const { nearMeters, farMeters, maxFactor } = { ...DEFAULT_OPTIONS, ...options };
  const t = smoothstep(nearMeters, farMeters, distanceMeters);
  return 1 + (maxFactor - 1) * t;
}
