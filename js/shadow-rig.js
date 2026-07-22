/* ============================================================
   shadow-rig.js — 影システムの統合窓口(唯一のエクスポート面)
   ------------------------------------------------------------
   このファイルはロジックをほとんど持たない「配線」だけの層に
   意図的に留めている。実際の計算は
     - contact-shadow.js    (常時の接地AO)
     - directional-shadow.js(ShadowMapによる太陽光の影)
     - environment-shadow.js(環境による強さ/色の補正計算)
     - shadow-receiver.js   (影を受ける床、将来は壁/ベンチ等)
   にそれぞれ分離済みで、shadow-rig.jsは「EnvironmentStateを
   environment-shadow.jsに渡して補正値を得る→各モジュールへ
   その補正値と共に配置情報を渡す」という一方向の流れを
   実行するだけ。lighting.js/atmosphere.js/postfx.js/main.jsとは
   直接依存し合わない設計を保ち、循環参照を防ぐ
   (このファイルが依存するのはThree.jsと同じshadow/ディレクトリ内の
   兄弟モジュールのみ)。

   旧 js/shadow-rig.js(Blob Shadowのみで構成)からの置き換えとして、
   呼び出し側(main.js)との互換性をできる限り保つため、
   createShadowRig(scene)の戻り値が持つ`update(...)`の引数の並びは
   旧実装と同じ順序を維持し、末尾にenvironmentStateを追加している
   (旧引数を渡すだけの呼び出しでも動く後方互換の設計)。
   ============================================================ */
import * as THREE from 'three';
import { computeHazeFactor } from '../atmosphere.js';
import { createContactShadow } from './contact-shadow.js';
import { createDirectionalShadow } from './directional-shadow.js';
import { createFloorReceiver, ShadowReceiverRegistry } from './shadow-receiver.js';
import { computeEnvironmentShadowParams } from './environment-shadow.js';
import { resolveQuality, DEFAULT_SHADOW_QUALITY } from './shadow-quality.js';

// 視線角度による奥行きの潰れ補正(旧shadow-rig.jsから継承)。
// Contact Shadowは板ポリのまま残しているため、この現象は依然として
// 起こり得る。Directional Shadow側はThree.js標準のシャドウマップ
//投影に任せるため、この補正の対象外(実際の3D投影が自動で処理する)。
const REFERENCE_ELEVATION_DEG = 20;
const MIN_FORESHORTEN = 0.55;
const MAX_FORESHORTEN = 1.35;
function computeForeshortenFactor(cameraPos, footPoint) {
  if (!cameraPos) return 1;
  const dx = footPoint.x - cameraPos.x;
  const dz = footPoint.z - cameraPos.z;
  const horizDist = Math.hypot(dx, dz) || 1e-4;
  const verticalDrop = cameraPos.y - footPoint.y;
  const elevationRad = Math.atan2(Math.abs(verticalDrop), horizDist);
  const viewSin = Math.max(Math.sin(elevationRad), 0.001);
  const refSin = Math.sin(THREE.MathUtils.degToRad(REFERENCE_ELEVATION_DEG));
  return THREE.MathUtils.clamp(viewSin / refSin, MIN_FORESHORTEN, MAX_FORESHORTEN);
}

/**
 * @param {THREE.Scene} scene
 * @param {object} [options]
 * @param {string} [options.quality] 'low'|'medium'|'high'|'ultra'
 * @param {THREE.WebGLRenderer} [options.renderer] 渡すとrenderer.shadowMapを
 *   自動設定する(main.js側で既にshadowMap.enabledを立てている場合は省略可)。
 */
