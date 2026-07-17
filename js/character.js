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

/* ============================================================
   全体オフセット（基本ポーズ＋差分）の定義
   ------------------------------------------------------------
   ボーンを個別に選ぶ精密調整(createPoseTuner)とは別に、少数の
   「向き/傾き」パラメータで複数ボーンを一括制御するための対応表。
   ここが唯一の定義元(single source of truth)。UI側(pose-ui.js)は
   GLOBAL_OFFSET_PARAMSを読んでスライダーを自動生成する。
   その場限りの調整であり、保存はしない(ポーズ切替で自動リセット)。
   ============================================================ */
const GLOBAL_OFFSET_BONES = {
  bodyYaw:   [{ bone: '上半身', axis: 'y', weight: 1.0 }, { bone: '下半身', axis: 'y', weight: 0.35 }],
  bodyPitch: [{ bone: '上半身', axis: 'x', weight: 1.0 }],
  headYaw:   [{ bone: '首', axis: 'y', weight: 0.45 }, { bone: '頭', axis: 'y', weight: 0.55 }],
  headRoll:  [{ bone: '頭', axis: 'z', weight: 1.0 }],
};
const GLOBAL_OFFSET_BONE_NAMES = new Set();
Object.values(GLOBAL_OFFSET_BONES).forEach((arr) => arr.forEach((m) => GLOBAL_OFFSET_BONE_NAMES.add(m.bone)));
const GLOBAL_OFFSET_DEFAULT = { bodyYaw: 0, bodyPitch: 0, headYaw: 0, headRoll: 0 };

// UI(pose-ui.js)がスライダーを自動生成するための一覧。可動域(range)は
// 度数、±rangeがスライダーのmin/max。実機で狭すぎ/広すぎればここだけ調整すればよい。
export const GLOBAL_OFFSET_PARAMS = [
  { key: 'bodyYaw', label: '体の向き', range: 20 },
  { key: 'bodyPitch', label: '体の傾き', range: 15 },
  { key: 'headYaw', label: '顔の向き', range: 25 },
  { key: 'headRoll', label: '首かしげ', range: 20 },
];

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
    // 全体オフセット対象のボーン(上半身/下半身/首/頭)は、個別のポーズプリセットに
    // 数値が定義されていなくても常に回転対象に含めておく(そうしないとオフセットを
    // 与えても何も動かないボーンが出てしまう)。
    GLOBAL_OFFSET_BONE_NAMES.forEach((n) => this.allPosableBones.add(n));
    this.poseTargets = {};
    this.poseCurrent = {};
    this.presetBoneValues = {};
    this.globalOffset = { ...GLOBAL_OFFSET_DEFAULT };
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
  /**
   * 診断用: 現在のroot.scale(unitToMeter*scale)が反映された状態での、
   * ワールド空間での実際の高さ(m)を返す。unitToMeter/scaleの計算が
   * 意図通りかを実測値として確認するために使う(例: main.jsのデバッグ表示)。
   */
  getHeight() {
    const box = new THREE.Box3().setFromObject(this.root);
    return box.max.y - box.min.y;
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
    this.presetBoneValues = {};
    this.allPosableBones.forEach((name) => {
      const base = bones[name] ? [...bones[name]] : [0, 0, 0];
      this.presetBoneValues[name] = base;
      this.poseTargets[name] = [...base];
    });
    this.wiggle = preset.wiggle ? { ...preset.wiggle, forPose: key } : null;
    this.centerOffsetTarget = preset.centerOffset ? { ...preset.centerOffset } : { x: 0, y: 0, z: 0 };
    // ポーズを切り替えたら全体オフセットは自動的に0へ戻す(「その場限りの調整」という
    // 設計のため。前のポーズ用に合わせた傾きを次のポーズへ持ち越さない)。
    this.globalOffset = { ...GLOBAL_OFFSET_DEFAULT };
  }
  // ポーズ調整モードから直接呼ぶ：即座に反映したいのでtargetとcurrentの両方を書き換える
  setBoneDelta(name, xyz) {
    this.poseTargets[name] = [...xyz];
    this.poseCurrent[name] = [...xyz];
  }
  /**
   * 全体オフセット（体の向き/傾き・顔の向き/首かしげ）を1パラメータ分更新する。
   * @param {'bodyYaw'|'bodyPitch'|'headYaw'|'headRoll'} key
   * @param {number} degValue 度数
   * 注意: 上半身/下半身/首/頭の4ボーンにのみ影響する。ポーズ調整モード(setBoneDelta)
   * でこの4ボーンを個別に調整済みの場合、こちらを操作すると上書きされる。
   */
  setGlobalOffset(key, degValue) {
    if (!(key in this.globalOffset)) return;
    this.globalOffset[key] = degValue;
    this._applyGlobalOffset();
  }
  resetGlobalOffset() {
    this.globalOffset = { ...GLOBAL_OFFSET_DEFAULT };
    this._applyGlobalOffset();
  }
  _applyGlobalOffset() {
    const AXIS_IDX = { x: 0, y: 1, z: 2 };
    GLOBAL_OFFSET_BONE_NAMES.forEach((name) => {
      const base = this.presetBoneValues[name] || [0, 0, 0];
      const add = [0, 0, 0];
      Object.entries(GLOBAL_OFFSET_BONES).forEach(([offsetKey, mappings]) => {
        const val = this.globalOffset[offsetKey] || 0;
        if (!val) return;
        mappings.forEach(({ bone, axis, weight }) => {
          if (bone !== name) return;
          add[AXIS_IDX[axis]] += val * weight;
        });
      });
      const next = [base[0] + add[0], base[1] + add[1], base[2] + add[2]];
      this.poseTargets[name] = next;
      // スライダー操作への追従を即座に見せたいので、ボーン個別調整モードと同様に
      // currentも同時に書き換える(lerpで遅延させない)。
      this.poseCurrent[name] = [...next];
    });
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
  getHeight() { return this.root.scale.y; }
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
 * MMDCharacter/SpriteCharacterをシーンから除去し、GPUリソース
 * (ジオメトリ/マテリアル/テクスチャ)を解放する。
 * キャラクター切替(main.jsの切替式選択・dev.jsの開発者モード)の
 * 両方で共通して使うための、character.js側のsingle source of truthとして追加。
 * 呼び出し側でactiveCharacterの参照を外す処理は各自で行うこと(このヘルパーは
 * シーングラフ/GPUリソースの後片付けのみを担当する)。
 */
export function disposeCharacter(character, scene) {
  if (!character || !character.root) return;
  scene.remove(character.root);
  character.root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((mat) => {
        if (!mat) return;
        Object.keys(mat).forEach((key) => {
          const val = mat[key];
          if (val && val.isTexture) val.dispose();
        });
        if (mat.gradientMap && mat.gradientMap.isTexture) mat.gradientMap.dispose();
        mat.dispose();
      });
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
