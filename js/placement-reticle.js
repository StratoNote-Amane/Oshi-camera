/* ============================================================
   js/placement-reticle.js — 配置レティクル(新規)
   ------------------------------------------------------------
   20260722平面推定指示書 Part2〜4 対応。

   【重要: CONSTRAINTS.md 5節との関係について、必ず読むこと】
   このモジュールのupdate()は、指示書Part11の指定通り「画面中央から
   Raycasterを生成し、GroundEstimatorが返す床平面との交点を求める」
   実装になっている。これは技術的には、main.jsの既存
   computeFloorPointFromScreen()(1本指タップ配置)と全く同じ数式
   ( t = (planeY - origin.y) / dir.y 相当、THREE.Rayの
   intersectPlane()内部で計算される)を使う。

   一方でCONSTRAINTS.md 5節は「カメラの姿勢(camera.quaternion)を
   位置決めロジックの入力として絶対に使用しないこと」を絶対制約として
   明記しており、ADR-014はまさにこの「レイと水平面の交差式は視線が
   水平に近づくほど発散する」という理由で、タップ配置からこの方式を
   排除した経緯がある。

   今回は指示書側で「computeFloorPointFromScreen()相当を再利用し、
   画面中央固定のレイキャストとして使うこと」と明示的に指定されている
   ため、その通りに実装しているが、これはCONSTRAINTS.md 5節の絶対制約と
   正面から矛盾する可能性がある。既知の緩和策として、
     - 交点までの距離が非現実的(30m超)な場合は無効とみなしhide()する
     - dir.y(視線の上下成分)が極端に小さい(ほぼ水平を向いている)場合も
       intersectPlane()がnullを返すため、その場合は自動的にhide()になる
   を入れてあるが、根本的な発散のリスク自体は解消していない。
   実機で「レティクルが画面外まで飛ぶ/激しく暴れる」症状が出た場合は、
   この設計自体の見直し(例: 画面中央を常に画面上の固定オフセット位置に
   表示するだけに留め、実際の床交点計算はしない、等)が必要になる。
   この点はOPEN_ITEMSに明記し、hinyaさんの確認を仰ぐこととする。
   ============================================================ */
import * as THREE from 'three';

const RETICLE_RADIUS_M = 0.18; // 直径36cm程度(指示書: 30〜40cm)
const RING_THICKNESS_M = 0.025;
const MAX_VALID_DISTANCE_M = 30; // これを超える交点は数値発散とみなし無効化する
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
