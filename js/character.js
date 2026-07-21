/* ============================================================
   character.js — 公開APIバレル(2026/07 責務分割)
   ------------------------------------------------------------
   従来ここに全ロジックが同居していたが、モーション/ポーズ/表情の
   今後の大幅な拡張を見据え、責務ごとにjs/character/以下へ分割した。
   このファイルは再エクスポートのみを行う薄いバレルとして残し、
   main.js・dev.js・pose-ui.jsのimportパス('./js/character.js')を
   一切変更せずに済むようにしている。

   分割後の構成:
     js/character/scale.js               実寸スケール計算
     js/character/global-offset.js       全体オフセット定義データ
     js/character/expression-controller.js 表情モーフ/まばたき
     js/character/pose-controller.js     ポーズのボーン回転制御
     js/character/idle-animator.js       呼吸/重心ゆれ/髪の揺れ
     js/character/mmd-character.js       上記を束ねるMMDCharacter
     js/character/sprite-character.js    2D透過素材キャラクター
     js/character/material-utils.js      輪郭線等の材質調整
     js/character/loader.js              ロード/破棄処理

   将来のダンスモーション/ループモーション機能は、
   js/character/motion-controller.js として新設し、pose-controller.js
   と連携させる形を想定している(このファイル・MMDCharacterクラス
   自体を太らせない設計)。
   ============================================================ */
export { computeUnitToMeter } from './character/scale.js';
export { GLOBAL_OFFSET_PARAMS } from './character/global-offset.js';
export { MMDCharacter } from './character/mmd-character.js';
export { SpriteCharacter } from './character/sprite-character.js';
export { softenMaterials } from './character/material-utils.js';
export { disposeCharacter, loadCharacter } from './character/loader.js';
