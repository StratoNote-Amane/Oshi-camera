/* ============================================================
   character/idle-animator.js — アイドルアニメーション(呼吸/重心ゆれ/髪の揺れ)
   ------------------------------------------------------------
   character定義のidle.bonesに列挙されたボーンへ、サインカーブによる
   常時の微小回転を加算する。「生きている感じ」の演出。

   【重要・既存の挙動をそのまま維持している点】
   MMDCharacter.update()内で、このアイドルアニメは必ず
   pose-controller.update()の"後"に呼ばれる。idle対象ボーンの中には
   ポーズプリセット側でも同名のボーン(例:「下半身」「上半身2」)が
   角度を持つ場合があり、その場合はこのアイドルアニメが後勝ちで
   quaternionを上書きする(ポーズ側の静的な角度は当該ボーンに関しては
   反映されない)。これは元のcharacter.jsから存在した挙動で、今回の
   分割にあたって意図的に温存した(挙動を変えない方針のため)。
   ============================================================ */
import * as THREE from 'three';

const _tmpEuler = new THREE.Euler();
const _tmpQuat = new THREE.Quaternion();

/**
 * @param {object} args
 * @param {Record<string, THREE.Bone>} args.bonesByName
 * @param {Record<string, THREE.Quaternion>} args.bindQuats
 * @param {Array<{name:string,axis:'x'|'y'|'z',amplitudeDeg:number,periodSec:number,phase?:number}>} args.idleBones
 */
export function createIdleAnimator({ bonesByName, bindQuats, idleBones }) {
  let elapsed = 0;

  function update(dt) {
    elapsed += dt;
    idleBones.forEach((idle) => {
      const bone = bonesByName[idle.name];
      const bind = bindQuats[idle.name];
      if (!bone || !bind) return;
      const angle = Math.sin(elapsed * (Math.PI * 2 / idle.periodSec) + (idle.phase || 0)) * idle.amplitudeDeg;
      const e = { x: 0, y: 0, z: 0 };
      e[idle.axis] = angle;
      _tmpEuler.set(
        THREE.MathUtils.degToRad(e.x),
        THREE.MathUtils.degToRad(e.y),
        THREE.MathUtils.degToRad(e.z),
        'XYZ'
      );
      _tmpQuat.setFromEuler(_tmpEuler);
      bone.quaternion.copy(bind).multiply(_tmpQuat);
    });
  }

  return { update };
}
