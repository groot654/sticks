const { nativeImage } = require('electron');

// Draws a small yellow sticky note with a curled corner straight into a BGRA bitmap,
// so the app needs no binary icon assets.
function createNoteIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const pad = Math.round(size * 0.09);
  const fold = Math.round(size * 0.3);
  const lo = pad;
  const hi = size - pad - 1;

  const put = (x, y, [r, g, b, a]) => {
    const i = (y * size + x) * 4;
    buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = a;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside = x >= lo && x <= hi && y >= lo && y <= hi;
      if (!inside) {
        // soft drop shadow down/right of the note
        const sx = x - 1, sy = y - 2;
        if (sx >= lo && sx <= hi && sy >= lo && sy <= hi && (hi - sx) + (hi - sy) > fold) put(x, y, [0, 0, 0, 60]);
        continue;
      }
      const toCorner = (hi - x) + (hi - y);
      if (toCorner < fold) continue; // corner peeled away
      if (toCorner < fold + Math.max(2, size * 0.12)) {
        put(x, y, [214, 176, 38, 255]); // underside of the curled corner
        continue;
      }
      const shade = Math.round(18 * (y - lo) / (hi - lo));
      const ruled = size >= 32 && x > lo + size * 0.18 && x < hi - size * 0.18 && (y - lo) % Math.round(size * 0.16) === Math.round(size * 0.12);
      put(x, y, ruled ? [196, 160, 40, 255] : [255, 236 - shade, 112 - shade, 255]);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

module.exports = { createNoteIcon };
