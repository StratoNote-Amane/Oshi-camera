/* ============================================================
   atmosphere.js — 距離による空気遠近法
   ============================================================ */
import * as THREE from 'three';

const NEAR_M = 2.2;
const FAR_M = 20.0;

const HAZE_TINT = new THREE.Color(0x9fb2c2);

function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function computeHazeFactor(distanceMeters) {
  return smoothstep(NEAR_M, FAR_M, distanceMeters);
}

function applyToMaterial(mat, factor) {
  if (!mat) return;

  if (mat.color) {
    if (!mat.userData._atmosBaseColor) {
      mat.userData._atmosBaseColor = mat.color.clone();
    }
    const base = mat.userData._atmosBaseColor;
    const gray = base.r * 0.299 + base.g * 0.587 + base.b * 0.114;
    const desatR = base.r + (gray - base.r) * 0.4 * factor;
    const desatG = base.g + (gray - base.g) * 0.4 * factor;
    const desatB = base.b + (gray - base.b) * 0.4 * factor;
    const CONTRAST_TARGET = 0.75;
    const contR = desatR + (CONTRAST_TARGET - desatR) * 0.25 * factor;
    const contG = desatG + (CONTRAST_TARGET - desatG) * 0.25 * factor;
    const contB = desatB + (CONTRAST_TARGET - desatB) * 0.25 * factor;
    mat.color.setRGB(contR, contG, contB).lerp(HAZE_TINT, 0.18 * factor);
  }

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

export function applyAtmosphericPerspective(root, distanceMeters) {
  if (!root || !root.material) return;
  const factor = computeHazeFactor(distanceMeters);
  const mats = Array.isArray(root.material) ? root.material : [root.material];
  mats.forEach((mat) => applyToMaterial(mat, factor));
}
