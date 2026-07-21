/* ============================================================
   character/pose-controller.js — ポーズ(ボーン回転)制御
   ------------------------------------------------------------
   bind-pose相対のボーン回転プリセット(setPose)、個別ボーン調整
   (setBoneDelta、開発者向けポーズ調整モード用)、全体オフセット
   (setGlobalOffset、体の向き/傾き・顔の向き/首かしげの一括制御)、
   センターオフセット(座りポーズ等の沈み込み)をまとめて扱う。

   【将来の拡張ポイント】
   モーション/ダンス機能(ROADMAPの「ダンスモーション」「Loop Motion」)は、
   このファイルの隣に character/motion-controller.js として新設し、
   キーフレーム列を再生してpose-controllerのposeTargetsへ書き込む
   (または上書き加算する)形で連携させる想定。character.js本体や
   MMDCharacterクラスを太らせずに追加できるよう、この分割を行った。
   ============================================================ */
import * as THREE from 'three';
import { GLOBAL_OFFSET_BONES, GLOBAL_OFFSET_BONE_NAMES, GLOBAL_OFFSET_DEFAULT } from './global-offset.js';

const _tmpEuler = new THREE.Euler();
const _tmpQuat = new THREE.Quaternion();
const AXIS_IDX = { x: 0, y: 1, z: 2 };

/**
 * @param {object} args
 * @param {Record<string, THREE.Bone>} args.bonesByName
 * @param {Record<string, THREE.Quaternion>} args.bindQuats
 * @param {object} args.poses CHARACTERS定義のposes
 * @param {THREE.Vector3|null} args.bindCenterPos センターボーンのbind-pose位置
 */
