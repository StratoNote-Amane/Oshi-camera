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

  // 実機写真で「影がほぼ見えない」と確認されたため、既定の濃さを底上げする。
  // (主因はscale側の奥行き比率だが、こちらも合わせて強める)
  const soft = makePlane(makeShadowTexture({ core: 0.42, mid: 0.24 }));
  const core = makePlane(makeShadowTexture({ core: 0.62, mid: 0.30 }));
  const ao = makePlane(makeShadowTexture({ core: 0.85, mid: 0.45 }));

  /**
   * @param {number} footY  足元のワールドY座標
   * @param {number} width  シルエットの目安幅
   * @param {{x:number,z:number}} placement キャラクターのXZ位置
   * @param {number} lightAzimuthDeg 推定した光源の水平方向(度、lighting.jsから取得)
   * @param {number} brightnessFactor 環境光推定の明るさ係数(lighting.jsのfactorと
   *   同じ0.4〜2.2程度のスケール)。明るい環境ほど影のコントラストを僅かに強める。
   *   未指定時は1.0(補正なし)として扱う。
   */
  function update(footY, width, placement, lightAzimuthDeg = 0, brightnessFactor = 1) {
    // 光源と逆方向へ影を少しずらすことで「光源方向に落ちる影」を簡易表現する。
    // 真の投影変形ではないが、影が常に真下にあるだけの状態より違和感が減る。
    const az = THREE.MathUtils.degToRad(lightAzimuthDeg);
    const shift = width * 0.18;
    const offX = -Math.sin(az) * shift;
    const offZ = -Math.cos(az) * shift * 0.5;
    // 光源から見て奥行き方向に影を伸ばす(影の長さの簡易近似)
    const stretch = 1 + Math.min(0.5, Math.abs(lightAzimuthDeg) / 100);

    // 実機写真で影がほぼ視認できなかった主因: このアプリのカメラは
    // だいたい水平〜浅い見下ろし角(体感15〜25度程度)でキャラを見ることが多く、
    // 板を寝かせた影は奥行き方向(このplaneのローカルY、ワールドでは水平面内の
    // 前後方向)が強く潰れているとその浅い視点からの透視でさらに潰れ、
    // ほぼ線のようになって消えてしまう。奥行き比率を0.5〜0.6前後から
    // 0.85前後まで引き上げ、浅い角度で見ても面として視認できるようにする。
    const DEPTH_RATIO_SOFT = 0.85;
    const DEPTH_RATIO_CORE = 0.8;
    const DEPTH_RATIO_AO = 0.75;

    // 明るい環境(晴天・逆光等)ほど実際のコントラストは強く出るはずなので、
    // 影の不透明度をbrightnessFactorに緩やかに連動させる。
    // opacityは1を超えても見た目上の効果がないため、暗い環境でのみ
    // わずかに弱める方向にとどめる(常時フル濃度を基本とする)。
    const brightBoost = THREE.MathUtils.clamp(0.78 + brightnessFactor * 0.22, 0.78, 1.0);
    [soft, core, ao].forEach((mesh) => { mesh.material.opacity = brightBoost; });

    soft.position.set(placement.x + offX, footY + 0.002, placement.z + offZ);
    soft.scale.set(width * 1.5 * stretch, width * 1.5 * DEPTH_RATIO_SOFT, 1);
    soft.rotation.z = -az * 0.3;

    core.position.set(placement.x + offX * 0.7, footY + 0.003, placement.z + offZ * 0.7);
    core.scale.set(width * 0.62 * stretch, width * 0.62 * DEPTH_RATIO_CORE, 1);
    core.rotation.z = -az * 0.3;

    ao.position.set(placement.x, footY + 0.004, placement.z);
    ao.scale.set(width * 0.24, width * 0.24 * DEPTH_RATIO_AO, 1);
  }

  return { soft, core, ao, update };
}
