/* ============================================================
   postfx.js — 撮影後の「写真らしさ」仕上げ処理
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
  if (!ctx.filter) return;
  ctx.save();
  ctx.filter = `blur(${Math.round(Math.max(w, h) * 0.006)}px) brightness(1.5)`;
  ctx.globalAlpha = strength;
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(sourceCanvas, 0, 0, w, h);
  ctx.restore();
  ctx.filter = 'none';
}

function applyPixelPass(ctx, w, h, pixels, { chromaticAberration, chromaticAberrationPx, saturation, contrast, tint }) {
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

      if (saturation !== 1) {
        const gray = r * 0.299 + g * 0.587 + b * 0.114;
        r = gray + (r - gray) * saturation;
        g = gray + (g - gray) * saturation;
        b = gray + (b - gray) * saturation;
      }
      if (contrast !== 1) {
        r = 128 + (r - 128) * contrast;
        g = 128 + (g - 128) * contrast;
        b = 128 + (b - 128) * contrast;
      }
      r = r * 0.97 + 3;
      g = g * 0.97 + 3;
      b = b * 0.97 + 3;
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

export function applyPhotoFinish(canvas, options = {}) {
  const {
    vignette = 0.18,
    grain = 0.05,
    bloom = 0.08,
    chromaticAberration = true,
    chromaticAberrationPx = 1,
    saturation = 1.05,
    contrast = 0.95,
    envTint = null,
    tintAmount = 0.12,
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
