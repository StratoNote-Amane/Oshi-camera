/* ============================================================
   ground-estimator.js — Ground Confidence Engine (GCE)
   ------------------------------------------------------------
   ARCore/ARKitのような平面認識がないSafari環境で、「床がどこに
   あるか」を確定させるのではなく「床らしい場所」を複数の弱い信号
   (重力方向・起動時の手動キャリブレーション・将来的なOptical Flow)
   から統合的に推定する独自エンジン。

   設計方針(実装指示書2026/07/16より):
   - 責務をGroundEstimatorに集約し、main.js側には床推定ロジックを
     一切書かない。main.jsはupdate()/getGround()/calibrate()等の
     公開APIのみを呼ぶ。
   - 内部アルゴリズムは差し替え可能にする(Strategy Pattern)。
     現時点ではGravityStrategy(重力)とManualCalibrationStrategy
     (起動時キャリブレーション)の2つを実装し、GroundEstimatorが
     それらを合成する。OpticalFlowStrategyは今回未実装(Step3で
     OpenCV.jsを使って実装予定)だが、差し替え可能な形の空の
     スタブとして先に置いておく。

   【今回(Step1+2)のスコープ】
   - Step1(Gravity): DeviceOrientationから床の傾き(pitch/roll)を得る。
   - Step2(Manual Calibration): 起動直後に一度だけ「画面中央のライン
     を床に合わせる」UIを出し、その時の傾きからfloorYを算出して
     localStorageへ保存する。
   Step3(Optical Flow・OpenCV.js)は別タスクとして次回実装する。

   【floorY算出方法についての重要な注記(要実機検証)】
   このアプリのAR合成はカメラを常にワールド原点(0,0,0)に置き、
   キャラクターはそこからの相対位置(placement.x/y/z)で配置される。
   カメラの実際の物理的な高さ(手に持つ高さ)は分からない
   (shadow-rig.js等でも既知の制約として記載済み)。

   本キャリブレーションでは「ユーザーが画面中央の水平ラインを
   実際の床と視覚的に一致するまでスマホ自体を傾ける」という
   操作を利用する。ライン=画面中央=カメラの正面方向なので、
   一致した瞬間、カメラの正面は「REFERENCE_DISTANCE_M前方の床」を
   指していると仮定できる。この時の傾き角(水平からの下向き角度)を
   θとすると、
       floorY = -REFERENCE_DISTANCE_M * tan(θ)
   という単純な三角関数でカメラ基準の床の高さ(=floorY)を近似する。

   REFERENCE_DISTANCE_M(キャラクターの標準的な想定距離)や、
   DeviceOrientationのbeta値から「垂直からの下向き角度」への変換式
   (PITCH_SIGN・90度基準)は、実機での傾きの符号・基準を確認しないと
   正しいか判断できない「たたき台」。実機で符号が逆に感じる場合は
   PITCH_SIGNを-1に反転すること(CONSTRAINTS.md 5節の運用方針に準拠)。
   ============================================================ */
import * as THREE from 'three';

const STORAGE_KEY_DEFAULT = 'oshi_ground_calibration_v1';

// confidenceの目安値(実装指示書の例に準拠):
//   0.15 = 床不明(重力のみ、キャリブレーション未実施)
//   0.55 = 推定可能(手動キャリブレーション済み)
//   0.9  = 非常に安定(将来のOptical Flowが安定した時、Step3で使用)
const CONFIDENCE_UNCALIBRATED = 0.15;
const CONFIDENCE_CALIBRATED = 0.55;
const CONFIDENCE_OPTICAL_FLOW_MAX = 0.9;

// confidenceの指数移動平均の更新率(毎フレーム大きく変化させないため)
const CONFIDENCE_EMA_ALPHA = 0.06;

// floorYの許容範囲(異常な傾き入力での極端な値を防ぐクランプ)
const FLOOR_Y_MIN = -3.5;
const FLOOR_Y_MAX = -0.2;

/* ------------------------------------------------------------
   Strategy 1: 重力方向(DeviceOrientation)
   ------------------------------------------------------------
   「床の傾き推定」用のpitch/rollを提供する。main.js側で既にAR用の
   ジャイロ(gyroCurQuat等、画面回転補正込みのフル3DoF)を扱っているが、
   GCEはそれとは独立した軽量な読み取りに留める(責務分離)。
   ------------------------------------------------------------ */
class GravityStrategy {
  constructor() {
    this.betaDeg = 90; // 端末を垂直に立てて構えた状態を90と仮定(要実機検証)
    this.gammaDeg = 0;
    this.available = false;
    this._onEvent = this._onEvent.bind(this);
  }
  attach() {
    window.addEventListener('deviceorientation', this._onEvent);
  }
  detach() {
    window.removeEventListener('deviceorientation', this._onEvent);
  }
  _onEvent(e) {
    if (e.beta === null || e.beta === undefined) return;
    this.betaDeg = e.beta;
    this.gammaDeg = e.gamma || 0;
    this.available = true;
  }
  /** @returns {{ pitchDeg:number, rollDeg:number, available:boolean }} */
  getSignal() {
    return { pitchDeg: this.betaDeg, rollDeg: this.gammaDeg, available: this.available };
  }
}

/* ------------------------------------------------------------
   Strategy 2: 手動キャリブレーション(起動直後の一度きりのUI)
   ------------------------------------------------------------ */
