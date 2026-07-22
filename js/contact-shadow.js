/* ============================================================
   contact-shadow.js — 接地感専用の疑似影(足元AO)
   ------------------------------------------------------------
   なぜDirectional Shadow(ShadowMap)と役割を分離するか:
   ShadowMapは「太陽/照明の方向に落ちる影」の表現には強いが、
   太陽高度がほぼ0(日の出/日の入り前後)や、屋内で光源方向の
   信頼度が低い場面では、影そのものが極端に伸びる/消える/
   向きが破綻するといった見た目の弱さがある。しかし「足が床に
   ついている」という接地の手掛かりは、太陽の状態に関係なく
   常に必要。この2つの要求(方向性のある写実的な影 / 常に消えない
   接地の手掛かり)を1つの仕組みで両立しようとすると条件分岐が
   複雑化するため、最初から別モジュールとして独立させ、
   ShadowRig側で単純に「両方描く」だけにする。

   distanceMetersによる減衰を極端にしない理由:
   atmosphere.js/旧shadow-rig.jsのcore/aoは「足の真下」という
   接地の手掛かりそのものなので、指示書の要件通り、距離による
   不透明度の変化はごく緩やかに留める(完全になくすと極端な遠距離で
   接地感チェックの役に立たなくなるため、下限を設けたクランプに留める)。
   ============================================================ */
import * as THREE from 'three';

const MIN_DISTANCE_OPACITY = 0.72; // 遠距離でもここより下げない(「極端な減衰は禁止」の要件)

function makeContactTexture({ core, mid }) {
  const size = 320;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(0,0,0,${core})`);
  g.addColorStop(0.62, `rgba(0,0,0,${mid})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * @param {THREE.Scene} scene
 */
export function createContactShadow(scene) {
  function makePlane(tex) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 1; // Shadow Receiver(床)より後に描き、AOが埋もれないようにする
    scene.add(mesh);
    return mesh;
  }

  // 「足の真下にある締まった影」+「靴底が触れている点そのもの」の二層。
  // 光源方向・屋内外に一切依存しない(常時同じ形で描く)。
  const core = makePlane(makeContactTexture({ core: 0.62, mid: 0.30 }));
  const ao = makePlane(makeContactTexture({ core: 0.85, mid: 0.45 }));

  /**
   * @param {number} footY
   * @param {number} width
   * @param {{x:number,z:number}} placement
   * @param {number} distanceMeters
   * @param {number} [contrastMultiplier=1] environment-shadow.jsが返す濃さ補正
   */
  function update(footY, width, placement, distanceMeters = 0, contrastMultiplier = 1) {
    // 距離による減衰は緩やかなクランプのみ(指示書要件: 極端な減衰は禁止)。
    const DISTANCE_FADE_START = 8;
    const DISTANCE_FADE_END = 30;
    const t = THREE.MathUtils.clamp((distanceMeters - DISTANCE_FADE_START) / (DISTANCE_FADE_END - DISTANCE_FADE_START), 0, 1);
    const distanceOpacity = THREE.MathUtils.lerp(1, MIN_DISTANCE_OPACITY, t);
    const finalOpacity = THREE.MathUtils.clamp(distanceOpacity * contrastMultiplier, 0.35, 1);

    core.material.opacity = finalOpacity;
    ao.material.opacity = finalOpacity;

    core.position.set(placement.x, footY + 0.003, placement.z);
    core.scale.set(width * 0.68, width * 0.68, 1);
    core.rotation.z = 0;

    ao.position.set(placement.x, footY + 0.004, placement.z);
    ao.scale.set(width * 0.26, width * 0.26, 1);
    ao.rotation.z = 0;
  }

  function dispose() {
    [core, ao].forEach((mesh) => {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.map && mesh.material.map.dispose();
      mesh.material.dispose();
    });
  }

  return { core, ao, update, dispose };
}
