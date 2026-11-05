// 📰 교사광장 전도 뉴스 카드(2026-11-05) — 사용자: "가독성 있게, 가능하면 카드 뉴스로. 텍스트는 밑에 달고, 데이터는 가독성 있는 카드 뉴스".
// SVG → PNG(resvg, 나눔고딕 — progress-image.js 와 같은 글꼴). 그림 안에는 이모지를 쓰지 않는다(글꼴에 없음).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'fonts');
const FONTS = ['NanumGothic-Regular.ttf', 'NanumGothic-Bold.ttf'].map((f) => path.join(FONT_DIR, f));
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const comma = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

export const DEPT_COLORS = { 교역자회: '#6366F1', 자문회: '#0EA5E9', 장년회: '#2F9E6E', 부녀회: '#E0567A', 청년회: '#F08A00' };

/** 글자 폭 어림(한글·전각 1, 영문·숫자·기호 0.56) × 글자 크기 */
const widthOf = (s, size) => [...String(s)].reduce((w, ch) => w + (/[ᄀ-ᇿ㄰-㆏가-힯⺀-鿿＀-￯▲▼]/.test(ch) ? 1 : ch === ' ' ? 0.3 : 0.56), 0) * size;
/** 낱말 단위로 줄 바꿈(넘치면 글자 단위), 최대 maxLines 줄 */
function wrap(text, size, maxW, maxLines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (widthOf(next, size) <= maxW) { cur = next; continue; }
    if (cur) lines.push(cur);
    cur = w;
    while (widthOf(cur, size) > maxW) {   // 아주 긴 낱말
      let i = cur.length; while (i > 1 && widthOf(cur.slice(0, i), size) > maxW) i--;
      lines.push(cur.slice(0, i)); cur = cur.slice(i);
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/.{1}$/, '') + '…'; }
  return lines;
}
const deltaOf = (a, b) => (a > b ? { t: `▲ ${a - b}`, c: '#16A34A', bg: '#DCFCE7' } : a < b ? { t: `▼ ${b - a}`, c: '#DC2626', bg: '#FEE2E2' } : { t: '전날과 같음', c: '#6B7280', bg: '#F3F4F6' });

/**
 * n = { date:'11월 4일(수)', headline, total:{records, prevRecords, teachers, gospel, center, morning},
 *       depts:[{ label, records, prevRecords, teachers, line }] }
 */
