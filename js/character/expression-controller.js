/* ============================================================
   character/expression-controller.js — 表情モーフ制御
   ------------------------------------------------------------
   PMXの頂点モーフ(表情プリセット)の重みをなめらかに補間し、
   自動まばたき・微小な表情ジッター(生きている感じの演出)を
   character.jsから切り出したもの。character.js本体からは
   MMDCharacterが1つのサブコントローラーとして保持し、update(dt)を
   毎フレーム呼び出すだけの薄い委譲になっている。
   ============================================================ */
import * as THREE from 'three';

/**
 * @param {object} args
 * @param {THREE.SkinnedMesh} args.root morphTargetDictionary/Influencesを持つメッシュ
 * @param {object} args.expressions CHARACTERS定義のexpressions(表情プリセット)
 * @param {string|null} args.blinkMorph まばたき用モーフ名
 * @param {{morphs:string[],amplitude:number,periodSec:number}|null} args.idleExprJitter
 */
export function createExpressionController({ root, expressions, blinkMorph, idleExprJitter }) {
  const exprWeights = {};
  let exprTargets = {};
  let blinkState = 'idle';
  let blinkTimer = 2 + Math.random() * 3;
  let blinkWeight = 0;
  let elapsed = 0;

  function setExpression(key) {
    const preset = expressions[key];
    if (!preset) return;
    exprTargets = preset.weights;
  }
  setExpression('normal');

  function update(dt) {
    elapsed += dt;
    const dict = root.morphTargetDictionary;
    const infl = root.morphTargetInfluences;
    if (!dict || !infl) return;

    const allNames = new Set([...Object.keys(exprWeights), ...Object.keys(exprTargets)]);
    const LERP_SPEED = 8;
    for (const name of allNames) {
      const cur = exprWeights[name] || 0;
      const target = exprTargets[name] || 0;
      const next = cur + (target - cur) * Math.min(1, dt * LERP_SPEED);
      exprWeights[name] = next;
      const idx = dict[name];
      if (idx !== undefined) infl[idx] = next;
    }

    if (blinkMorph && dict[blinkMorph] !== undefined) {
      blinkTimer -= dt;
      if (blinkState === 'idle' && blinkTimer <= 0) blinkState = 'closing';
      const CLOSE_SPEED = 14, OPEN_SPEED = 10;
      if (blinkState === 'closing') {
        blinkWeight = Math.min(1, blinkWeight + dt * CLOSE_SPEED);
        if (blinkWeight >= 1) blinkState = 'opening';
      } else if (blinkState === 'opening') {
        blinkWeight = Math.max(0, blinkWeight - dt * OPEN_SPEED);
        if (blinkWeight <= 0) { blinkState = 'idle'; blinkTimer = 2.2 + Math.random() * 3.5; }
      }
      const idx = dict[blinkMorph];
      const base = exprWeights[blinkMorph] || 0;
      infl[idx] = Math.max(base, blinkWeight);
    }

    if (idleExprJitter) {
      const { morphs, amplitude, periodSec } = idleExprJitter;
      morphs.forEach((name, i) => {
        const idx = dict[name];
        if (idx === undefined) return;
        const j = Math.sin(elapsed * (Math.PI * 2 / periodSec) + i * 2.1) * amplitude;
        infl[idx] = THREE.MathUtils.clamp((infl[idx] || 0) + j, 0, 1);
      });
    }
  }

  return { setExpression, update };
}
