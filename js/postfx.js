/* ============================================================
   postfx.js — 撮影後の「写真らしさ」仕上げ処理
   ------------------------------------------------------------
   Sprint 1「Camera」調査タスクへの対応。
   演出目的ではなく「写真らしさの向上」が目的のため、
   すべて非常に弱いパラメータをデフォルトにしている。

   【実装方式に関する判断】
   毎フレームのライブプレビューに掛けるのではなく、
   「シャッターを押した瞬間の静止画1枚」にのみ適用する設計にした。
   理由:
     - ライブプレビューは video要素 + three.jsのcanvas を
       CSSで重ねているだけで、常時1枚のcanvasに合成していない
       (合成はシャッター時のみ)。毎フレーム合成へ切り替えると
       常時2Dピクセル処理が走り、モバイルでの負荷が大きくなる
     - 静止画1枚に対してであれば getImageData/putImageData を
       使った本格的な色収差处理を行っても許容範囲のコストで済む
   そのため「プレビューでは見えないが、撮影結果には反映される」
   という設計になっている。

   【調査結果サマリ】
   - Vignette: 実装容易、コスト極小 → 採用
   - Film Grain: 実装容易、コスト小 → 採用(固定ノイズパターンをタイル状に)
   - Chromatic Aberration: ピクセル単位の処理が必要でコストは中程度だが、
     静止画1枚のみなら許容範囲 → 採用(ごく弱く)
   - Bloom: 本格的にはEffectComposer+UnrealBloomPassが必要(3Dシーン単体への
     適用が前提)。今回は「video+3D合成後の最終画像」に対してcanvas 2Dの
     blur+加算合成で疑似的なブルームを近似する簡易版を採用。
     真のHDRベースのブルームではないため、光源の強さに応じた自然な滲みは
     再現できない点に注意。
   - カラーグレーディング(追加): 彩度+5%/コントラスト-5%/簡易トーンカーブ
     (ハイライト圧縮+シャドウ持ち上げ)/環境光推定の平均色をごく薄く全体に
     乗せるティント。モデルだけでなく背景を含む画像全体に適用することで、
     「CGと実写の色が違う」という違和感を減らす狙い(元の開発記録の改善案⑧に対応)。
   ============================================================ */

