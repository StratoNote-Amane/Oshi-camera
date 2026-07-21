/* ============================================================
   character/scale.js — 実寸スケールの決定方式
   ------------------------------------------------------------
   【背景】
   従来は「PMXの単位慣習(1ユニット≒8cm)」という未検証の仮定に基づく
   固定値unitToMeter(=0.081)を、天音かなた・音乃瀬奏の両モデルに
   共通で使い回していた(characters-data.js参照)。

   【方式】
   キャラクター定義(def)に targetHeightMeters(そのキャラクターの
   設定上の実身長、m単位)が指定されている場合、モデル読み込み直後
   (transform適用前のbind-pose状態)にメッシュの実際のバウンディング
   ボックス高さ(PMX生の単位)を測定し、
     computedUnitToMeter = targetHeightMeters / bindPoseHeightUnits
   として動的に逆算する。これによりPMXの単位慣習が何であっても、
   「そのキャラクターの実身長」という既知の事実から正しい実寸になる。

   targetHeightMetersが未指定のdefに対しては、従来のunitToMeter
   固定値へそのままフォールバックする(完全後方互換)。

   2026/07 実機検証済み: かなた(実測19.0765unit, 1.545m)→逆算0.08099、
   音乃瀬奏(実測19.7797unit, 1.602m)→逆算0.08099。旧固定値0.081との
   差は0.01%で、旧推測値はほぼ正確だったことを確認済み。
   ============================================================ */
import * as THREE from 'three';

export function computeUnitToMeter(mesh, def) {
  if (!def.targetHeightMeters) {
    return def.unitToMeter; // 後方互換: 未設定なら従来の推測値のまま
  }
  // この時点でmeshにはまだtransform(position/rotation/scale)が
  // 一切適用されていない(loadCharacter内でnew MMDCharacter()を呼ぶ
  // 直前の状態)。Box3はbind-poseの生のジオメトリをそのまま反映する。
  const box = new THREE.Box3().setFromObject(mesh);
  const bindHeightUnits = box.max.y - box.min.y;
  if (!(bindHeightUnits > 0) || !isFinite(bindHeightUnits)) {
    console.warn(
      `[character/scale.js] ${def.id}: バインドポーズの高さが正しく測定できませんでした` +
      `(box height=${bindHeightUnits})。unitToMeter固定値へフォールバックします。`
    );
    return def.unitToMeter;
  }
  const computed = def.targetHeightMeters / bindHeightUnits;
  console.log(
    `[character.js] ${def.id}: 実測バインド高さ=${bindHeightUnits.toFixed(4)}unit, ` +
    `targetHeightMeters=${def.targetHeightMeters}m → 逆算unitToMeter=${computed.toFixed(5)} ` +
    `(旧固定値=${def.unitToMeter})`
  );
  return computed;
}
