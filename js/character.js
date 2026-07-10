/* ============================================================
   character.js — キャラクターの抽象化
   ------------------------------------------------------------
   MMD(3Dスキンメッシュ)と2D透過素材(ビルボード)を同じ
   setTransform()/setExpression()/setPose()/update() インターフェース
   で扱うためのクラス群。main.js(カメラ本体)とdev.js(PC開発者モード)の
   両方から共有される。
   ============================================================ */
import * as THREE from 'three';

const _tmpEuler = new THREE.Euler();
const _tmpQuat = new THREE.Quaternion();

export class MMDCharacter {
  constructor(mesh, def) {
    this.root = mesh;
    this.unitToMeter = def.unitToMeter;
    this.expressions = def.expressions || {};
    this.blinkMorph = def.blinkMorph || null;
    this.poses = def.poses || {};

    this.exprWeights = {};
    this.exprTargets = {};
    this.setExpression('normal');
    this.blinkState = 'idle';
    this.blinkTimer = 2 + Math.random() * 3;
    this.blinkWeight = 0;

    // ボーンのbind-pose(初期姿勢)を保存し、以後は「そこからの相対回転」でポーズを扱う
    this.bonesByName = {};
    this.bindQuats = {};
    if (mesh.skeleton) {
      mesh.skeleton.bones.forEach((b) => {
        this.bonesByName[b.name] = b;
        this.bindQuats[b.name] = b.quaternion.clone();
      });
    }
    this.allPosableBones = new Set();
    Object.values(this.poses).forEach((p) => {
      Object.keys(p.bones || {}).forEach((n) => this.allPosableBones.add(n));
    });
    this.poseTargets = {};
    this.poseCurrent = {};
    this.activePoseKey = 'standing';
    this._poseElapsed = 0;
    this.wiggle = null;

    this.idleBones = (def.idle && def.idle.bones) ? def.idle.bones : [];
    this.idleExprJitter = (def.idle && def.idle.expressionJitter) ? def.idle.expressionJitter : null;

    this.bindCenterPos = this.bonesByName['センター'] ? this.bonesByName['センター'].position.clone() : null;
    this.centerOffsetTarget = { x: 0, y: 0, z: 0 };
    this.centerOffsetCurrent = { x: 0, y: 0, z: 0 };

    this.setPose('standing');
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
    const worldShift = (this.centerOffsetCurrent ? this.centerOffsetCurrent.y : 0) * this.root.scale.y;
    return box.min.y + worldShift;
  }
  getWidth() {
    const box = new THREE.Box3().setFromObject(this.root);
    return Math.max(0.4, box.max.x - box.min.x);
  }
  setExpression(key) {
    const preset = this.expressions[key];
    if (!preset) return;
    this.exprTargets = preset.weights;
  }
  setPose(key) {
    const preset = this.poses[key] || { bones: {} };
    this.activePoseKey = key;
    const bones = preset.bones || {};
    this.allPosableBones.forEach((name) => {
      this.poseTargets[name] = bones[name] ? [...bones[name]] : [0, 0, 0];
    });
    this.wiggle = preset.wiggle ? { ...preset.wiggle, forPose: key } : null;
    this.centerOffsetTarget = preset.centerOffset ? { ...preset.centerOffset } : { x: 0, y: 0, z: 0 };
  }
  // ポーズ調整モードから直接呼ぶ：即座に反映したいのでtargetとcurrentの両方を書き換える
  setBoneDelta(name, xyz) {
    this.poseTargets[name] = [...xyz];
    this.poseCurrent[name] = [...xyz];
  }
  resetPoseToDefault() {
    this.setPose(this.activePoseKey);
    this.allPosableBones.forEach((name) => {
      this.poseCurrent[name] = [...(this.poseTargets[name] || [0, 0, 0])];
    });
  }
  getCurrentPoseBoneNames() {
    const preset = this.poses[this.activePoseKey];
    return preset ? Object.keys(preset.bones || {}) : [];
  }
  update(dt) {
    const dict = this.root.morphTargetDictionary;
    const infl = this.root.morphTargetInfluences;
    if (dict && infl) {
      const allNames = new Set([...Object.keys(this.exprWeights), ...Object.keys(this.exprTargets)]);
      const LERP_SPEED = 8;
      for (const name of allNames) {
        const cur = this.exprWeights[name] || 0;
        const target = this.exprTargets[name] || 0;
        const next = cur + (target - cur) * Math.min(1, dt * LERP_SPEED);
        this.exprWeights[name] = next;
        const idx = dict[name];
        if (idx !== undefined) infl[idx] = next;
      }
      if (this.blinkMorph && dict[this.blinkMorph] !== undefined) {
        this.blinkTimer -= dt;
        if (this.blinkState === 'idle' && this.blinkTimer <= 0) this.blinkState = 'closing';
        const CLOSE_SPEED = 14, OPEN_SPEED = 10;
        if (this.blinkState === 'closing') {
          this.blinkWeight = Math.min(1, this.blinkWeight + dt * CLOSE_SPEED);
          if (this.blinkWeight >= 1) this.blinkState = 'opening';
        } else if (this.blinkState === 'opening') {
          this.blinkWeight = Math.max(0, this.blinkWeight - dt * OPEN_SPEED);
          if (this.blinkWeight <= 0) { this.blinkState = 'idle'; this.blinkTimer = 2.2 + Math.random() * 3.5; }
        }
        const idx = dict[this.blinkMorph];
        const base = this.exprWeights[this.blinkMorph] || 0;
        infl[idx] = Math.max(base, this.blinkWeight);
      }
      if (this.idleExprJitter) {
        const { morphs, amplitude, periodSec } = this.idleExprJitter;
        morphs.forEach((name, i) => {
          const idx = dict[name];
          if (idx === undefined) return;
          const j = Math.sin(this._poseElapsed * (Math.PI * 2 / periodSec) + i * 2.1) * amplitude;
          infl[idx] = THREE.MathUtils.clamp((infl[idx] || 0) + j, 0, 1);
        });
      }
    }

    this._poseElapsed += dt;
    const POSE_LERP = 10;
    this.allPosableBones.forEach((name) => {
      const bone = this.bonesByName[name];
      const bind = this.bindQuats[name];
      if (!bone || !bind) return;
      const target = this.poseTargets[name] || [0, 0, 0];
      const cur = this.poseCurrent[name] || (this.poseCurrent[name] = [0, 0, 0]);
      for (let i = 0; i < 3; i++) cur[i] += (target[i] - cur[i]) * Math.min(1, dt * POSE_LERP);

      let ex = cur[0], ey = cur[1], ez = cur[2];
      if (this.wiggle && this.wiggle.bone === name && this.activePoseKey === this.wiggle.forPose) {
        const w = Math.sin(this._poseElapsed * Math.PI * 2 * this.wiggle.speedHz) * this.wiggle.amplitude;
        if (this.wiggle.axis === 'x') ex += w;
        else if (this.wiggle.axis === 'y') ey += w;
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

    this.idleBones.forEach((idle) => {
      const bone = this.bonesByName[idle.name];
      const bind = this.bindQuats[idle.name];
      if (!bone || !bind) return;
      const angle = Math.sin(this._poseElapsed * (Math.PI * 2 / idle.periodSec) + (idle.phase || 0)) * idle.amplitudeDeg;
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

    if (this.bindCenterPos) {
      const centerBone = this.bonesByName['センター'];
      const CENTER_LERP = 6;
      ['x', 'y', 'z'].forEach((axis) => {
        this.centerOffsetCurrent[axis] += (this.centerOffsetTarget[axis] - this.centerOffsetCurrent[axis]) * Math.min(1, dt * CENTER_LERP);
      });
      centerBone.position.set(
        this.bindCenterPos.x + this.centerOffsetCurrent.x,
        this.bindCenterPos.y + this.centerOffsetCurrent.y,
        this.bindCenterPos.z + this.centerOffsetCurrent.z
      );
    }
  }
}

export class SpriteCharacter {
  constructor(sprite, def) {
    this.root = sprite;
    this.heightMeters = def.heightMeters;
    this.aspect = def.aspect;
    sprite.center.set(0.5, 0);
  }
  setTransform({ x, y, z, rotY, scale }) {
    this.root.position.set(x, y, z);
    this.root.material.rotation = rotY;
    const h = this.heightMeters * scale;
    this.root.scale.set(h * this.aspect, h, 1);
  }
  getFootY() { return this.root.position.y; }
  getWidth() { return this.root.scale.x; }
  setExpression() {}
  setPose() {}
  getCurrentPoseBoneNames() { return []; }
  update() {}
}

/* ============================================================
   材質の調整（MMDらしさを抑える：輪郭線を細く・トゥーンの段差を滑らかに）
   ============================================================ */
export function softenMaterials(mesh) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  mats.forEach((mat) => {
    if (!mat) return;
    if (mat.userData && mat.userData.outlineParameters) {
      const op = mat.userData.outlineParameters;
      op.thickness = (op.thickness || 0.003) * 0.4;
      op.alpha = 0.55;
      if (mat.color) {
        op.color = [mat.color.r * 0.35, mat.color.g * 0.3, mat.color.b * 0.35];
      }
    }
    if (mat.gradientMap) {
      mat.gradientMap.magFilter = THREE.LinearFilter;
      mat.gradientMap.minFilter = THREE.LinearFilter;
      mat.gradientMap.needsUpdate = true;
    }
  });
}

/**
 * PMX(MMD)または2Dスプライトのキャラクターをロードする共通ヘルパー。
 * @param {object} def CHARACTERS配列の1エントリ
 * @param {object} deps { THREE, MMDLoader, scene }
 * @returns {Promise<MMDCharacter|SpriteCharacter>}
 */
export function loadCharacter(def, { MMDLoader, scene }, callbacks = {}) {
  const { onProgress, onError } = callbacks;
  if (def.type === 'mmd') {
    const loader = new MMDLoader();
    loader.load(
      def.path,
      (mesh) => {
        scene.add(mesh);
        softenMaterials(mesh);
        const character = new MMDCharacter(mesh, def);
        if (callbacks.onLoad) callbacks.onLoad(character);
      },
      (xhr) => { if (onProgress) onProgress(xhr); },
      (err) => { if (onError) onError(err); }
    );
  } else if (def.type === 'sprite') {
    const texLoader = new THREE.TextureLoader();
    texLoader.load(def.path, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      const aspect = tex.image.width / tex.image.height;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
      const sprite = new THREE.Sprite(mat);
      scene.add(sprite);
      const character = new SpriteCharacter(sprite, { ...def, aspect });
      if (callbacks.onLoad) callbacks.onLoad(character);
    });
  }
}