export function newsCardPng(n) {
  const W = 1080, PAD = 48, out = [];
  // ── 머리(짙은 남색 띠)
  const hlLines = wrap(n.headline, 46, W - PAD * 2, 3);
  const headH = 150 + hlLines.length * 60 + 30;
  out.push(`<rect x="0" y="0" width="${W}" height="${headH}" fill="#0F1E3D"/>`,
    `<rect x="${PAD}" y="48" width="8" height="34" rx="3" fill="#00AE82"/>`,
    `<text x="${PAD + 22}" y="76" font-size="30" font-weight="700" fill="#7DE3C4">${esc(n.title || '교사광장 전도 뉴스')}</text>`,
    `<text x="${W - PAD}" y="76" font-size="28" fill="#C7D2E8" text-anchor="end">${esc(n.date)}</text>`,
    `<text x="${PAD}" y="128" font-size="24" fill="#93A4C6">HEADLINE</text>`);
  hlLines.forEach((l, i) => out.push(`<text x="${PAD}" y="${188 + i * 60}" font-size="46" font-weight="700" fill="#FFFFFF">${esc(l)}</text>`));

  // ── 숫자 칸 3개
  let y = headH + 32;
  const tiles = [
    ['전체 기록', `${comma(n.total.records)}건`, deltaOf(n.total.records, n.total.prevRecords)],
    ['활동 교사', `${comma(n.total.teachers)}명`, null],
    ['복음방 · 센터', `${comma(n.total.gospel)}건 · ${comma(n.total.center)}건`, null],
  ];
  const tw = (W - PAD * 2 - 2 * 20) / 3, th = 150;
  tiles.forEach(([k, v, d], i) => {
    const x = PAD + i * (tw + 20);
    out.push(`<rect x="${x}" y="${y}" width="${tw}" height="${th}" rx="20" fill="#F4F7FB"/>`,
      `<text x="${x + 26}" y="${y + 46}" font-size="25" fill="#5B6478">${esc(k)}</text>`,
      `<text x="${x + 26}" y="${y + 104}" font-size="${widthOf(v, 46) > tw - 52 ? 36 : 46}" font-weight="700" fill="#111827">${esc(v)}</text>`);
    if (d) {
      const cw = widthOf(d.t, 22) + 28;
      out.push(`<rect x="${x + tw - cw - 18}" y="${y + 22}" width="${cw}" height="36" rx="18" fill="${d.bg}"/>`,
        `<text x="${x + tw - 18 - cw / 2}" y="${y + 47}" font-size="22" font-weight="700" fill="${d.c}" text-anchor="middle">${esc(d.t)}</text>`);
    }
  });
  y += th + 36;

  // ── 부서 카드 5장
  const maxRec = Math.max(1, ...n.depts.map((d) => d.records));
  for (const d of n.depts) {
    const color = DEPT_COLORS[d.label] || '#64748B';
    const lines = wrap(d.line || (d.records ? '' : '기록 없음'), 30, W - PAD * 2 - 64, 2);
    const ch = 118 + lines.length * 42 + 26;
    const x = PAD, cw = W - PAD * 2;
    out.push(`<rect x="${x}" y="${y}" width="${cw}" height="${ch}" rx="22" fill="#FFFFFF" stroke="#E5E9F0" stroke-width="2"/>`,
      `<rect x="${x}" y="${y}" width="12" height="${ch}" rx="6" fill="${color}"/>`,
      `<text x="${x + 40}" y="${y + 58}" font-size="36" font-weight="700" fill="${color}">${esc(d.label)}</text>`);
    // 오른쪽: 건수 + 전날 대비
    const dl = deltaOf(d.records, d.prevRecords);
    const dw = widthOf(dl.t, 22) + 28;
    out.push(`<rect x="${x + cw - 30 - dw}" y="${y + 30}" width="${dw}" height="36" rx="18" fill="${dl.bg}"/>`,
      `<text x="${x + cw - 30 - dw / 2}" y="${y + 55}" font-size="22" font-weight="700" fill="${dl.c}" text-anchor="middle">${esc(dl.t)}</text>`,
      `<text x="${x + cw - 30 - dw - 18}" y="${y + 60}" font-size="38" font-weight="700" fill="#111827" text-anchor="end">${comma(d.records)}<tspan font-size="24" fill="#6B7280" font-weight="400">건 · ${comma(d.teachers)}명${d.rate ? ` · 참여 ${esc(d.rate)}` : ''}</tspan></text>`);
    // 비중 막대(가장 많은 부서 = 꽉 참)
    const bx = x + 40, bw = cw - 80, by = y + 84;
    out.push(`<rect x="${bx}" y="${by}" width="${bw}" height="12" rx="6" fill="#EEF1F5"/>`);
    if (d.records) out.push(`<rect x="${bx}" y="${by}" width="${Math.max(12, bw * d.records / maxRec)}" height="12" rx="6" fill="${color}"/>`);
    lines.forEach((l, i) => out.push(`<text x="${x + 40}" y="${y + 140 + i * 42}" font-size="30" fill="#1F2937">${esc(l)}</text>`));
    y += ch + 18;
  }
  // ── 꼬리
  y += 10;
  out.push(`<text x="${PAD}" y="${y + 24}" font-size="22" fill="#8A93A6">데이터: 교사광장 서머리 1~5번 · 섭외자-인도자 한 쌍 = 1건</text>`);
  const H = y + 56;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="NanumGothic"><rect width="${W}" height="${H}" fill="#FFFFFF"/>${out.join('')}</svg>`;
  return Buffer.from(new Resvg(svg, { font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'NanumGothic' }, fitTo: { mode: 'width', value: W } }).render().asPng());
}
