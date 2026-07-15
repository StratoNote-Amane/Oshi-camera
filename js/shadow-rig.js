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
import { computeHazeFactor } from './atmosphere.js';

/* ------------------------------------------------------------
   視線角度による「奥行きの潰れ」補正
   --------------------------------------------------------------
   接地影は水平に寝かせた板ポリ(rotation.x = -PI/2)。カメラの高さが
   一定のまま被写体が遠くなるほど、カメラ→足元への視線は水平に近づき、
   板を真横から覗き込む形になって奥行き方向がほぼ消える(=浮いて見える)。
   これはテクスチャ解像度やopacityの問題ではなく、平面ポリゴンを浅い角度
   から見た時の純粋な透視上の潰れなので、既存のDEPTH_RATIO定数(固定値)
   だけでは「近距離でちょうどよい値」を「遠距離ではさらに潰れて見える」
   ことになり、距離が伸びるほど悪化する方向に効いてしまっていた。

   ここでは、カメラ→足元の視線が水平から何度上がっているか(elevation)を
   求め、その正弦(sin)を「潰れの目安」として使う。sin=1(真上から見る)なら
   潰れなし、sin=0(真横から見る)なら完全に潰れる、という単純な近似。
   基準角度(REFERENCE_ELEVATION_DEG、既存のDEPTH_RATIO定数を決めた時に
   想定していた「体感15〜25度」の中央値)を1倍として相対値に変換し、
   MIN/MAX_FORESHORTENでクランプする。下限を設けることで、ジャイロの
   姿勢誤差や極端に浅い角度でも接地影が完全には消えないことを保証する。
   ============================================================ */
const REFERENCE_ELEVATION_DEG = 20;
const MIN_FORESHORTEN = 0.55; // これ未満には潰さない(浮いて見える現象への下限)
const MAX_FORESHORTEN = 1.35; // 真上から見下ろす場合でも伸ばしすぎない上限

function computeForeshortenFactor(cameraPos, footPoint) {
  if (!cameraPos) return 1;
  const dx = footPoint.x - cameraPos.x;
  const dz = footPoint.z - cameraPos.z;
  const horizDist = Math.hypot(dx, dz) || 1e-4;
  const verticalDrop = cameraPos.y - footPoint.y; // 正: カメラの方が高い(見下ろし)
  const elevationRad = Math.atan2(Math.abs(verticalDrop), horizDist);
  const viewSin = Math.max(Math.sin(elevationRad), 0.001);
  const refSin = Math.sin(THREE.MathUtils.degToRad(REFERENCE_ELEVATION_DEG));
  return THREE.MathUtils.clamp(viewSin / refSin, MIN_FORESHORTEN, MAX_FORESHORTEN);
}

