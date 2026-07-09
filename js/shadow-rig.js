/* ============================================================
   shadow-rig.js — 接地影モジュール
   ------------------------------------------------------------
   Sprint 1 Task 2「Shadow Quality向上」への対応。
   既存の二重影(柔らかい広い影+締まった影)に加え、
     - 接触AO(靴裏直下のごく小さく濃い影)
     - 光源方向(lighting.jsの推定azimuth)に応じた影の位置オフセット
   を追加している。

   【調査結果サマリ】
   Three.js本体のContact Shadow(平面へのソフトシャドウマップ投影)や
   PMREM/EnvironmentMapの導入も検討したが、
     - リアルタイムシャドウマップは今回のような単純な「板1枚に疑似影」
       構成に対してオーバースペックで、モバイルでの負荷増が見合わない
     - 本アプリは背景が実写(video)であり、Three.js側のシャドウマップを
       背景に落とすことはそもそもできない(影を落とす床がCGではないため)
   という理由から、引き続き「テクスチャ疑似影+位置/伸縮による方向表現」の
   延長線上で改善する方針とした。
   ============================================================ */
import * as THREE from 'three';

function makeShadowTexture({ core, mid }) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(0,0,0,${core})`);
  g.addColorStop(0.55, `rgba(0,0,0,${mid})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

export function createShadowRig(scene) {
  function makePlane(tex) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    mesh.rotation.x = -Math.PI / 2;
    scene.add(mesh);
    return mesh;
  }

  const soft = makePlane(makeShadowTexture({ core: 0.30, mid: 0.16 }));
  const core = makePlane(makeShadowTexture({ core: 0.55, mid: 0.20 }));
  const ao = makePlane(makeShadowTexture({ core: 0.75, mid: 0.35 }));

  /**
   * @param {number} footY  足元のワールドY座標
   * @param {number} width  シルエットの目安幅
   * @param {{x:number,z:number}} placement キャラクターのXZ位置
   * @param {number} lightAzimuthDeg 推定した光源の水平方向(度、lighting.jsから取得)
   */
  function update(footY, width, placement, lightAzimuthDeg = 0) {
    // 光源と逆方向へ影を少しずらすことで「光源方向に落ちる影」を簡易表現する。
    // 真の投影変形ではないが、影が常に真下にあるだけの状態より違和感が減る。
    const az = THREE.MathUtils.degToRad(lightAzimuthDeg);
    const shift = width * 0.18;
    const offX = -Math.sin(az) * shift;
    const offZ = -Math.cos(az) * shift * 0.5;
    // 光源から見て奥行き方向に影を伸ばす(影の長さの簡易近似)
    const stretch = 1 + Math.min(0.5, Math.abs(lightAzimuthDeg) / 100);

    soft.position.set(placement.x + offX, footY + 0.002, placement.z + offZ);
    soft.scale.set(width * 1.3 * stretch, width * 1.3 * 0.6, 1);
    soft.rotation.z = -az * 0.3;

    core.position.set(placement.x + offX * 0.7, footY + 0.003, placement.z + offZ * 0.7);
    core.scale.set(width * 0.55 * stretch, width * 0.55 * 0.55, 1);
    core.rotation.z = -az * 0.3;

    ao.position.set(placement.x, footY + 0.004, placement.z);
    ao.scale.set(width * 0.16, width * 0.16 * 0.5, 1);
  }

  return { soft, core, ao, update };
}
