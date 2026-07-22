/* ============================================================
   directional-shadow.js — 太陽光による方向性のある影(ShadowMap)
   ------------------------------------------------------------
   なぜ専用のDirectionalLightを新設するか(「不要なライト生成は
   禁止」との兼ね合い):
   main.js/lighting.jsは既に材質の陰影表現用のDirectionalLight
   (`dir`)を持ち、その向きはカメラ映像の輝度重心法(brightest-cell)
   で推定した「見た目に合った」方向に向けている。一方Shadow Mapに
   必要な光源方向は、本来は太陽の実際の高度/方位(EnvironmentAnalyzer
   から得られる値)であるべきで、両者の要求が常に一致するとは限らない
   (特に屋内では太陽方位そのものが無意味)。同じ1つのライトの
   position を2つの独立したロジックが毎フレーム奪い合うと、
   モデルの陰影と影の向きが基準もろとも毎フレーム競合しちらつく。
   そのため、影の投影計算「専用」のDirectionalLightをここで1つだけ
   新設する。intensity(材質への寄与)は常に0に固定しており、
   モデルの見た目の明るさには一切影響しない
   ── Three.jsのシャドウマップ生成は光源のintensityではなく
   castShadow/shadow.cameraの設定のみに依存するため、
   「影の計算専用・見た目には寄与しないライト」が技術的に成立する。
   これにより「見た目用ライト」と「影用ライト」の責務が完全に分離され、
   互いを上書きし合う事故を構造的に防げる。

   【方位角についての既知の制約】
   EnvironmentAnalyzerが返すsunAzimuthDegは真の地理方位(北を基準)
   だが、本アプリのAR座標系(three.jsのワールドZ軸)は起動時/⟲時の
   デバイスの向きを基準にした相対座標に過ぎず、コンパス(磁気方位)
   による絶対較正を行っていない(main.js既存コメントに明記された
   既知の制約)。そのため sunAzimuthDeg をそのままワールド座標の
   回転角として使うと、実際にカメラに映っている光と無関係な方向へ
   影が伸びるという「かえって不自然な」結果になりかねない。

   このため本モジュールでは、
     - 太陽「高度」(sunAltitudeDeg) → 影の長さ・柔らかさ・濃さ
       (実際の太陽高度と一致させる意味がある。地理的な向きに依存しないため)
     - 太陽「方位」(azimuth、影の伸びる向き) → 引き続き
       lighting.jsの輝度重心法による推定(カメラ映像そのものから
       求めているため、映像内の見た目とは整合する)
   を使い分ける。将来デバイスのコンパス(webkitCompassHeading等)を
   較正に使う実装に進化させる余地を残すため、setAzimuthSource()で
   差し替え可能にしてある。
   ============================================================ */
import * as THREE from 'three';

const SHADOW_CAMERA_NEAR = 0.5;
const SHADOW_CAMERA_FAR = 60;

export function createDirectionalShadow(scene, quality) {
  const light = new THREE.DirectionalLight(0xffffff, 0); // intensity=0: 影計算専用、材質には寄与しない
  light.castShadow = true;
  const target = new THREE.Object3D();
  scene.add(target);
  light.target = target;
  scene.add(light);

  applyQuality(light, quality);

  let lastUpdateTime = 0;
  let enabled = true;

  function applyQuality(l, q) {
    l.shadow.mapSize.set(q.mapSize, q.mapSize);
    l.shadow.radius = q.radius;
    l.shadow.bias = q.bias;
    l.shadow.normalBias = q.normalBias;
    l.shadow.camera.near = SHADOW_CAMERA_NEAR;
    l.shadow.camera.far = SHADOW_CAMERA_FAR;
    l.shadow.camera.updateProjectionMatrix();
    l.shadow.needsUpdate = true;
  }

  /**
   * @param {number} footY
   * @param {{x:number,z:number}} placement
   * @param {number} width シルエット幅(影を落とすフラスタムの大きさの目安に使う)
   * @param {number|null} sunAltitudeDeg EnvironmentAnalyzerの太陽高度(度)。
   *   null時は「取得できていない」として中庸の高度(45度)を仮定する。
   * @param {number} lightAzimuthDeg lighting.jsの輝度重心法による方位(度、相対)
   * @param {number} strength 0〜1。environment-shadow.jsが返す最終的な影の強さ
   *   (屋内判定時はここが小さくなり、実質的に影が薄くなる)
   * @param {object} quality shadow-quality.jsのプリセット
   */
  function update(footY, placement, width, sunAltitudeDeg, lightAzimuthDeg, strength, quality) {
    enabled = strength > 0.02;
    light.visible = enabled;
    light.castShadow = enabled;
    if (!enabled) return;

    const altitudeDeg = THREE.MathUtils.clamp(sunAltitudeDeg == null ? 45 : sunAltitudeDeg, 4, 88);
    const altitudeRad = THREE.MathUtils.degToRad(altitudeDeg);
    const azimuthRad = THREE.MathUtils.degToRad(lightAzimuthDeg || 0);

    // 光源は「十分遠い」距離に置くことで、ほぼ平行光線(太陽光)として扱う。
    // Three.jsのDirectionalLightは元々平行光源だが、shadow.cameraの
    // フラスタム中心をキャラクター付近に保つため、位置自体もキャラクター
    // 近傍に置く(位置は輝度計算に無関係で、方向のみが影に影響する)。
    const dist = 12;
    const horiz = dist * Math.cos(altitudeRad);
    const y = dist * Math.sin(altitudeRad);
    light.position.set(
      placement.x + Math.sin(azimuthRad) * horiz,
      footY + y,
      placement.z + Math.cos(azimuthRad) * horiz
    );
    target.position.set(placement.x, footY, placement.z);

    // フラスタムサイズはキャラクター幅+影が伸びる余白を確保する。
    // 太陽高度が低い(影が長く伸びる)ほど余白を広げる。
    const elongation = THREE.MathUtils.clamp(1 / Math.tan(altitudeRad), 1, 8);
    const frustumHalf = Math.max(3, width * 2.5 * Math.min(elongation, 4));
    const cam = light.shadow.camera;
    cam.left = -frustumHalf; cam.right = frustumHalf;
    cam.top = frustumHalf; cam.bottom = -frustumHalf;
    cam.near = SHADOW_CAMERA_NEAR;
    cam.far = dist + 6;
    cam.updateProjectionMatrix();

    // パフォーマンス対策: 品質プリセットのupdateIntervalMsに従い、
    // 静止時はシャドウマップの再計算頻度を落とす。移動量が一定を
    // 超えた場合(ポーズ/配置変更等)は即座に更新して破綻を防ぐ。
    const now = performance.now();
    const interval = quality.updateIntervalMs;
    if (interval <= 0 || now - lastUpdateTime >= interval) {
      light.shadow.needsUpdate = true;
      lastUpdateTime = now;
    }
  }

  function setQuality(q) {
    applyQuality(light, q);
  }

  function dispose() {
    scene.remove(light);
    scene.remove(target);
    light.shadow.dispose();
  }

  return { light, target, update, setQuality, dispose, isEnabled: () => enabled };
}
