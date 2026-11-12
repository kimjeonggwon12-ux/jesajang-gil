// 목요 사명자 교육 출석현황 카드(2026-11-12) — 사용자가 보낸 "9/10 목요 사명자 교육 출석현황" 표 모양 그대로:
//   가운데 큰 제목 / 노랑 머리 / 참석·참석률 파랑 / 이전 참석률 회색 / 불참·불참률 빨강 / 불참자 사유(직장·병결·가정사·개인사) 분홍 / 종합 줄 노랑.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts');
const FONTS = ['NanumGothic-Regular.ttf', 'NanumGothic-Bold.ttf'].map((f) => path.join(FONT_DIR, f));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const REASONS = ['직장', '병결', '가정사', '개인사'];

/**
 * c = { title, rows:[{ label, n, came, rate, prev, absent, absentRate, reasons:{직장..} }], total:{ 같은 칸 }, reasonTotal }
 * rate·prev·absentRate 는 글자('83.2%' / '-')
 */
export function eduCardPng(c) {
  const F = 19, RH = 40, HH = 36, PAD = 18, TITLE = 64;
  const W = [150, 92, 92, 104, 88, 84, 98, ...REASONS.map(() => 82)];
  const xs = W.reduce((a, w, i) => (a.push(i ? a[i - 1] + W[i - 1] : PAD), a), []);
  const tableW = W.reduce((a, b) => a + b, 0);
  const width = tableW + PAD * 2;
  const top = PAD + TITLE;
  const bodyTop = top + HH * 2;
  const rows = [...c.rows, { ...c.total, label: '종합', total: true }];
  const height = bodyTop + RH * rows.length + PAD;
  const P = [];
  const rect = (x, y, w, h, fill) => P.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`);
  const text = (x, y, s, { size = F, color = '#111', bold = false, anchor = 'middle' } = {}) =>
    P.push(`<text x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}" fill="${color}" font-weight="${bold ? 700 : 400}">${esc(s)}</text>`);
  const mid = (i) => xs[i] + W[i] / 2;
  const BLUE = '#1d3fe0', RED = '#e0312b', YEL = '#fff2cc', GRAY = '#e7e6e6', PINK = '#fce4e4';

  rect(0, 0, width, height, '#ffffff');
  text(width / 2, PAD + 40, c.title, { size: 32, bold: true });

  // 머리 두 줄: 0~6 칸은 두 줄 합침, 7~10 은 위 '불참자 사유 (N명)' + 아래 사유
  const heads = [[c.firstHead || '부서'], ['대상'], ['참석'], ['참석률'], ['이전', '참석률'], ['불참'], ['불참률']];
  const headFill = [YEL, YEL, YEL, YEL, GRAY, PINK, PINK];
  const headColor = ['#111', '#111', BLUE, BLUE, '#111', RED, RED];
  heads.forEach((h, i) => {
    rect(xs[i], top, W[i], HH * 2, headFill[i]);
    if (h.length === 1) text(mid(i), top + HH + 8, h[0], { size: 22, bold: true, color: headColor[i] });
    else h.forEach((l, k) => text(mid(i), top + HH - 4 + k * 20, l, { size: 15, bold: true, color: headColor[i] }));
  });
  const rx = xs[7], rw = W.slice(7).reduce((a, b) => a + b, 0);
  rect(rx, top, rw, HH, PINK);
  text(rx + rw / 2, top + HH / 2 + 8, `불참자 사유 (${c.reasonTotal}명)`, { size: 22, bold: true });
  REASONS.forEach((r, k) => { rect(xs[7 + k], top + HH, W[7 + k], HH, PINK); text(mid(7 + k), top + HH + HH / 2 + 7, r, { size: 18 }); });

  rows.forEach((r, ri) => {
    const y = bodyTop + RH * ri, ty = y + RH / 2 + 7;
    if (r.total) rect(xs[0], y, tableW, RH, YEL);
    rect(xs[4], y, W[4], RH, r.total ? '#d9d9d9' : GRAY);
    const cells = [r.label, r.n, r.came, r.rate, r.prev, r.absent, r.absentRate, ...REASONS.map((k) => (r.reasons && r.reasons[k] != null ? r.reasons[k] : ''))];
    cells.forEach((v, i) => {
      const o = { bold: !!r.total };
      if (r.total && (i === 2 || i === 3)) o.color = BLUE;
      if (r.total && i === 5) o.color = RED;
      if (i === 6) { text(xs[i] + W[i] - 12, ty, v, { ...o, anchor: 'end' }); return; }
      text(mid(i), ty, typeof v === 'number' ? v.toLocaleString('en-US') : v, o);
    });
  });

  // 줄: 안쪽 얇게, 바깥·머리 아래·종합 위 굵게
  const line = (x1, y1, x2, y2, w = 1, color = '#9a9a9a') => P.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${w}"/>`);
  const bottom = bodyTop + RH * rows.length;
  for (let r = 0; r <= rows.length; r++) line(PAD, bodyTop + RH * r, PAD + tableW, bodyTop + RH * r, r === 0 || r === rows.length - 1 ? 2 : 1);
  line(rx, top + HH, rx + rw, top + HH);
  for (let i = 1; i < W.length; i++) line(xs[i], i >= 8 ? top + HH : top, xs[i], bottom, 1);
  P.push(`<rect x="${PAD}" y="${top}" width="${tableW}" height="${bottom - top}" fill="none" stroke="#333" stroke-width="2"/>`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="NanumGothic">${P.join('')}</svg>`;
  return Buffer.from(new Resvg(svg, { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'NanumGothic' }, fitTo: { mode: 'zoom', value: 2 } }).render().asPng());
}