class ManualCalibrationStrategy {
  constructor(storageKey) {
    this.storageKey = storageKey;
    this.floorY = null;
    this._load();
  }
  _load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw === null) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed.floorY === 'number' && Number.isFinite(parsed.floorY)) {
        this.floorY = parsed.floorY;
      }
    } catch (e) {
      console.warn('ground calibration load failed', e);
    }
  }
  save(floorY) {
    this.floorY = floorY;
    try {
      localStorage.setItem(this.storageKey, JSON.stringify({ floorY, calibratedAt: Date.now() }));
    } catch (e) {
      console.warn('ground calibration save failed', e);
    }
  }
  clear() {
    this.floorY = null;
    try { localStorage.removeItem(this.storageKey); } catch (e) { /* noop */ }
  }
  hasCalibration() {
    return typeof this.floorY === 'number' && Number.isFinite(this.floorY);
  }
  getFloorY() {
    return this.floorY;
  }
}

/* ------------------------------------------------------------
   Strategy 3(未実装スタブ): Optical Flow
   ------------------------------------------------------------
   Step3で実装予定。OpenCV.js(Lucas-Kanade/GoodFeaturesToTrack)を
   使い、画面下1/3の特徴点の安定度からconfidenceを補強する。
   今回はconfidence=0の空実装とし、GroundEstimator側の合成ロジックが
   「差し替え可能」であることだけを示す土台として置いておく。
   ------------------------------------------------------------ */
class OpticalFlowStrategyStub {
  getSignal() {
    return { confidence: 0, available: false };
  }
}

/* ------------------------------------------------------------
   GroundEstimator
   ------------------------------------------------------------ */
export class GroundEstimator {
  /**
   * @param {object} [options]
   * @param {number} [options.referenceDistanceMeters] キャリブレーション時に
   *   「画面中央が指している床」までの想定距離(m)。キャラクターの標準的な
   *   立ち位置距離に合わせておくと誤差が小さい(main.js側のDEFAULT_PLACEMENT.zの
   *   絶対値を渡すことを想定)。
   * @param {string} [options.storageKey] localStorageの保存キー
   * @param {number} [options.pitchSign] 実機でのDeviceOrientation符号が
   *   逆だった場合に-1へ反転するための係数(要実機検証)。
   */
  constructor({ referenceDistanceMeters = 3.2, storageKey = STORAGE_KEY_DEFAULT, pitchSign = 1 } = {}) {
    this.referenceDistanceMeters = referenceDistanceMeters;
    this.pitchSign = pitchSign;

    this.gravity = new GravityStrategy();
    this.calibration = new ManualCalibrationStrategy(storageKey);
    this.opticalFlow = new OpticalFlowStrategyStub(); // Step3で実装を差し替える

    this._confidence = this.calibration.hasCalibration() ? CONFIDENCE_CALIBRATED : CONFIDENCE_UNCALIBRATED;
    this._floorY = this.calibration.getFloorY();
    this._pitchDeg = 0;
    this._rollDeg = 0;
  }

  start() {
    this.gravity.attach();
  }
  stop() {
    this.gravity.detach();
  }

  isCalibrated() {
    return this.calibration.hasCalibration();
  }

  /** キャリブレーションUI表示中に「今の傾き」をプレビューするための生値取得 */
  getRawPitchDeg() {
    return this.gravity.getSignal().pitchDeg;
  }

  /**
   * キャリブレーションUIで「OK」が押された時に呼ぶ。
   * その瞬間の傾きから、三角関数でfloorYを算出しlocalStorageへ保存する。
   * @param {number} [pitchDegAtCalibration] 省略時は現在の重力信号を使う
   */
  calibrate(pitchDegAtCalibration) {
    const pitchDeg = pitchDegAtCalibration ?? this.getRawPitchDeg();
    // betaDeg=90(垂直に構えた基準)からのズレを「下向きに傾けた角度」とみなす近似。
    const tiltDownDeg = this.pitchSign * (90 - pitchDeg);
    const tiltDownRad = THREE.MathUtils.degToRad(tiltDownDeg);
    const rawFloorY = -this.referenceDistanceMeters * Math.tan(tiltDownRad);
    const floorY = THREE.MathUtils.clamp(rawFloorY, FLOOR_Y_MIN, FLOOR_Y_MAX);
    this.calibration.save(floorY);
    this._floorY = floorY;
    return floorY;
  }

  recalibrateReset() {
    this.calibration.clear();
    this._confidence = CONFIDENCE_UNCALIBRATED;
  }

  /** 毎フレーム(またはそれに準ずる頻度で)呼ぶ。重い処理は含まない。 */
  update() {
    const g = this.gravity.getSignal();
    this._pitchDeg = g.pitchDeg;
    this._rollDeg = g.rollDeg;

    const flow = this.opticalFlow.getSignal(); // Step3実装後はここで安定度を加味する
    let targetConfidence;
    if (flow.available && flow.confidence > 0) {
      targetConfidence = THREE.MathUtils.clamp(
        CONFIDENCE_CALIBRATED + flow.confidence * (CONFIDENCE_OPTICAL_FLOW_MAX - CONFIDENCE_CALIBRATED),
        CONFIDENCE_CALIBRATED,
        CONFIDENCE_OPTICAL_FLOW_MAX
      );
    } else {
      targetConfidence = this.calibration.hasCalibration() ? CONFIDENCE_CALIBRATED : CONFIDENCE_UNCALIBRATED;
    }
    // 指数移動平均(EMA)で滑らかに追従させ、毎フレーム大きく変化させない。
    this._confidence += (targetConfidence - this._confidence) * CONFIDENCE_EMA_ALPHA;

    if (this.calibration.hasCalibration()) {
      this._floorY = this.calibration.getFloorY();
    }
  }

  /** @returns {{ floorY: number|null, confidence: number, pitch: number, roll: number }} */
  getGround() {
    return {
      floorY: this._floorY,
      confidence: this._confidence,
      pitch: this._pitchDeg,
      roll: this._rollDeg,
    };
  }
}