function makeShadowTexture({ core, mid }) {
  // 遠距離で「黒い一枚の板」に潰れて見える現象への対応。
  // 主因は、影の板が画面上でごく小さく(数px)なった際、グラデーションの
  // ミップマップ生成/縮小フィルタが甘いと、なだらかなフェードが
  // べったりした矩形として縮小されてしまうこと。
  //   1. 解像度を256→320へ、グラデーションの中間ストップも0.55→0.62へ
  //      広げ、そもそも急激な濃淡変化を減らす(縮小時に潰れにくくする)
  //   2. CanvasTextureのフィルタ/ミップマップ設定を明示し、縮小時に
  //      three.jsの既定任せにしない
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
   * @param {number} distanceMeters カメラからの距離(m目安、atmosphere.jsと同じ
   *   基準)。遠いほど影のコントラスト・不透明度を弱める(距離フェード)。
   *   未指定時は0(フェードなし)として扱う。
   * @param {{x:number,y:number,z:number}} cameraPos カメラのワールド座標。
   *   視線角度による奥行きの潰れ補正に使う。未指定時は補正なし(従来通り)。
   */
  function update(footY, width, placement, lightAzimuthDeg = 0, brightnessFactor = 1, distanceMeters = 0, cameraPos = null) {
    // 実機写真で「照明の位置にしては影の位置が変」「足が床について見えない」
    // という指摘を受けた。原因は、信頼性の低い光源方向推定(lighting.jsの
    // 輝度重心法。雑然とした室内では見当違いの方向を掴みやすいことは
    // SPRINT_1_REPORT.mdでも既知の限界として記載済み)を、足元直下にある
    // べきcore/aoの位置・回転にまでそのまま適用していたこと。
    // 推定が外れた時にcoreまでズレると、「足の真下に来るべき濃い接地点」が
    // 動いてしまい、見た目の破綻が大きい。
    //
    // 対応: 光源方向の影響は一番外側の柔らかいsoftシャドウにのみ、
    // それもごく控えめに残す。core/aoは常にplacementの真下に固定し、
    // 「そこに足が乗っている」という接地の手がかりを光源推定の精度に
    // 依存させないようにする。
    const az = THREE.MathUtils.degToRad(lightAzimuthDeg);
    const shift = width * 0.07;   // 以前の0.18から大幅に縮小
    const offX = -Math.sin(az) * shift;
    const offZ = -Math.cos(az) * shift * 0.5;
    const stretch = 1 + Math.min(0.25, Math.abs(lightAzimuthDeg) / 160); // 伸びも控えめに

    // 実機写真で影がほぼ視認できなかった主因: このアプリのカメラは
    // だいたい水平〜浅い見下ろし角(体感15〜25度程度)でキャラを見ることが多く、
    // 板を寝かせた影は奥行き方向(このplaneのローカルY、ワールドでは水平面内の
    // 前後方向)が強く潰れているとその浅い視点からの透視でさらに潰れ、
    // ほぼ線のようになって消えてしまう。奥行き比率を0.5〜0.6前後から
    // 0.85前後まで引き上げ、浅い角度で見ても面として視認できるようにする。
    // 視線角度による潰れ補正(下限つき)。cameraPos未指定時は1(補正なし)。
    const foreshorten = computeForeshortenFactor(cameraPos, { x: placement.x, y: footY, z: placement.z });
    const DEPTH_RATIO_SOFT = THREE.MathUtils.clamp(0.85 * foreshorten, 0.45, 1.0);
    const DEPTH_RATIO_CORE = THREE.MathUtils.clamp(0.8 * foreshorten, 0.45, 1.0);
    const DEPTH_RATIO_AO = THREE.MathUtils.clamp(0.7 * foreshorten, 0.4, 1.0);

    // 明るい環境(晴天・逆光等)ほど実際のコントラストは強く出るはずなので、
    // 影の不透明度をbrightnessFactorに緩やかに連動させる。
    // opacityは1を超えても見た目上の効果がないため、暗い環境でのみ
    // わずかに弱める方向にとどめる(常時フル濃度を基本とする)。
    const brightBoost = THREE.MathUtils.clamp(0.78 + brightnessFactor * 0.22, 0.78, 1.0);

    // 距離フェード: 「一定距離を超えると影が黒い一枚の板になって浮く」現象への対応。
    // 板一枚に疑似影を貼る手法は、画面上のサイズが数pxまで縮む極端な遠距離では
    // グラデーションが潰れて硬い矩形に見えやすく、また浅い視点角も相まって
    // 足元から浮いて見えやすい。atmosphere.jsと同じ距離しきい値(NEAR_M〜FAR_M)を
    // 使い、遠いほど影自体を薄くフェードさせることで、硬い黒板として
    // 目立つ前に見た目上消えていくようにする(現実でも遠くの影は薄くぼやける)。
    const distanceFade = 1 - computeHazeFactor(distanceMeters) * 0.7;
    const finalOpacity = brightBoost * distanceFade;
    [soft, core, ao].forEach((mesh) => { mesh.material.opacity = finalOpacity; });

    // soft: 光源方向のヒントを(ごく弱く)残す唯一の層
    soft.position.set(placement.x + offX, footY + 0.002, placement.z + offZ);
    soft.scale.set(width * 1.5 * stretch, width * 1.5 * DEPTH_RATIO_SOFT, 1);
    soft.rotation.z = -az * 0.12;

    // core: 「足の真下にある締まった影」。光源方向による位置ズレ・回転は
    // 廃止し、常にplacementの真上に固定する。
    core.position.set(placement.x, footY + 0.003, placement.z);
    core.scale.set(width * 0.68, width * 0.68 * DEPTH_RATIO_CORE, 1);
    core.rotation.z = 0;

    // ao: 「靴底が触れている点」そのもの。もっとも重要な接地の手がかりなので
    // 位置は絶対にズラさず、輪郭をさらに締めて濃さを保つ。
    ao.position.set(placement.x, footY + 0.004, placement.z);
    ao.scale.set(width * 0.26, width * 0.26 * DEPTH_RATIO_AO, 1);
  }

  return { soft, core, ao, update };
}
