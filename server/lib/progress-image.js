// 채움 막대 → PNG(SVG 를 resvg 로). 막대 한 줄 = 그 조직 전체 인원, 채운 만큼 = 해당 인원. 글꼴은 table-image.js 와 같은 나눔고딕.
// 10/30(사용자): "참여 현황이 옆으로 뻗는 그래프로 5개 조직이 한 눈에 — 총 몇 명 중 얼만큼 채워졌구나가 보이게"
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts');
const FONTS = ['NanumGothic-Regular.ttf', 'NanumGothic-Bold.ttf'].map((f) => path.join(FONT_DIR, f));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const comma = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * b = { title, sub, labels:[조직…], totals:[인원…], panels:[{ title, color, values:[…] }], sumLabel? }
 * 마지막 조직을 합계 줄로 굵게 그리려면 sumLabel 에 그 이름.
 */
export function progressPng(b) {
  const W = 960, PAD = 28, LABEL_W = 150, NUM_W = 210, BAR_H = 26, ROW_H = 40, PANEL_GAP = 22;
  const barX = PAD + LABEL_W, barW = W - PAD * 2 - LABEL_W - NUM_W;
  const titleH = 92;
  const panelH = 44 + b.labels.length * ROW_H;
  const H = titleH + b.panels.length * (panelH + PANEL_GAP) + PAD - PANEL_GAP + 10;
  const out = [`<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    `<text x="${PAD}" y="44" font-size="28" font-weight="700" fill="#111">${esc(b.title)}</text>`,
    `<text x="${PAD}" y="74" font-size="17" fill="#6b7772">${esc(b.sub || '')}</text>`];
  b.panels.forEach((p, pi) => {
    const y0 = titleH + pi * (panelH + PANEL_GAP);
    out.push(`<rect x="${PAD - 12}" y="${y0}" width="${W - PAD * 2 + 24}" height="${panelH}" rx="14" fill="#f7f9f8"/>`,
      `<rect x="${PAD}" y="${y0 + 15}" width="6" height="20" rx="3" fill="${p.color}"/>`,
      `<text x="${PAD + 16}" y="${y0 + 32}" font-size="20" font-weight="700" fill="#111">${esc(p.title)}</text>`);
    b.labels.forEach((label, i) => {
      const y = y0 + 44 + i * ROW_H;
      const total = b.totals[i] || 0, v = p.values[i] || 0;
      const ratio = total ? Math.min(1, v / total) : 0;
      const sum = label === b.sumLabel;
      const pct = total ? Math.round((v / total) * 1000) / 10 : 0;
      out.push(
        `<text x="${PAD}" y="${y + BAR_H - 7}" font-size="18" font-weight="${sum ? 700 : 400}" fill="#111">${esc(label)}</text>`,
        `<rect x="${barX}" y="${y}" width="${barW}" height="${BAR_H}" rx="${BAR_H / 2}" fill="#e3e8e5"/>`,
        ratio > 0 ? `<rect x="${barX}" y="${y}" width="${Math.max(BAR_H, barW * ratio)}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${p.color}" ${sum ? '' : 'fill-opacity="0.85"'}/>` : '',
        `<text x="${barX + barW + 14}" y="${y + BAR_H - 7}" font-size="18" fill="#111"><tspan font-weight="700" fill="${p.color}">${pct}%</tspan>  ${comma(v)} / ${comma(total)}명</text>`,
      );
    });
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="NanumGothic">${out.join('')}</svg>`;
  const png = new Resvg(svg, { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'NanumGothic' }, fitTo: { mode: 'zoom', value: 1.5 } }).render().asPng();
  return Buffer.from(png);
}
