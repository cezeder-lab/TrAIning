import { BLOCK_LABELS, type SheetData, type SheetExercise } from '@training/core';
import { formatLongDate } from '../../lib/dates.ts';

/** Format portrait téléphone : 1170 px de large, ratio ≈ 9:19,5. */
export const SHEET_WIDTH = 1170;
export const SHEET_HEIGHT = 2535;

export interface SheetOptions {
  theme: 'dark' | 'light';
  onePerBlock: boolean;
  thumbnails: boolean;
  /** Images déjà chargées, par chemin relatif de média. */
  images: Map<string, HTMLImageElement>;
}

const THEMES = {
  dark: { bg: '#0b0e13', card: '#161b23', text: '#f4f6f8', muted: '#aeb8c4', accent: '#3ddc9f', box: '#e8ecf0', optional: '#8b96a3' },
  light: { bg: '#ffffff', card: '#f1f3f6', text: '#0d1117', muted: '#4a5360', accent: '#077a58', box: '#1b2027', optional: '#6a7481' },
};

const FONT = "'Segoe UI', 'Segoe UI Variable Text', system-ui, -apple-system, sans-serif";
const M = 56; // marge extérieure
const PAD = 34; // marge intérieure des cartes
const GAP = 26; // espace entre cartes
const THUMB = 170;

const font = (size: number, weight = 400, italic = false) => `${italic ? 'italic ' : ''}${weight} ${size}px ${FONT}`;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width <= maxWidth || !line) line = test;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

interface Row {
  font: string;
  color: keyof (typeof THEMES)['dark'];
  lines: string[];
  lh: number;
}

/** Lignes de texte d'une carte exercice (mesurées pour la pagination). */
function layoutExercise(ctx: CanvasRenderingContext2D, ex: SheetExercise, textWidth: number): { rows: Row[]; height: number } {
  const rows: Row[] = [];
  const add = (f: string, color: Row['color'], text: string | null | undefined, lh: number, max = 99) => {
    if (!text) return;
    ctx.font = f;
    const lines = wrap(ctx, text, textWidth);
    rows.push({ font: f, color, lines: lines.length > max ? [...lines.slice(0, max - 1), `${lines[max - 1]}…`] : lines, lh });
  };
  add(font(50, 700), ex.isOptional ? 'optional' : 'text', ex.isOptional ? `${ex.title} (optionnel)` : ex.title, 60, 2);
  if (ex.exerciseName) add(font(34, 500), 'muted', ex.exerciseName, 42, 2);
  add(font(46, 700), 'accent', [ex.target, ex.load, ex.rir].filter((s) => s && s !== '—').join('   ·   ') || '—', 56, 2);
  add(font(34), 'muted', ex.last, 42, 2);
  if (ex.alternatives.length) add(font(30), 'muted', `ou : ${ex.alternatives.join(' · ')}`, 38, 2);
  add(font(32, 400, true), 'muted', ex.comment, 40, 3);
  const textH = rows.reduce((h, r) => h + r.lines.length * r.lh, 0);
  const boxesH = 76;
  return { rows, height: PAD * 2 + textH + 18 + boxesH };
}

