/* ============================================================
   js/placement-reticle.js — 配置レティクル
   ------------------------------------------------------------
   20260722平面推定指示書 Part2〜4 対応。

   【2026/07/26追記: CONSTRAINTS.md 5節との関係が解消した経緯】
   このモジュールのupdate()は画面中央からRaycasterを生成し、
   GroundEstimatorが返す床平面との交点を求める(指示書Part4の指定通り)。
   以前はこのレイがジャイロ由来のcamera.quaternion(毎フレーム変化する
   不安定な値)を経由していたため、ADR-014が問題視した「視線が水平に
   近づくほど交点が発散する」現象が起こりうる状態だった。

   2026/07/26、main.js側で「camera.quaternionをジャイロで動かす」
   3DoF AR固定機能そのものを廃止したことに伴い、この問題は構造的に
   解消した。カメラの向きは常に固定(初期値)のままなので、この
   レイキャストは「毎回同じ結果になる決定論的な計算」になり、
   センサーノイズに起因する発散や暴れは原理的に発生しない。
   （交点までの距離が非現実的な場合の安全弁は、念のためそのまま残している）
   ============================================================ */
import * as THREE from 'three';

const RETICLE_RADIUS_M = 0.18; // 直径36cm程度(指示書: 30〜40cm)
const RING_THICKNESS_M = 0.025;
const MAX_VALID_DISTANCE_M = 30; // これを超える交点は無効化する(安全弁)
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
    this.group.rotation.x = -Math.PI / 2; // 床へ水平配置
    this.group.visible = false;
    worldRoot.add(this.group);

    this._elapsed = 0;
    this._lastPose = null; // { position: THREE.Vector3, normal: THREE.Vector3, rotationY: number }

    // 使い回し用(update()内でnewしない、指示書Part4の注意事項)
    this._raycaster = new THREE.Raycaster();
    this._ndcCenter = new THREE.Vector2(0, 0);
    this._hitPoint = new THREE.Vector3();
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
   * @param {THREE.Plane} groundPlane GroundEstimator#getGroundPlane()
   * @param {THREE.PerspectiveCamera} camera
   * @param {number} dt 前フレームからの経過秒(脈動アニメーション用)
   */
  update(groundPlane, camera, dt = 0.016) {
    this._elapsed += dt;

    this._raycaster.setFromCamera(this._ndcCenter, camera);
    const hit = this._raycaster.ray.intersectPlane(groundPlane, this._hitPoint);

    if (!hit) {
      this.hide();
      return;
    }
    const distFromCam = hit.distanceTo(camera.position);
    if (!Number.isFinite(distFromCam) || distFromCam > MAX_VALID_DISTANCE_M) {
      // 視線がほぼ水平で交点が非現実的に遠い(数値発散)場合は無効化する。
      this.hide();
      return;
    }

    this.show();
    this.group.position.copy(hit);

    // 脈動アニメーション(0.95〜1.05)
    const t = (Math.sin((this._elapsed / PULSE_PERIOD_SEC) * Math.PI * 2) + 1) / 2;
    const s = PULSE_MIN_SCALE + (PULSE_MAX_SCALE - PULSE_MIN_SCALE) * t;
    this.group.scale.set(s, s, 1);

    this._lastPose = {
      position: hit.clone(),
      normal: new THREE.Vector3(0, 1, 0),
      // 設計判断: カメラ方向への自動正対(ビルボード回転)は、モデルの
      // 正面軸の向き次第で意図と逆を向くリスクがあるため、今回は
      // 「初期設定値(呼び出し側の現在のrotYをそのまま使う)」を採用する
      // (指示書Part5「カメラ方向 または 初期設定値」のうち後者)。
      // カメラ正対が必要になった場合はここでatan2による計算を追加する。
      rotationY: null,
    };
  }

  /**
   * @returns {{position:THREE.Vector3, normal:THREE.Vector3, rotationY:number|null}|null}
   *   有効な床交点が無い(レティクル非表示)場合はnull。
   */
  getPlacementPose() {
    if (!this.group.visible || !this._lastPose) return null;
    return this._lastPose;
  }

  dispose() {
    this.worldRoot.remove(this.group);
    this.group.children.forEach((m) => {
      m.geometry.dispose();
      m.material.dispose();
    });
  }
}