let grainTexture = null;
function getGrainTexture() {
  if (grainTexture) return grainTexture;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const imgData = ctx.createImageData(size, size);
  for (let i = 0; i < imgData.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 255;
    imgData.data[i] = v;
    imgData.data[i + 1] = v;
    imgData.data[i + 2] = v;
    imgData.data[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  grainTexture = c;
  return grainTexture;
}

function applyVignette(ctx, w, h, strength) {
  const g = ctx.createRadialGradient(
    w / 2, h / 2, Math.min(w, h) * 0.35,
    w / 2, h / 2, Math.max(w, h) * 0.72
  );
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function applyGrain(ctx, w, h, opacity) {
  const tile = getGrainTexture();
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = 'overlay';
  const pattern = ctx.createPattern(tile, 'repeat');
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function applyBloomApprox(ctx, w, h, sourceCanvas, strength) {
  if (!ctx.filter) return; // 古いSafari等、filter未対応環境では諦める
  ctx.save();
  ctx.filter = `blur(${Math.round(Math.max(w, h) * 0.006)}px) brightness(1.5)`;
  ctx.globalAlpha = strength;
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(sourceCanvas, 0, 0, w, h);
  ctx.restore();
  ctx.filter = 'none';
}

function applyPixelPass(ctx, w, h, pixels, { chromaticAberration, chromaticAberrationPx, saturation, contrast, tint }) {
  // 色収差とカラーグレーディングは同じピクセル配列を1回だけ走査して同時に
  // 処理する(静止画1枚とはいえ、2回に分けるより多少軽い)。
  //
  // 実機写真で、背景(鉄骨・ドア枠等)にまで明確な色ズレが乗っていることが
  // 確認された。原因は shift を解像度に比例(min(w,h)*0.0015)させていたこと。
  // iPhoneの実際の撮影解像度では意図した1px程度が5px前後まで拡大され、
  // 「エフェクトとわかるレベル」の色収差になっていた。
  // 色収差は本来「解像度に関わらず、知覚できるかできないか」の絶対量が
  // 正しいので、解像度スケーリングをやめて絶対px(既定1px、上限あり)に変更する。
  const shift = chromaticAberration ? Math.max(0, Math.min(2, Math.round(chromaticAberrationPx ?? 1))) : 0;
  const src = pixels.data;
  const out = new Uint8ClampedArray(src.length);
  const tr = tint ? tint.r : 1, tg = tint ? tint.g : 1, tb = tint ? tint.b : 1;
  const tintAmount = tint ? tint.amount : 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r, g, b;
      if (shift > 0) {
        const xr = Math.min(w - 1, x + shift);
        const xb = Math.max(0, x - shift);
        r = src[(y * w + xr) * 4];
        g = src[i + 1];
        b = src[(y * w + xb) * 4 + 2];
      } else {
        r = src[i]; g = src[i + 1]; b = src[i + 2];
      }

      // 彩度: グレースケール値からの距離を係数倍する
      if (saturation !== 1) {
        const gray = r * 0.299 + g * 0.587 + b * 0.114;
        r = gray + (r - gray) * saturation;
        g = gray + (g - gray) * saturation;
        b = gray + (b - gray) * saturation;
      }
      // コントラスト: 中間グレー(128)へ引き寄せる(<1で弱める)
      if (contrast !== 1) {
        r = 128 + (r - 128) * contrast;
        g = 128 + (g - 128) * contrast;
        b = 128 + (b - 128) * contrast;
      }
      // ハイライト圧縮+シャドウ持ち上げ: 簡易なフィルミック風トーンカーブ近似。
      // 元の+9持ち上げは、ただでさえ薄い接地影(shadow-rig.js)のコントラストを
      // さらに削っていたため、持ち上げ量を弱めた(+9→+3、係数0.94→0.97)。
      // ハイライト側の柔らかさは概ね維持しつつ、黒が浮きすぎないようにする。
      r = r * 0.97 + 3;
      g = g * 0.97 + 3;
      b = b * 0.97 + 3;
      // 環境色ティント: 撮影時のその場の平均色へごくわずかに寄せる
      if (tintAmount > 0) {
        r = r * (1 - tintAmount) + r * tr * tintAmount;
        g = g * (1 - tintAmount) + g * tg * tintAmount;
        b = b * (1 - tintAmount) + b * tb * tintAmount;
      }

      const o = (y * w + x) * 4;
      out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = src[i + 3];
    }
  }
  pixels.data.set(out);
  ctx.putImageData(pixels, 0, 0);
}

/**
 * 撮影済みの合成canvas(video+3Dモデル合成後)に対して、
 * 弱いビネット・グレイン・色収差・疑似ブルーム・カラーグレーディングを
 * 1回だけ適用する。
 * @param {HTMLCanvasElement} canvas 合成済みの出力canvas(この中身を直接書き換える)
 * @param {object} [options]
 * @param {{r:number,g:number,b:number}} [options.envTint] 環境光推定の平均色(0〜1)。
 *   写真全体(背景含む)へごく薄く乗せることで、CGと実写の色を馴染ませる。
 */
export function applyPhotoFinish(canvas, options = {}) {
  const {
    vignette = 0.18,
    grain = 0.05,
    bloom = 0.08,        // 実機写真で白い衣装の縁が眠く光りすぎていたため弱める
    chromaticAberration = true,
    chromaticAberrationPx = 1, // 解像度非依存の絶対px。上限2pxでクランプされる
    saturation = 1.05,   // 彩度 +5%
    contrast = 0.95,     // コントラスト -5%
    envTint = null,
    tintAmount = 0.12,   // 環境色を混ぜる強さ(lighting.js側の修正と合わせやや強め)
  } = options;

  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;

  if (bloom > 0) applyBloomApprox(ctx, w, h, canvas, bloom);

  const needsPixelPass = chromaticAberration || saturation !== 1 || contrast !== 1 || (envTint && tintAmount > 0);
  if (needsPixelPass) {
    try {
      const pixels = ctx.getImageData(0, 0, w, h);
      applyPixelPass(ctx, w, h, pixels, {
        chromaticAberration,
        chromaticAberrationPx,
        saturation,
        contrast,
        tint: envTint ? { ...envTint, amount: tintAmount } : null,
      });
    } catch (e) {
      console.warn('color grading / chromatic aberration skipped', e);
    }
  }
  if (vignette > 0) applyVignette(ctx, w, h, vignette);
  if (grain > 0) applyGrain(ctx, w, h, grain);
}
