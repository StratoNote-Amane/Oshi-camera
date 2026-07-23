/* ============================================================
   js/environment/ground-estimator.js — 仮想床の提供(新規)
   ------------------------------------------------------------
   20260722平面推定指示書 Part1 対応。

   現状は「床検出」ではなく、固定高さの仮想床(水平面)を保持するだけの
   クラス。将来LiDAR/画像ベースの床検出を導入する場合も、外部からは
   getGroundPlane()/setGroundHeight()の形さえ保てば良いようにしてある
   (指示書Part10: PlacementReticle/PerceptualScale/Characterのいずれも
   このクラスの内部実装には依存しない)。

   初期値は呼び出し側(main.js)のDEFAULT_PLACEMENT.yを渡す想定。
   ============================================================ */
import * as THREE from 'three';

export class GroundEstimator {
  /**
   * @param {number} initialGroundY 仮想床の初期Y座標(main.jsのDEFAULT_PLACEMENT.yを渡す)
   */
  constructor(initialGroundY = 0) {
    this.groundY = initialGroundY;
    // THREE.Planeは「normal・X + constant = 0」で定義される。
    // 水平面(法線=+Y)がY=groundYを通るには constant = -groundY。
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -initialGroundY);
  }

  /**
   * 現在の仮想床をTHREE.Planeとして返す(呼び出し側で使い回すため、
   * 毎回constに反映してから同じインスタンスを返す。newで都度生成しない)。
   */
  getGroundPlane() {
    this._plane.constant = -this.groundY;
    return this._plane;
  }

  /**
   * 仮想床の高さを更新する。実際にキャラクターを配置した後、
   * その足元の高さに合わせて呼ぶことを想定(main.js側の責務)。
   */
  setGroundHeight(y) {
    this.groundY = y;
  }

  getGroundHeight() {
    return this.groundY;
  }
}
