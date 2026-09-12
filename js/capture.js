// Before/after composition, saving and sharing.

const GAP = 12;
const LABEL_H = 56;

/**
 * Compose two canvases side by side with labels.
 * @returns {HTMLCanvasElement}
 */
export function composeBeforeAfter(before, after) {
  const w = before.width;
  const h = before.height;
  // Keep the export a sensible size for sharing.
  const scale = Math.min(1, 1080 / h, 2160 / (w * 2 + GAP));
  const cw = Math.round(w * scale);
  const ch = Math.round(h * scale);
  const out = document.createElement('canvas');
  out.width = cw * 2 + GAP;
  out.height = ch + LABEL_H;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(before, 0, LABEL_H, cw, ch);
  ctx.drawImage(after, cw + GAP, LABEL_H, cw, ch);
  ctx.fillStyle = '#fff';
  ctx.font = `600 ${Math.round(LABEL_H * 0.42)}px system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText('Before', cw / 2, LABEL_H / 2);
  ctx.fillText('After', cw + GAP + cw / 2, LABEL_H / 2);
  return out;
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, quality);
  });
}

export function canShareFiles(file) {
  return !!(navigator.share && navigator.canShare && navigator.canShare({ files: [file] }));
}

export async function shareFile(file) {
  await navigator.share({ files: [file], title: 'Before / after' });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
