// Note look & layout shared by the editable DOM note and its 3D twin.
// Keep these numbers in sync with styles.css (.note, .note .editor, .line).
import { parseLines } from './editor.js';

export const NOTE_SIZE = 250;
export const GLUE_FRACTION = 0.2; // top strip of the back that carries adhesive

export const LAYOUT = {
  textTop: 36,
  textLeft: 18,
  textRight: 16,
  textBottom: 14,
  fontSize: 18,
  lineHeight: 26,
  font: '"Ink Free", "Segoe Print", "Comic Sans MS", cursive',
  boxSize: 15, // checklist box; .line .box in styles.css
  boxIndent: 24, // box + gap before the item text
};

export const COLORS = {
  yellow: { paper: '#fff27d', shade: '#f5df52', back: '#fbeb8e', ink: '#3b3420' },
  pink:   { paper: '#ffb8d2', shade: '#f797ba', back: '#ffc9dc', ink: '#4a2433' },
  blue:   { paper: '#a9dcff', shade: '#86c8f5', back: '#bfe4ff', ink: '#1f3446' },
  green:  { paper: '#c4f0a0', shade: '#a6e07c', back: '#d2f3b6', ink: '#2a3a1d' },
  orange: { paper: '#ffcf8a', shade: '#fbb75e', back: '#ffdaa3', ink: '#45311a' },
  purple: { paper: '#d9c6ff', shade: '#c3a8fb', back: '#e2d3ff', ink: '#2f2547' },
};
export const COLOR_ORDER = Object.keys(COLORS);

let grain = null;
function grainPattern(ctx) {
  if (!grain) {
    const g = document.createElement('canvas');
    g.width = g.height = 128;
    const gx = g.getContext('2d');
    const img = gx.createImageData(128, 128);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 10;
    }
    gx.putImageData(img, 0, 0);
    grain = g;
  }
  return ctx.createPattern(grain, 'repeat');
}

// Word-wraps like a textarea with `white-space: pre-wrap; overflow-wrap: anywhere`.
export function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (!word) continue;
      if (ctx.measureText(line + word).width <= maxWidth) {
        line += word;
        continue;
      }
      if (/^\s+$/.test(word)) {
        // whitespace at a wrap point is swallowed, like a textarea does
        lines.push(line);
        line = '';
        continue;
      }
      if (line) lines.push(line);
      line = '';
      // a word longer than a whole line breaks by characters
      for (const ch of word) {
        if (line && ctx.measureText(line + ch).width > maxWidth) {
          lines.push(line);
          line = '';
        }
        line += ch;
      }
    }
    lines.push(line);
  }
  return lines;
}

function paperBase(ctx, w, h, color, front) {
  const c = COLORS[color] || COLORS.yellow;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, front ? c.paper : c.back);
  grad.addColorStop(1, front ? mix(c.paper, c.shade, 0.35) : c.back);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = grainPattern(ctx);
  ctx.fillRect(0, 0, w, h);
  return c;
}

// Renders a note face to a canvas at `scale` device pixels per CSS pixel.
export function drawFront(canvas, note, scale, scrollTop = 0) {
  const w = NOTE_SIZE, h = NOTE_SIZE;
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const c = paperBase(ctx, w, h, note.color, true);

  // faint sheen on the glue strip, like the real thing
  const glue = ctx.createLinearGradient(0, 0, 0, h * GLUE_FRACTION);
  glue.addColorStop(0, 'rgba(255,255,255,0.18)');
  glue.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glue;
  ctx.fillRect(0, 0, w, h * GLUE_FRACTION);

  drawText(ctx, note.text, c.ink, scrollTop, 1);
  drawDoodles(ctx, note.doodles, c.ink);
  return canvas;
}

export function drawBack(canvas, note, scale) {
  const w = NOTE_SIZE, h = NOTE_SIZE;
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const c = paperBase(ctx, w, h, note.color, false);
  // adhesive band: slightly darker, glossy strip along the top
  ctx.fillStyle = 'rgba(120, 90, 0, 0.07)';
  ctx.fillRect(0, 0, w, h * GLUE_FRACTION);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(0, h * GLUE_FRACTION - 2, w, 2);
  // the ink shows through a little; seen from behind it appears mirrored automatically
  drawText(ctx, note.text, c.ink, 0, 0.08);
  drawDoodles(ctx, note.doodles, c.ink, 0.08);
  return canvas;
}

function drawText(ctx, text, ink, scrollTop, alpha) {
  if (!text) return;
  const { textTop, textLeft, textRight, textBottom, fontSize, lineHeight, font, boxSize, boxIndent } = LAYOUT;
  const maxWidth = NOTE_SIZE - textLeft - textRight;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, textTop, NOTE_SIZE, NOTE_SIZE - textTop - textBottom);
  ctx.clip();
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.font = `${fontSize}px ${font}`;
  ctx.textBaseline = 'middle';
  let top = textTop - scrollTop; // top of the current line box
  for (const line of parseLines(text)) {
    if (top > NOTE_SIZE) break;
    const isItem = line.check !== null;
    const x = textLeft + (isItem ? boxIndent : 0);
    if (isItem) drawCheckbox(ctx, textLeft, top + (lineHeight - boxSize) / 2, boxSize, line.check, alpha);
    ctx.globalAlpha = alpha * (line.check ? 0.5 : 1);
    for (const part of wrapText(ctx, line.text, maxWidth - (x - textLeft))) {
      if (top > NOTE_SIZE) break;
      ctx.fillText(part, x, top + lineHeight / 2);
      if (line.check && part) ctx.fillRect(x, top + lineHeight / 2, ctx.measureText(part).width, 1.4);
      top += lineHeight;
    }
  }
  ctx.restore();
}

/**
 * Freehand doodles, in note coordinates (0..NOTE_SIZE). Each stroke is { w, pts: [x, y, x, y…] },
 * drawn as a smooth curve through the midpoints, so mouse jitter reads as a felt-pen line.
 */
export function drawDoodles(ctx, doodles, ink, alpha = 1) {
  if (!doodles?.length) return;
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = alpha * 0.9;
  for (const stroke of doodles) {
    const p = stroke.pts;
    if (p.length < 2) continue;
    if (p.length === 2) {
      // a tap: a dot
      ctx.beginPath();
      ctx.arc(p[0], p[1], stroke.w / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.lineWidth = stroke.w;
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length - 2; i += 2) {
      ctx.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
    }
    ctx.lineTo(p[p.length - 2], p[p.length - 1]);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCheckbox(ctx, x, y, size, checked, alpha) {
  ctx.globalAlpha = alpha * 0.75;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.roundRect(x + 0.8, y + 0.8, size - 1.6, size - 1.6, 4);
  ctx.stroke();
  if (!checked) return;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x + 3.6, y + 7.8);
  ctx.lineTo(x + 6.4, y + 10.6);
  ctx.lineTo(x + 11.6, y + 4.2);
  ctx.stroke();
}

function mix(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (p, s) => (p >> s) & 255;
  const m = (s) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t);
  return `rgb(${m(16)},${m(8)},${m(0)})`;
}