export function createPoseController({ bonesByName, bindQuats, poses, bindCenterPos }) {
  const allPosableBones = new Set();
  Object.values(poses).forEach((p) => {
    Object.keys(p.bones || {}).forEach((n) => allPosableBones.add(n));
  });
  // 全体オフセット対象のボーン(上半身/下半身/首/頭)は、個別のポーズプリセットに
  // 数値が定義されていなくても常に回転対象に含めておく(そうしないとオフセットを
  // 与えても何も動かないボーンが出てしまう)。
  GLOBAL_OFFSET_BONE_NAMES.forEach((n) => allPosableBones.add(n));

  // poseTargets/globalOffset/centerOffsetCurrentは、外部(pose-ui.js・
  // MMDCharacter.getFootY())から直接プロパティ参照される想定のため、
  // オブジェクト自体の参照は生成時から不変に保ち、中身だけを書き換える。
  const poseTargets = {};
  const poseCurrent = {};
  const globalOffset = { ...GLOBAL_OFFSET_DEFAULT };
  const centerOffsetCurrent = { x: 0, y: 0, z: 0 };

  let presetBoneValues = {};
  let centerOffsetTarget = { x: 0, y: 0, z: 0 };
  let activePoseKey = 'standing';
  let wiggle = null;
  let elapsed = 0;

  function resetGlobalOffsetValues() {
    Object.assign(globalOffset, GLOBAL_OFFSET_DEFAULT);
  }

  function setPose(key) {
    const preset = poses[key] || { bones: {} };
    activePoseKey = key;
    const bones = preset.bones || {};
    presetBoneValues = {};
    allPosableBones.forEach((name) => {
      const base = bones[name] ? [...bones[name]] : [0, 0, 0];
      presetBoneValues[name] = base;
      poseTargets[name] = [...base];
    });
    wiggle = preset.wiggle ? { ...preset.wiggle, forPose: key } : null;
    centerOffsetTarget = preset.centerOffset ? { ...preset.centerOffset } : { x: 0, y: 0, z: 0 };
    // ポーズを切り替えたら全体オフセットは自動的に0へ戻す(「その場限りの調整」という
    // 設計のため。前のポーズ用に合わせた傾きを次のポーズへ持ち越さない)。
    resetGlobalOffsetValues();
  }

  // ポーズ調整モードから直接呼ぶ：即座に反映したいのでtargetとcurrentの両方を書き換える
  function setBoneDelta(name, xyz) {
    poseTargets[name] = [...xyz];
    poseCurrent[name] = [...xyz];
  }

  function applyGlobalOffset() {
    GLOBAL_OFFSET_BONE_NAMES.forEach((name) => {
      const base = presetBoneValues[name] || [0, 0, 0];
      const add = [0, 0, 0];
      Object.entries(GLOBAL_OFFSET_BONES).forEach(([offsetKey, mappings]) => {
        const val = globalOffset[offsetKey] || 0;
        if (!val) return;
        mappings.forEach(({ bone, axis, weight }) => {
          if (bone !== name) return;
          add[AXIS_IDX[axis]] += val * weight;
        });
      });
      const next = [base[0] + add[0], base[1] + add[1], base[2] + add[2]];
      poseTargets[name] = next;
      // スライダー操作への追従を即座に見せたいので、ボーン個別調整モードと同様に
      // currentも同時に書き換える(lerpで遅延させない)。
      poseCurrent[name] = [...next];
    });
  }

  function setGlobalOffset(key, degValue) {
    if (!(key in globalOffset)) return;
    globalOffset[key] = degValue;
    applyGlobalOffset();
  }
  function resetGlobalOffset() {
    resetGlobalOffsetValues();
    applyGlobalOffset();
  }
  function resetPoseToDefault() {
    setPose(activePoseKey);
    allPosableBones.forEach((name) => {
      poseCurrent[name] = [...(poseTargets[name] || [0, 0, 0])];
    });
  }
  function getCurrentPoseBoneNames() {
    const preset = poses[activePoseKey];
    return preset ? Object.keys(preset.bones || {}) : [];
  }

  function update(dt) {
    elapsed += dt;
    const POSE_LERP = 10;
    allPosableBones.forEach((name) => {
      const bone = bonesByName[name];
      const bind = bindQuats[name];
      if (!bone || !bind) return;
      const target = poseTargets[name] || [0, 0, 0];
      const cur = poseCurrent[name] || (poseCurrent[name] = [0, 0, 0]);
      for (let i = 0; i < 3; i++) cur[i] += (target[i] - cur[i]) * Math.min(1, dt * POSE_LERP);

      let ex = cur[0], ey = cur[1], ez = cur[2];
      if (wiggle && wiggle.bone === name && activePoseKey === wiggle.forPose) {
        const w = Math.sin(elapsed * Math.PI * 2 * wiggle.speedHz) * wiggle.amplitude;
        if (wiggle.axis === 'x') ex += w;
        else if (wiggle.axis === 'y') ey += w;
        else ez += w;
      }
      _tmpEuler.set(
        THREE.MathUtils.degToRad(ex),
        THREE.MathUtils.degToRad(ey),
        THREE.MathUtils.degToRad(ez),
        'XYZ'
      );
      _tmpQuat.setFromEuler(_tmpEuler);
      bone.quaternion.copy(bind).multiply(_tmpQuat);
    });

    if (bindCenterPos) {
      const centerBone = bonesByName['センター'];
      const CENTER_LERP = 6;
      ['x', 'y', 'z'].forEach((axis) => {
        centerOffsetCurrent[axis] += (centerOffsetTarget[axis] - centerOffsetCurrent[axis]) * Math.min(1, dt * CENTER_LERP);
      });
      centerBone.position.set(
        bindCenterPos.x + centerOffsetCurrent.x,
        bindCenterPos.y + centerOffsetCurrent.y,
        bindCenterPos.z + centerOffsetCurrent.z
      );
    }
  }

  return {
    poseTargets,
    globalOffset,
    centerOffsetCurrent,
    setPose,
    setBoneDelta,
    setGlobalOffset,
    resetGlobalOffset,
    resetPoseToDefault,
    getCurrentPoseBoneNames,
    update,
    get activePoseKey() { return activePoseKey; },
  };
}