export function createShadowRig(scene, options = {}) {
  let qualityName = options.quality || DEFAULT_SHADOW_QUALITY;
  let quality = resolveQuality(qualityName);

  if (options.renderer) {
    options.renderer.shadowMap.enabled = true;
    options.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  const contact = createContactShadow(scene);
  const directional = createDirectionalShadow(scene, quality);
  const receivers = new ShadowReceiverRegistry();
  const floor = receivers.register(createFloorReceiver(scene, 48));

  let debugEnabled = false;
  let shadowCameraHelper = null;
  let lastDebugInfo = {};

  /**
   * @param {number} footY
   * @param {number} width
   * @param {{x:number,z:number}} placement
   * @param {number} lightAzimuthDeg lighting.jsのgetEstimatedAzimuthDeg()
   * @param {number} brightnessFactor lighting.jsのgetBrightnessFactor()
   * @param {number} distanceMeters
   * @param {{x:number,y:number,z:number}} cameraPos
   * @param {number} [azimuthConfidence=1] 旧shadow-rig.js互換(現状は
   *   environmentStateがあればそちらのenvironmentTypeを優先するが、
   *   environmentState未提供時のフォールバックとして使う)
   * @param {object|null} [environmentState] environment-analyzer.jsの
   *   getState()の戻り値。Directional/Environment Shadowの主入力。
   */
  function update(
    footY, width, placement, lightAzimuthDeg = 0, brightnessFactor = 1,
    distanceMeters = 0, cameraPos = null, azimuthConfidence = 1, environmentState = null
  ) {
    const envParams = computeEnvironmentShadowParams(environmentState);
    // environmentStateが無い場合は、旧APIのazimuthConfidenceをそのまま
    // Directional Shadowの強さとして流用する(後方互換フォールバック)。
    const directionalStrength = environmentState
      ? envParams.directionalStrength
      : THREE.MathUtils.clamp(azimuthConfidence, 0, 1);

    const foreshorten = computeForeshortenFactor(cameraPos, { x: placement.x, y: footY, z: placement.z });
    const distanceFade = 1 - computeHazeFactor(distanceMeters) * 0.5;

    contact.update(footY, width, placement, distanceMeters, envParams.contactContrast * distanceFade * Math.min(1.1, foreshorten + 0.3));

    const sunAltitude = environmentState ? environmentState.sunAltitude : null;
    directional.update(footY, placement, width, sunAltitude, lightAzimuthDeg, directionalStrength, quality);

    // 床(Shadow Receiver)を常にキャラクターの足元へ追従させる。
    // サイズは固定(directional-shadow.jsのフラスタム上限より十分大きい48m)。
    floor.mesh.position.set(placement.x, footY, placement.z);
    floor.setOpacity(0.55 * directionalStrength);

    if (debugEnabled) {
      lastDebugInfo = {
        environmentType: environmentState ? environmentState.environmentType : 'unknown(no EnvironmentState)',
        directionalStrength: directionalStrength.toFixed(2),
        sunAltitude: sunAltitude == null ? 'n/a' : `${sunAltitude.toFixed(1)}°`,
        lightAzimuthDeg: `${lightAzimuthDeg.toFixed(1)}°`,
        quality: quality.label,
        reason: envParams.reason,
      };
      if (shadowCameraHelper) shadowCameraHelper.update();
    }
  }

  function setQuality(name) {
    quality = resolveQuality(name);
    qualityName = name;
    directional.setQuality(quality);
  }
  function getQuality() {
    return qualityName;
  }

  /**
   * Shadow Debug Modeの切り替え。GUIから呼ぶ想定(index.htmlに
   * デバッグボタンを追加し、main.js側でこの関数を紐付ける)。
   */
  function setDebugEnabled(v) {
    debugEnabled = v;
    if (v && !shadowCameraHelper) {
      shadowCameraHelper = new THREE.CameraHelper(directional.light.shadow.camera);
      scene.add(shadowCameraHelper);
    }
    if (shadowCameraHelper) shadowCameraHelper.visible = v;
  }
  function getDebugInfo() {
    return lastDebugInfo;
  }

  /**
   * 将来の壁・ベンチ・テーブル・階段等への拡張用。呼び出し側が
   * 用意したメッシュにreceiveShadow=trueを立てて登録するだけの薄い
   * ラッパー(GroundEstimator等への依存は一切持たない)。
   */
  function registerReceiver(mesh, kind = 'custom') {
    mesh.receiveShadow = true;
    return receivers.register({
      mesh,
      kind,
      setOpacity: (v) => { if (mesh.material && 'opacity' in mesh.material) mesh.material.opacity = v; },
      dispose: (s) => { s.remove(mesh); },
    });
  }

  function dispose() {
    contact.dispose();
    directional.dispose();
    receivers.getAll().forEach((r) => r.dispose && r.dispose(scene));
    if (shadowCameraHelper) scene.remove(shadowCameraHelper);
  }

  return {
    update,
    setQuality,
    getQuality,
    setDebugEnabled,
    getDebugInfo,
    registerReceiver,
    receivers,
    dispose,
    // 互換用: 旧shadow-rig.jsはsoft/core/aoのMeshを直接公開していた。
    // 現行はcontact.core/contact.aoが相当するため、参照が残っている
    // 呼び出し元がある場合に備えて薄いエイリアスを残す。
    core: contact.core,
    ao: contact.ao,
  };
}
