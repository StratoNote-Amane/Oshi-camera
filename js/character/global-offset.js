/* ============================================================
   character/global-offset.js — 全体オフセット（基本ポーズ＋差分）の定義
   ------------------------------------------------------------
   ボーンを個別に選ぶ精密調整(createPoseTuner)とは別に、少数の
   「向き/傾き」パラメータで複数ボーンを一括制御するための対応表。
   ここが唯一の定義元(single source of truth)。UI側(pose-ui.js)は
   GLOBAL_OFFSET_PARAMSを読んでスライダーを自動生成する。
   その場限りの調整であり、保存はしない(ポーズ切替で自動リセット)。
   ============================================================ */
export const GLOBAL_OFFSET_BONES = {
  bodyYaw:   [{ bone: '上半身', axis: 'y', weight: 1.0 }, { bone: '下半身', axis: 'y', weight: 0.35 }],
  bodyPitch: [{ bone: '上半身', axis: 'x', weight: 1.0 }],
  headYaw:   [{ bone: '首', axis: 'y', weight: 0.45 }, { bone: '頭', axis: 'y', weight: 0.55 }],
  headRoll:  [{ bone: '頭', axis: 'z', weight: 1.0 }],
};

export const GLOBAL_OFFSET_BONE_NAMES = new Set();
Object.values(GLOBAL_OFFSET_BONES).forEach((arr) => arr.forEach((m) => GLOBAL_OFFSET_BONE_NAMES.add(m.bone)));

export const GLOBAL_OFFSET_DEFAULT = { bodyYaw: 0, bodyPitch: 0, headYaw: 0, headRoll: 0 };

// UI(pose-ui.js)がスライダーを自動生成するための一覧。可動域(range)は
// 度数、±rangeがスライダーのmin/max。実機で狭すぎ/広すぎればここだけ調整すればよい。
export const GLOBAL_OFFSET_PARAMS = [
  { key: 'bodyYaw', label: '体の向き', range: 20 },
  { key: 'bodyPitch', label: '体の傾き', range: 15 },
  { key: 'headYaw', label: '顔の向き', range: 25 },
  { key: 'headRoll', label: '首かしげ', range: 20 },
];
