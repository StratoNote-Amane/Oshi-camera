/* ============================================================
   character/mmd-character.js — MMDCharacterクラス(合成のみ)
   ------------------------------------------------------------
   expression-controller.js / pose-controller.js / idle-animator.js の
   3つのサブコントローラーを束ねる薄いクラス。main.js/dev.js/pose-ui.jsに
   対して見せる公開API(setTransform/getFootY/getWidth/setExpression/
   setPose/setBoneDelta/setGlobalOffset/resetGlobalOffset/
   resetPoseToDefault/getCurrentPoseBoneNames/poseTargets/globalOffset/
   update)は、分割前のcharacter.jsと完全に同一の形を保っている。
   ============================================================ */
import * as THREE from 'three';
import { computeUnitToMeter } from './scale.js';
import { createExpressionController } from './expression-controller.js';
import { createPoseController } from './pose-controller.js';
import { createIdleAnimator } from './idle-animator.js';

export class MMDCharacter {
  constructor(mesh, def) {
    this.root = mesh;
    this.unitToMeter = computeUnitToMeter(mesh, def);
    this.poses = def.poses || {};

    // ボーンのbind-pose(初期姿勢)を保存し、以後は「そこからの相対回転」でポーズを扱う
    this.bonesByName = {};
    this.bindQuats = {};
    if (mesh.skeleton) {
      mesh.skeleton.bones.forEach((b) => {
        this.bonesByName[b.name] = b;
        this.bindQuats[b.name] = b.quaternion.clone();
      });
    }
    const bindCenterPos = this.bonesByName['センター'] ? this.bonesByName['センター'].position.clone() : null;

    this._expressionController = createExpressionController({
      root: mesh,
      expressions: def.expressions || {},
      blinkMorph: def.blinkMorph || null,
      idleExprJitter: (def.idle && def.idle.expressionJitter) ? def.idle.expressionJitter : null,
    });
    this._poseController = createPoseController({
      bonesByName: this.bonesByName,
      bindQuats: this.bindQuats,
      poses: this.poses,
      bindCenterPos,
    });
    this._idleAnimator = createIdleAnimator({
      bonesByName: this.bonesByName,
      bindQuats: this.bindQuats,
      idleBones: (def.idle && def.idle.bones) ? def.idle.bones : [],
    });

    this._poseController.setPose('standing');
  }

  setTransform({ x, y, z, rotY, scale }) {
    this.root.position.set(x, y, z);
    this.root.rotation.y = rotY;
    this.root.scale.setScalar(this.unitToMeter * scale);
  }

  getFootY() {
    const box = new THREE.Box3().setFromObject(this.root);
    // 注記: Box3はbind-pose時の静的なバウンディングボックスを土台の変換行列で
    // 変換しているだけで、ボーンの実際の変形(ポーズ)までは反映しない。
    // センターオフセット(座りポーズ等)による沈み込みだけは既知の量なので、
    // ワールド座標系に換算して補正しておく(脚の曲げ自体までは反映できない簡易対応)。
    const worldShift = (this._poseController.centerOffsetCurrent.y || 0) * this.root.scale.y;
    return box.min.y + worldShift;
  }

  getWidth() {
    const box = new THREE.Box3().setFromObject(this.root);
    return Math.max(0.4, box.max.x - box.min.x);
  }

  setExpression(key) { this._expressionController.setExpression(key); }
  setPose(key) { this._poseController.setPose(key); }
  setBoneDelta(name, xyz) { this._poseController.setBoneDelta(name, xyz); }
  setGlobalOffset(key, degValue) { this._poseController.setGlobalOffset(key, degValue); }
  resetGlobalOffset() { this._poseController.resetGlobalOffset(); }
  resetPoseToDefault() { this._poseController.resetPoseToDefault(); }
  getCurrentPoseBoneNames() { return this._poseController.getCurrentPoseBoneNames(); }

  // pose-ui.jsがcharacter.poseTargets[name]/character.globalOffset[key]を
  // 直接プロパティ参照するため、getterで同一オブジェクト参照を透過する。
  get poseTargets() { return this._poseController.poseTargets; }
  get globalOffset() { return this._poseController.globalOffset; }

  update(dt) {
    this._expressionController.update(dt);
    // 重要: poseController → idleAnimator の順序を維持すること。
    // idle-animator.js冒頭のコメント参照(同名ボーンへの上書き挙動の温存)。
    this._poseController.update(dt);
    this._idleAnimator.update(dt);
  }
}