/** Rend la fiche en une ou plusieurs pages (canvas). */
export function renderSheet(data: SheetData, opts: SheetOptions): HTMLCanvasElement[] {
  const c = THEMES[opts.theme];
  const measure = document.createElement('canvas').getContext('2d')!;
  const cardW = SHEET_WIDTH - M * 2;
  const withThumbs = opts.thumbnails && data.exercises.some((e) => e.thumbnail && opts.images.has(e.thumbnail));
  const textWidth = cardW - PAD * 2 - (withThumbs ? THUMB + 28 : 0);

  const headerH = 236;
  const footerH = 70;
  const blockTitleH = 64;
  const usable = SHEET_HEIGHT - headerH - footerH;

  // Répartition en pages.
  type Item = { ex: SheetExercise; h: number; rows: Row[]; blockTitle: string | null };
  const pages: Item[][] = [[]];
  let used = 0;
  let prevKey: string | null = null;
  for (const ex of data.exercises) {
    const key = `${ex.block}|${ex.blockLabel ?? ''}`;
    const newBlock = key !== prevKey;
    const label = `${BLOCK_LABELS[ex.block]}${ex.blockLabel ? ` — ${ex.blockLabel}` : ''}`;
    const { rows, height } = layoutExercise(measure, ex, textWidth);
    let blockTitle = newBlock ? label : null;
    let h = height + GAP + (blockTitle ? blockTitleH : 0);
    if (pages[pages.length - 1]!.length > 0 && ((opts.onePerBlock && newBlock) || used + h > usable)) {
      pages.push([]);
      used = 0;
      if (!blockTitle) {
        blockTitle = `${label} (suite)`;
        h += blockTitleH;
      }
    }
    pages[pages.length - 1]!.push({ ex, h, rows, blockTitle });
    used += h;
    prevKey = key;
  }

  return pages.map((items, pageIndex) => {
    const canvas = document.createElement('canvas');
    canvas.width = SHEET_WIDTH;
    canvas.height = SHEET_HEIGHT;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, SHEET_WIDTH, SHEET_HEIGHT);
    ctx.textBaseline = 'top';

    // En-tête
    ctx.fillStyle = c.text;
    ctx.font = font(76, 800);
    ctx.fillText(wrap(ctx, data.title, cardW - 160)[0] ?? data.title, M, 60);
    ctx.fillStyle = c.muted;
    ctx.font = font(38, 500);
    const sub = [data.date ? formatLongDate(data.date) : null, pages.length > 1 ? `page ${pageIndex + 1}/${pages.length}` : null].filter(Boolean).join('  ·  ');
    if (sub) ctx.fillText(sub, M, 150);

    let y = headerH;
    for (const it of items) {
      if (it.blockTitle) {
        ctx.fillStyle = c.accent;
        ctx.font = font(34, 800);
        ctx.fillText(it.blockTitle.toUpperCase(), M + 4, y + 10);
        y += blockTitleH;
      }
      const cardH = it.h - GAP - (it.blockTitle ? blockTitleH : 0);
      ctx.fillStyle = c.card;
      ctx.beginPath();
      ctx.roundRect(M, y, cardW, cardH, 26);
      ctx.fill();
      if (it.ex.isOptional) {
        ctx.setLineDash([14, 10]);
        ctx.strokeStyle = c.optional;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      let tx = M + PAD;
      const img = withThumbs && it.ex.thumbnail ? opts.images.get(it.ex.thumbnail) : undefined;
      if (withThumbs) {
        if (img) {
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(tx, y + PAD, THUMB, THUMB, 18);
          ctx.clip();
          const s = Math.max(THUMB / img.width, THUMB / img.height);
          ctx.drawImage(img, tx + (THUMB - img.width * s) / 2, y + PAD + (THUMB - img.height * s) / 2, img.width * s, img.height * s);
          ctx.restore();
        }
        tx += THUMB + 28;
      }
      let ty = y + PAD;
      for (const r of it.rows) {
        ctx.font = r.font;
        ctx.fillStyle = c[r.color];
        for (const line of r.lines) {
          ctx.fillText(line, tx, ty);
          ty += r.lh;
        }
      }
      // Cases à cocher (une par série)
      ty += 18;
      ctx.strokeStyle = c.box;
      ctx.lineWidth = 4;
      const n = Math.min(it.ex.checkboxes, 10);
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.roundRect(tx + i * 88, ty, 64, 64, 12);
        ctx.stroke();
      }
      y += cardH + GAP;
    }

    ctx.fillStyle = c.muted;
    ctx.font = font(28, 500);
    ctx.fillText('TrAIning', M, SHEET_HEIGHT - 56);
    if (data.comment && pageIndex === 0) {
      ctx.font = font(28, 400, true);
      const note = wrap(ctx, data.comment, cardW - 200)[0] ?? '';
      ctx.fillText(note, M + 170, SHEET_HEIGHT - 56);
    }
    return canvas;
  });
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(async (b) => (b ? resolve(new Uint8Array(await b.arrayBuffer())) : reject(new Error('Rendu PNG impossible'))), 'image/png'),
  );
}

export function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
