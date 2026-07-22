/* ============================================================
   shadow-quality.js — 影システムの品質プリセット
   ------------------------------------------------------------
   なぜプリセット化するか:
   ShadowMapの解像度・ぼかし半径・bias類はiPhone 14のGPU負荷と
   見た目の綺麗さのトレードオフそのものであり、実機の熱状態や
   将来の対応端末拡大に応じて後から一括で調整できる必要がある。
   個々のパラメータをmain.js/dev.jsへ直書きすると、実機検証のたびに
   複数ファイルを触ることになり「どの値をどのプリセットに戻すか」の
   追跡が困難になる。プリセットテーブルをこのファイル1つに集約し、
   ShadowRigは常に「現在のプリセット」を通じてのみ数値を参照する。

   bias/normalBiasの初期値は「シャドウアクネ(縞模様)が出ない最小値」を
   実機未検証の状態でThree.js公式サンプルの経験則から仮置きしている
   (CONSTRAINTS.md 5節: 見た目の数値はすべてたたき台、実機確認前提)。
   ============================================================ */

export const SHADOW_QUALITY_PRESETS = {
  low: {
    label: 'Low',
    mapSize: 512,
    radius: 1.5,          // PCFSoftShadowMapのぼかしサンプル半径
    bias: -0.0015,
    normalBias: 0.02,
    updateIntervalMs: 400, // 静止時の更新間隔(このミリ秒に1回だけ再計算)
    contactSamples: 'low',
  },
  medium: {
    label: 'Medium',
    mapSize: 1024,
    radius: 2.5,
    bias: -0.0012,
    normalBias: 0.018,
    updateIntervalMs: 200,
    contactSamples: 'medium',
  },
  high: {
    label: 'High',
    mapSize: 2048,
    radius: 3.5,
    bias: -0.0009,
    normalBias: 0.015,
    updateIntervalMs: 100,
    contactSamples: 'high',
  },
  ultra: {
    label: 'Ultra',
    mapSize: 4096,
    radius: 4.5,
    bias: -0.0007,
    normalBias: 0.012,
    updateIntervalMs: 0, // 0 = 毎フレーム更新(静止最適化を無効化)
    contactSamples: 'high',
  },
};

export const DEFAULT_SHADOW_QUALITY = 'medium';

export function resolveQuality(name) {
  return SHADOW_QUALITY_PRESETS[name] || SHADOW_QUALITY_PRESETS[DEFAULT_SHADOW_QUALITY];
}
