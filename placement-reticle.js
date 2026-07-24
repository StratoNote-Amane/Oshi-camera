/* ============================================================
   js/placement-reticle.js — 配置レティクル
   ------------------------------------------------------------
   【2026/07/27 全面再設計】
   これまでは「画面中央からカメラのレイを飛ばし、床平面との交点を
   求める」方式(20260722平面推定指示書Part4の原案)だったが、
   2026/07/26にmain.js側でジャイロによるcamera.quaternionの更新を
   廃止した(常時固定姿勢)ため、この方式は「スマホをどこに向けても
   計算結果が変わらない(=真下に向けても反応しない)」という致命的な
   問題を起こすようになった。カメラの向きが変化しない以上、
   画面中央のレイは常に同じ場所にしか当たらない。

   そこで、センサー(スマホの向き)に一切頼らない方式に変更する:
     - レティクルは「指でドラッグして動かす、床に置いた薄い円」として
       実装する。
     - 位置の更新はmain.js側(既存の1本指ドラッグと同じ、画面上の
       ピクセル移動量→距離に応じたワールド座標移動量、という安全な
       変換式)が担当し、このクラスは「今の位置を保持して表示する」
       ことと「脈動アニメーション」だけに責務を絞る。
     - GroundEstimatorから得る固定の高さ(Y)はそのまま使う。
   ============================================================ */
import * as THREE from 'three';

const RETICLE_RADIUS_M = 0.18; // 直径36cm程度
const RING_THICKNESS_M = 0.025;
const PULSE_MIN_SCALE = 0.95;
const PULSE_MAX_SCALE = 1.05;
const PULSE_PERIOD_SEC = 2.2;

export class PlacementReticle {
  /**
   * @param {THREE.Object3D} worldRoot レティクルを追加する親(通常はscene)
   */
  constructor(worldRoot) {
    this.worldRoot = worldRoot;

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(RETICLE_RADIUS_M - RING_THICKNESS_M, RETICLE_RADIUS_M, 48),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.85,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    const fill = new THREE.Mesh(
      new THREE.CircleGeometry(RETICLE_RADIUS_M - RING_THICKNESS_M * 1.4, 48),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.18,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    this.group = new THREE.Group();
    this.group.add(fill);
    this.group.add(ring);
    this.group.rotation.x = -Math.PI / 2; // 床へ水平配置(薄い円として見える)
    this.group.visible = false;
    worldRoot.add(this.group);

    this._elapsed = 0;
    this._x = 0;
    this._y = 0;
    this._z = 0;
  }

  show() {
    this.group.visible = true;
  }
  hide() {
    this.group.visible = false;
  }
  isVisible() {
    return this.group.visible;
  }

  /**
   * レティクルのワールド座標を直接設定する(main.jsのドラッグ処理から呼ぶ)。
   * @param {number} x
   * @param {number} y 通常はGroundEstimatorの高さをそのまま渡す
   * @param {number} z
   */
  setWorldPosition(x, y, z) {
    this._x = x; this._y = y; this._z = z;
    this.group.position.set(x, y, z);
  }
  getWorldPosition() {
    return { x: this._x, y: this._y, z: this._z };
  }

  /**
   * 脈動アニメーションのみを進める。表示中のみ呼べば十分。
   * @param {number} dt 前フレームからの経過秒
   */
  updatePulse(dt = 0.016) {
    this._elapsed += dt;
    const t = (Math.sin((this._elapsed / PULSE_PERIOD_SEC) * Math.PI * 2) + 1) / 2;
    const s = PULSE_MIN_SCALE + (PULSE_MAX_SCALE - PULSE_MIN_SCALE) * t;
    this.group.scale.set(s, s, 1);
  }

  /**
   * @returns {{position:THREE.Vector3, normal:THREE.Vector3, rotationY:null}}
   *   rotationYはnull固定(呼び出し側で現在の向きをそのまま使う設計、
   *   詳細はmain.jsのconfirmReticlePlacement参照)。
   */
  getPlacementPose() {
    return {
      position: new THREE.Vector3(this._x, this._y, this._z),
      normal: new THREE.Vector3(0, 1, 0),
      rotationY: null,
    };
  }

  dispose() {
    this.worldRoot.remove(this.group);
    this.group.children.forEach((m) => {
      m.geometry.dispose();
      m.material.dispose();
    });
  }
}
