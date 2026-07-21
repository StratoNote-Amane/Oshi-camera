/* ============================================================
   character/material-utils.js — 材質の調整
   ------------------------------------------------------------
   MMDらしさを抑える：輪郭線を細く・トゥーンの段差を滑らかにする。
   ============================================================ */
import * as THREE from 'three';

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
