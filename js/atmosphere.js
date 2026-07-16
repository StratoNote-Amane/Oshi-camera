/* ============================================================
   atmosphere.js — 距離による空気遠近法
   ------------------------------------------------------------
   背景: 「2本指の縦ドラッグでキャラを奥行き方向(Z)へ実際に動かせる」
   ようにしたことで、placement.zが初めて「見た目の距離」として機能する
   ようになった。しかしZを動かすだけでは、キャラは常に同じ彩度・
   同じコントラスト・同じ輪郭線の太さのまま縮小されるだけで、
   「遠くにあるものを、間に空気の層を挟んで見ている」感覚が出ない。
   これが「遠くに配置すると不自然」という指摘の核心だった。

   このモジュールは、キャラクターとカメラの距離に応じて
     - 彩度をわずかに落とす
     - 明部/暗部のコントラストをわずかに落とす(明るいグレーへ寄せる)
     - ごく薄いヘイズ色(青灰色寄り)を混ぜる
     - 輪郭線(OutlineEffect用のoutlineParameters)を細く・薄くする
   を行う。Fogは使わず(指示書の制約通り)、材質パラメータ側で処理する。

   【重要な設計上の注意】
   この関数はドラッグ中など高頻度で呼ばれる想定のため、呼ぶたびに
   thickness等を掛け算で縮めていくと際限なく劣化する。そのため、
   各材質の「元の値」を初回呼び出し時に一度だけ保存し(mat.userData._atmosBase*)、
   以後は常にその元の値を起点に計算し直す(累積させない)。
   ============================================================ */
import * as THREE from 'three';

// この距離(m)より近ければ変化なし。この距離(m)で最大の変化になる。
// 指示書の例(0〜2mは変化なし、7mで彩度85%程度)を踏まえつつ、
// このアプリの想定撮影距離(無人駅の対向ホーム等、概ね数十メートル=20m程度まで)
// に合わせて調整した値(2026年改訂: 9.0→20.0)。
// 旧値(9.0)のままだと、Z軸で10〜20m先まで正しく配置しても9m分の変化で
// 頭打ちになり、「距離のわりに空気感が伴わない=不自然に縮んだだけ」に
// 見える原因になっていた(shadow-rig.jsの影フェードも本関数を共有するため、
// この修正だけで両方に反映される)。
// 実機で見て「効きすぎ/効かなさすぎ」であればここを直接調整する。
const NEAR_M = 2.2;
const FAR_M = 20.0;

// 遠景に混ぜるヘイズ色(薄い青灰色。晴天の遠景が青みがかって見える現象の簡易近似)
const HAZE_TINT = new THREE.Color(0x9fb2c2);

function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * 距離に応じた0(近い、無変化)〜1(遠い、最大変化)の係数を返す。
 * @param {number} distanceMeters
 */
export function computeHazeFactor(distanceMeters) {
  return smoothstep(NEAR_M, FAR_M, distanceMeters);
}

function applyToMaterial(mat, factor) {
  if (!mat) return;

  // 色: 初回のみ元の色を保存し、以後は常にそこから計算する
  if (mat.color) {
    if (!mat.userData._atmosBaseColor) {
      mat.userData._atmosBaseColor = mat.color.clone();
    }
    const base = mat.userData._atmosBaseColor;
    // 彩度ダウン: グレースケール値へ引き寄せる(最大40%)
    const gray = base.r * 0.299 + base.g * 0.587 + base.b * 0.114;
    const desatR = base.r + (gray - base.r) * 0.4 * factor;
    const desatG = base.g + (gray - base.g) * 0.4 * factor;
    const desatB = base.b + (gray - base.b) * 0.4 * factor;
    // コントラストダウン: 明るいグレー(0.75)へ引き寄せる(最大25%)
    const CONTRAST_TARGET = 0.75;
    const contR = desatR + (CONTRAST_TARGET - desatR) * 0.25 * factor;
    const contG = desatG + (CONTRAST_TARGET - desatG) * 0.25 * factor;
    const contB = desatB + (CONTRAST_TARGET - desatB) * 0.25 * factor;
    mat.color.setRGB(contR, contG, contB).lerp(HAZE_TINT, 0.18 * factor);
  }

  // 輪郭線: 初回のみ元の太さ/濃さを保存し、以後は常にそこから計算する
  const op = mat.userData && mat.userData.outlineParameters;
  if (op) {
    if (mat.userData._atmosBaseOutline === undefined) {
      mat.userData._atmosBaseOutline = { thickness: op.thickness, alpha: op.alpha };
    }
    const base = mat.userData._atmosBaseOutline;
    op.thickness = base.thickness * (1 - 0.55 * factor);
    op.alpha = base.alpha * (1 - 0.45 * factor);
  }
}

/**
 * キャラクター(MMDCharacter/SpriteCharacterどちらのrootでもよい)に
 * 距離に応じた空気遠近法を適用する。
 * @param {THREE.Object3D} root キャラクターのroot(mesh or sprite)
 * @param {number} distanceMeters カメラからの距離(m目安)
 */
export function applyAtmosphericPerspective(root, distanceMeters) {
  if (!root || !root.material) return;
  const factor = computeHazeFactor(distanceMeters);
  const mats = Array.isArray(root.material) ? root.material : [root.material];
  mats.forEach((mat) => applyToMaterial(mat, factor));
}
