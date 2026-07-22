/* ============================================================
   shadow-receiver.js — 影を受け取る面の抽象化
   ------------------------------------------------------------
   なぜ「複数登録できるレジストリ」として設計するか:
   現段階では床1枚だけが対象だが、指示書は将来の壁・ベンチ・
   テーブル・階段への拡張を明示的に要求している。もし床専用の
   決め打ちコードをShadowRig内に直接書くと、後から2枚目の
   Receiverを足す時にShadowRig本体の書き換えが必要になり、
   「拡張時に既存コードを壊すリスク」が生じる。最初から
   「Receiverの配列を回してThree.jsのreceiveShadowを立てるだけ」
   という薄い抽象化にしておけば、壁やベンチは呼び出し側が
   ジオメトリを用意してregisterするだけで済む。

   なぜGroundEstimatorと密結合しないか:
   指示書の要求通り。ShadowReceiverはThree.jsのMesh(ジオメトリ+
   ShadowMaterial)を保持するだけの薄いラッパーであり、
   「床の高さがどこか」を自分では推定しない。高さ(footY)は
   呼び出し側(ShadowRig経由でmain.js)がcharacter.getFootY()から
   渡す値をそのまま受け取るだけで、GroundEstimator的なロジックへの
   参照を一切持たない。将来GroundEstimatorが実装されても、
   このファイルには変更が要らない設計になっている。

   THREE.ShadowMaterialを使う理由:
   本アプリの背景は実写(video)であり、CGの床ジオメトリ自体は
   見せたくない(見せると合成の破綻が目立つ)。ShadowMaterialは
   「影が落ちた部分だけ不透明、それ以外は完全透明」という
   Three.js標準機能で、まさに「実写の上に影だけを合成する」
   このアプリの要件に一致する。自前でシェーダーを書く必要がない。
   ============================================================ */
import * as THREE from 'three';

export class ShadowReceiver {
  /**
   * @param {THREE.Mesh} mesh receiveShadow=trueを立てたメッシュ
   * @param {string} kind 'floor' | 'wall' | 'bench' | 'table' | 'stairs' など(将来拡張用のラベル)
   */
  constructor(mesh, kind = 'floor') {
    this.mesh = mesh;
    this.kind = kind;
    this.mesh.receiveShadow = true;
  }
  setOpacity(v) {
    this.mesh.material.opacity = v;
  }
  dispose(scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

export class ShadowReceiverRegistry {
  constructor() {
    this.receivers = [];
  }
  register(receiver) {
    this.receivers.push(receiver);
    return receiver;
  }
  unregister(receiver) {
    this.receivers = this.receivers.filter((r) => r !== receiver);
  }
  getAll() {
    return this.receivers;
  }
  setOpacityAll(v) {
    this.receivers.forEach((r) => r.setOpacity(v));
  }
}

/**
 * 床用のShadowReceiverを作成する(現段階で唯一実装済みの種類)。
 * @param {THREE.Scene} scene
 * @param {number} size 床平面の一辺(m)。Directional Shadowの影が
 *   character周辺で途切れないよう、shadow-rig.js側が距離に応じて
 *   十分な大きさを指定する。
 */
export function createFloorReceiver(scene, size = 40) {
  const geo = new THREE.PlaneGeometry(size, size);
  const mat = new THREE.ShadowMaterial({ opacity: 0.55, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 0; // Contact Shadow(常時可視のAO板)より先に描く
  scene.add(mesh);
  return new ShadowReceiver(mesh, 'floor');
}
