// 표 → PNG 이미지(SVG 를 resvg 로). 텔레그램 사진·앱 이미지(우클릭 복사)용. 글꼴은 저장소에 넣은 나눔고딕(OFL).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts');
const FONTS = ['NanumGothic-Regular.ttf', 'NanumGothic-Bold.ttf'].map((f) => path.join(FONT_DIR, f));

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const fixGlyphs = (t) => String(t ?? '').replace(/[①-⑳]/g, (ch) => `(${CIRCLED.indexOf(ch) + 1})`);
const esc = (s) => fixGlyphs(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** 글자 폭 어림(px): 한글·전각 1em, 그 밖 0.58em */
const textW = (s, size) => [...fixGlyphs(s)].reduce((n, ch) => n + (/[ᄀ-ᇿ　-鿿가-힣＀-￯]/.test(ch) ? 1 : 0.58), 0) * size;

/**
 * b = { title, sub?, groups?:[{label, span}] (머리 위 묶음 줄), head:[..], rows:[[..]], align?:['left'|'center'|'right'..], style?(r, c, value) → {fill, color, bold}, foot? }
 * 돌려줌: PNG Buffer
 */
export function tablePng(b) {
  const F = 17, H = 36, PAD = 22, CELLPAD = 14;
  const cols = b.head.length;
  const colW = Array.from({ length: cols }, (_, c) => Math.max(
    textW(b.head[c], F) + CELLPAD * 2,
    ...b.rows.map((r) => textW(r[c], F) + CELLPAD * 2),
    44,
  ));
  // 묶음 머리 글자가 칸보다 넓으면 그 묶음 칸들을 고르게 넓힘
  if (b.groups) {
    let c0 = 0;
    for (const g of b.groups) {
      const need = textW(g.label, F) + CELLPAD * 2, have = colW.slice(c0, c0 + g.span).reduce((a, v) => a + v, 0);
      if (g.label && need > have) for (let i = c0; i < c0 + g.span; i++) colW[i] += (need - have) / g.span;
      c0 += g.span;
    }
  }
  const tableW = colW.reduce((a, x) => a + x, 0);
  const titleH = 34 + (b.sub ? 24 : 0);
  const footLines = b.foot ? String(b.foot).match(/.{1,60}(\s|$)|.{1,60}/g).map((x) => x.trim()).filter(Boolean) : [];
  const W = Math.max(tableW, textW(b.title, 22), ...footLines.map((l) => textW(l, 14))) + PAD * 2;
  const GH = b.groups ? H : 0;   // 묶음 머리 줄
  const tableTop = PAD + titleH + 6 + GH;
  const Hgt = tableTop + H * (b.rows.length + 1) + (footLines.length ? 14 + footLines.length * 20 : 0) + PAD;
  const xs = colW.reduce((a, w, i) => (a.push(i ? a[i - 1] + colW[i - 1] : PAD), a), []);
  const align = b.align || [];
  const cellText = (v, c, y, opt = {}) => {
    const a = align[c] || 'center';
    const x = a === 'left' ? xs[c] + CELLPAD : a === 'right' ? xs[c] + colW[c] - CELLPAD : xs[c] + colW[c] / 2;
    const anchor = a === 'left' ? 'start' : a === 'right' ? 'end' : 'middle';
    return `<text x="${x}" y="${y + H / 2 + F * 0.36}" font-size="${F}" text-anchor="${anchor}" fill="${opt.color || '#1f2a25'}" font-weight="${opt.bold ? 700 : 400}">${esc(v)}</text>`;
  };
  const parts = [];
  parts.push(`<rect width="${W}" height="${Hgt}" fill="#ffffff"/>`);
  const title = String(b.title).replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').trim();   // 글꼴에 없는 이모지는 뺌
  parts.push(`<text x="${PAD}" y="${PAD + 24}" font-size="22" font-weight="700" fill="#111">${esc(title)}</text>`);
  if (b.sub) parts.push(`<text x="${PAD}" y="${PAD + 50}" font-size="14" fill="#6b7772">${esc(b.sub)}</text>`);
  // 묶음 머리 줄(날짜 등)
  if (b.groups) {
    let c0 = 0;
    for (const g of b.groups) {
      const x0 = xs[c0], w = colW.slice(c0, c0 + g.span).reduce((a2, v) => a2 + v, 0);
      if (g.label) {
        parts.push(`<rect x="${x0}" y="${tableTop - GH}" width="${w}" height="${GH}" fill="#0b8a68"/>`);
        parts.push(`<text x="${x0 + w / 2}" y="${tableTop - GH + GH / 2 + F * 0.36}" font-size="${F}" text-anchor="middle" fill="#ffffff" font-weight="700">${esc(g.label)}</text>`);
        parts.push(`<line x1="${x0}" x2="${x0}" y1="${tableTop - GH}" y2="${tableTop}" stroke="#ffffff"/><line x1="${x0 + w}" x2="${x0 + w}" y1="${tableTop - GH}" y2="${tableTop}" stroke="#ffffff"/>`);
      }
      c0 += g.span;
    }
  }
  // 머리줄
  parts.push(`<rect x="${PAD}" y="${tableTop}" width="${tableW}" height="${H}" fill="#00AE82"/>`);
  b.head.forEach((h, c) => parts.push(cellText(h, c, tableTop, { color: '#ffffff', bold: true })));
  // 몸통
  b.rows.forEach((row, r) => {
    const y = tableTop + H * (r + 1);
    parts.push(`<rect x="${PAD}" y="${y}" width="${tableW}" height="${H}" fill="${r % 2 ? '#f6f8f7' : '#ffffff'}"/>`);
    row.forEach((v, c) => {
      const st = (b.style && b.style(r, c, v)) || {};
      if (st.fill) parts.push(`<rect x="${xs[c] + 2}" y="${y + 3}" width="${colW[c] - 4}" height="${H - 6}" rx="6" fill="${st.fill}"/>`);
      parts.push(cellText(v, c, y, st));
    });
  });
  // 줄
  for (let r = 0; r <= b.rows.length + 1; r++) parts.push(`<line x1="${PAD}" x2="${PAD + tableW}" y1="${tableTop + H * r}" y2="${tableTop + H * r}" stroke="#dfe5e2"/>`);
  for (let c = 0; c <= cols; c++) { const x = c < cols ? xs[c] : PAD + tableW; parts.push(`<line x1="${x}" x2="${x}" y1="${tableTop}" y2="${tableTop + H * (b.rows.length + 1)}" stroke="#dfe5e2"/>`); }
  footLines.forEach((l, i) => parts.push(`<text x="${PAD}" y="${tableTop + H * (b.rows.length + 1) + 26 + i * 20}" font-size="14" fill="#4b5651">${esc(l)}</text>`));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(W)}" height="${Math.ceil(Hgt)}" font-family="NanumGothic">${parts.join('')}</svg>`;
  const png = new Resvg(svg, { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'NanumGothic' }, fitTo: { mode: 'zoom', value: 2 } }).render().asPng();
  return Buffer.from(png);
}
