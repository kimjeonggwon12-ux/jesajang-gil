// AI상담 › 심리 상담 결과를 상담사용 10쪽 슬라이드로 — 미리 보기와 PPT 내려받기.
// app.html이 [슬라이드] 단추를 누를 때 이 파일을 불러온다(vendor/pptxgen.bundle.js는 내려받을 때만).
// 한 쪽은 "인치 좌표의 도형·글 목록"으로 만들고, 같은 목록을 화면(HTML)과 PPT 양쪽에 그린다.
(function () {
  'use strict';

  const W = 13.333, H = 7.5, PX = 96, M = 0.9, CW = W - M * 2;
  const FONT = '맑은 고딕';
  const CSS_FONT = "'Malgun Gothic','맑은 고딕','Apple SD Gothic Neo','Noto Sans KR',sans-serif";

  // 분위기별 색. AI가 대상자에 맞춰 하나를 고른다.
  const THEMES = {
    calm:  { paper: 'F5EFE4', paper2: 'EAE1D0', card: 'FBF8F1', line: 'D9CDB8', ink: '2A332E', sub: '565B52', accent: '9A5522', accentDeep: '7A3F14', dark: '27322C', dark2: '33403A', darkLine: '4A5A52', onDark: 'F3ECDD', onDarkSub: 'C9CDBF', accentOnDark: 'E3B274', t2: 'E6D3B3', t3: 'E2C08F', warm: 'F3D9B1', sun: 'E9B872' },
    warm:  { paper: 'FAF1EC', paper2: 'F1DFD6', card: 'FFFAF6', line: 'E3CFC4', ink: '3A2A2A', sub: '6A5552', accent: 'A8433A', accentDeep: '7E2E27', dark: '3B2626', dark2: '4A3232', darkLine: '634545', onDark: 'F8ECE4', onDarkSub: 'D6C2BA', accentOnDark: 'F0A98F', t2: 'EFCDBD', t3: 'E9B39E', warm: 'F6D5C4', sun: 'F2B880' },
    fresh: { paper: 'EFF4EE', paper2: 'DCE8DC', card: 'F9FCF8', line: 'C5D6C6', ink: '1F3229', sub: '4E6156', accent: '1F7A56', accentDeep: '155A3F', dark: '173528', dark2: '214636', darkLine: '3A5F4D', onDark: 'EAF4EC', onDarkSub: 'BCD0C2', accentOnDark: '8FD9A8', t2: 'C8DFCB', t3: 'A9D0B3', warm: 'CFE8D4', sun: 'F0C75E' },
    clear: { paper: 'EEF2F6', paper2: 'DCE4EC', card: 'FAFCFE', line: 'C6D2DE', ink: '1E2A3A', sub: '4C5B6C', accent: '2A5C96', accentDeep: '1E4470', dark: '1B2A40', dark2: '263954', darkLine: '3E5373', onDark: 'EAF0F7', onDarkSub: 'BDCADB', accentOnDark: '9CC3EE', t2: 'C9D9EA', t3: 'A9C4E2', warm: 'D2E2F3', sun: 'F0C36A' },
  };

  // 상담 내용에 맞춰 고르는 그림 4가지(장식용 아이콘은 두지 않는다).
  const MOTIFS = {
    tea: { w: 560, h: 520, label: '김이 오르는 찻잔', draw: (c) => `
      <path d="M200 190 C180 150 230 130 205 80" fill="none" stroke="#${c.sun}" stroke-width="7" stroke-linecap="round"/>
      <path d="M280 180 C255 135 310 115 280 60" fill="none" stroke="#${c.sun}" stroke-width="7" stroke-linecap="round"/>
      <path d="M360 190 C340 150 390 130 365 80" fill="none" stroke="#${c.sun}" stroke-width="7" stroke-linecap="round"/>
      <path d="M450 262 C524 262 522 352 424 356" fill="none" stroke="#${c.ink}" stroke-width="9" stroke-linecap="round"/>
      <path d="M110 230 H450 C450 340 400 410 280 410 C160 410 110 340 110 230 Z" fill="#${c.card}" stroke="#${c.ink}" stroke-width="9" stroke-linejoin="round"/>
      <path d="M134 262 H426" fill="none" stroke="#${c.accent}" stroke-width="7" stroke-linecap="round"/>
      <path d="M70 432 H490 C470 462 410 472 280 472 C150 472 90 462 70 432 Z" fill="#${c.paper2}" stroke="#${c.ink}" stroke-width="9" stroke-linejoin="round"/>` },
    tree: { w: 480, h: 560, label: '햇볕을 받는 겨울나무', draw: (c) => `
      <circle cx="380" cy="110" r="104" fill="#${c.sun}" opacity="0.28"/><circle cx="380" cy="110" r="68" fill="#${c.sun}"/>
      <path d="M40 520 H440" fill="none" stroke="#${c.ink}" stroke-width="7" stroke-linecap="round"/>
      <path d="M240 520 V300" fill="none" stroke="#${c.ink}" stroke-width="16" stroke-linecap="round"/>
      <g fill="none" stroke="#${c.ink}" stroke-width="10" stroke-linecap="round">
        <path d="M240 390 C210 350 170 340 140 290"/><path d="M240 350 C280 310 320 300 350 245"/>
        <path d="M240 300 C230 250 210 220 195 170"/><path d="M240 300 C255 250 280 225 290 165"/></g>
      <g fill="none" stroke="#${c.ink}" stroke-width="7" stroke-linecap="round">
        <path d="M170 335 C150 330 130 335 108 320"/><path d="M315 292 C340 287 360 292 384 278"/>
        <path d="M212 222 C195 217 185 202 172 186"/><path d="M280 220 C300 210 312 195 318 178"/></g>
      <g fill="#${c.accent}"><circle cx="140" cy="288" r="9"/><circle cx="350" cy="243" r="9"/><circle cx="195" cy="168" r="9"/><circle cx="290" cy="163" r="9"/>
        <circle cx="106" cy="319" r="8"/><circle cx="386" cy="277" r="8"/><circle cx="171" cy="184" r="8"/><circle cx="319" cy="176" r="8"/></g>` },
    sprout: { w: 480, h: 520, label: '흙을 밀고 올라온 새싹', draw: (c) => `
      <circle cx="370" cy="112" r="98" fill="#${c.sun}" opacity="0.28"/><circle cx="370" cy="112" r="64" fill="#${c.sun}"/>
      <path d="M40 440 H440" fill="none" stroke="#${c.ink}" stroke-width="7" stroke-linecap="round"/>
      <path d="M150 440 C170 392 310 392 330 440 Z" fill="#${c.paper2}" stroke="#${c.ink}" stroke-width="7" stroke-linejoin="round"/>
      <path d="M240 404 C240 340 236 300 240 236" fill="none" stroke="#${c.ink}" stroke-width="10" stroke-linecap="round"/>
      <path d="M240 304 C190 304 150 272 140 216 C196 216 236 248 240 304 Z" fill="#${c.accentOnDark}" stroke="#${c.ink}" stroke-width="7" stroke-linejoin="round"/>
      <path d="M240 250 C282 246 326 216 336 160 C286 165 246 196 240 250 Z" fill="#${c.accentOnDark}" stroke="#${c.ink}" stroke-width="7" stroke-linejoin="round"/>` },
    path: { w: 520, h: 480, label: '언덕 너머 해를 향해 난 길', draw: (c) => `
      <circle cx="390" cy="120" r="94" fill="#${c.sun}" opacity="0.28"/><circle cx="390" cy="120" r="60" fill="#${c.sun}"/>
      <path d="M20 300 C110 235 200 285 280 255 C360 225 430 265 500 235 V450 H20 Z" fill="#${c.paper2}" stroke="#${c.ink}" stroke-width="7" stroke-linejoin="round"/>
      <path d="M130 450 C200 395 330 400 300 335 C284 300 330 282 372 262" fill="none" stroke="#${c.accent}" stroke-width="13" stroke-linecap="round"/>` },
  };
  const svgOf = (name, c) => {
    const m = MOTIFS[name] || MOTIFS.tea;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.w} ${m.h}" width="${m.w}" height="${m.h}">${m.draw(c)}</svg>`;
  };

  // ── AI에게 맡기는 것: 내용만(정해진 틀의 짧은 글) ──

  const SYSTEM = `당신은 심리 상담 결과를 상담사가 실제 면담에서 쓰는 10쪽 슬라이드로 옮기는 편집자입니다.
주어진 심리 분석 리포트에 있는 내용만 사용해 아래 JSON을 채우세요. 리포트에 없는 사실·수치·인용을 지어내지 마세요.

[글쓰기 규칙]
- 모든 값은 한국어 평문입니다. 마크다운(**, #)·이모지·영어 병기를 쓰지 마세요.
- 각 항목의 글자 수 한도(공백 포함)를 반드시 지키세요. 한도를 넘으면 화면에서 잘립니다.
- 따뜻하고 조심스러운 표현을 쓰세요. 타겟·전략·대응·공략 같은 전투적인 말은 쓰지 마세요.
- 대상자의 실명은 쓰지 말고 '대상자' 또는 리포트에 나온 호칭(멘티, 자매님 등)을 쓰세요.

[JSON 틀과 글자 수 한도]
{
 "theme": "calm | warm | fresh | clear 중 하나 (calm=소진되어 쉼이 필요, warm=상처·외로움으로 위로가 필요, fresh=도전·성장을 원함, clear=신중하고 이성적이며 신뢰가 중요)",
 "coverMotif": "tea | tree | sprout | path 중 하나 (tea=쉼과 대화, tree=기다림과 회복, sprout=새 출발과 성장, path=방향과 동행)",
 "wisdomMotif": "coverMotif와 다른 것 하나",
 "cover": { "line1": "표지 제목 첫 줄, 9자", "line2": "표지 제목 둘째 줄, 9자", "subtitle": "누구에게 건네는 어떤 만남인지, 36자" },
 "profile": { "typeCode": "하츠 유형 기호(예: H-A), 없으면 빈 문자열", "typeName": "하츠 유형 이름, 9자", "typeDesc": "유형 한 줄 설명, 44자",
   "traits": [ { "label": "특징 이름(예: ISTJ, 에니어그램 1번, 또는 리포트의 핵심 성향어), 8자", "value": "그 특징의 핵심, 6자" } ] (정확히 3개),
   "state": "지금 상태 한 문장, 28자" },
 "signal": { "statement": "대상자의 겉모습을 다시 읽어 주는 핵심 한 문장('~입니다'로 끝냄), 44자",
   "subtypes": [ { "name": "추천 세부 유형 이름, 8자", "desc": "한 줄 설명, 18자" } ] (정확히 3개) },
 "mechanism": { "steps": [ { "name": "심리 기제의 단계 이름, 8자", "desc": "쉬운 말 설명, 24자" } ] (정확히 3개, 원인→결과 순서),
   "conclusion": "그래서 지금 어떤 반응이 나오는지, 54자" },
 "zone": { "far": "지금은 과도한 도전의 예, 16자", "near": "도움이 있으면 닿을 수 있는 작은 걸음의 예, 16자", "now": "지금 가장 편안한 자리, 16자",
   "message": "무엇부터 설계할지 한 문장, 38자", "basis": "근거가 된 교육학 개념, 26자" },
 "steps": { "items": ["1단계, 12자", "2단계, 12자", "3단계, 12자", "4단계(대상자가 스스로 고르는 걸음), 12자"], "message": "단계를 밟는 원칙 한 문장, 30자" },
 "words": { "avoid": "피할 말 한마디, 15자", "avoidWhy": "그 말이 어떻게 들리는지, 38자", "say": "건넬 말(실제 대사), 52자", "sayWhy": "그 말의 핵심, 18자" },
 "wisdom": { "title": "지혜로운 나눔을 한마디로, 14자",
   "items": [ { "name": "실천 이름, 12자", "desc": "설명(고전 인용은 출처를 괄호로), 44자" } ] (정확히 3개: 몸 상태, 고전의 지혜, 자연의 섭리 순서) },
 "life": { "title": "생애 주기 상담을 한마디로, 14자",
   "people": [ { "name": "누구인지(예: 아버지, 딸, 대상자), 6자", "desc": "지금 삶의 시기, 30자" } ] (1개 또는 2개),
   "need": "지금 필요한 것, 58자", "message": "상담사가 전할 한 문장(대사), 40자" },
 "summary": { "line1": "코칭 요약 제목 첫 줄, 12자", "line2": "둘째 줄, 12자",
   "points": [ { "name": "지침 이름, 11자", "desc": "지침 설명, 30자" } ] (정확히 3개) },
 "notes": ["각 쪽에서 상담사가 말할 요점, 쪽마다 90자"] (정확히 10개, 위 쪽 순서: 표지, 한눈에 보기, 핵심 문장, 마음의 방식, 건넬 크기, 단계, 말 바꾸기, 지혜, 생애 주기, 요약)
}`;

  const SAFETY = ['HARASSMENT', 'HATE_SPEECH', 'SEXUALLY_EXPLICIT', 'DANGEROUS_CONTENT']
    .map((k) => ({ category: 'HARM_CATEGORY_' + k, threshold: 'BLOCK_NONE' }));

  async function askAi(ctx) {
    const prompt = `대상: ${ctx.targetGroup || '선택안함'}\n진행 단계: ${ctx.stage || '선택안함'}\n\n[심리 분석 리포트]\n${ctx.text}`;
    const payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      systemInstruction: { parts: [{ text: SYSTEM }] },
      generationConfig: { responseMimeType: 'application/json', temperature: 0.5 },
      safetySettings: SAFETY,
    };
    const res = await ctx.callApi({ action: 'generateContent', payload });
    if (res && res.error) throw new Error(typeof res.error === 'string' ? res.error : (res.error.message || 'AI 오류'));
    const parts = (res && res.candidates && res.candidates[0] && res.candidates[0].content && res.candidates[0].content.parts) || [];
    const raw = parts.filter((p) => p && typeof p.text === 'string' && !p.thought).map((p) => p.text).join('').trim();
    if (!raw) throw new Error('AI가 빈 답을 보냈어요. 잠시 후 다시 시도해주세요.');
    if (raw.startsWith('⚠️')) throw new Error(raw.replace(/^⚠️\s*/, ''));
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    try { return JSON.parse(raw.slice(a, b + 1)); }
    catch (e) { throw new Error('AI가 보낸 슬라이드 내용을 읽지 못했어요. 다시 만들어 주세요.'); }
  }

  // ── AI 답 다듬기: 빠진 것은 기본값, 긴 것은 자른다 ──

  const clean = (v) => String(v == null ? '' : v).replace(/\*\*|^#+\s*/g, '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').replace(/\s+/g, ' ').trim();
  const clip = (v, n, fallback) => {
    const s = clean(v) || (fallback || '');
    return s.length > n + 2 ? s.slice(0, n + 1).replace(/[\s,.·]+$/, '') + '…' : s;
  };
  const listOf = (v, n, make, blank) => {
    const arr = (Array.isArray(v) ? v : []).slice(0, n).map(make);
    while (arr.length < n) arr.push(blank(arr.length));
    return arr;
  };

  function normalize(d) {
    d = d || {};
    const o = (k) => (d[k] && typeof d[k] === 'object' ? d[k] : {});
    const theme = THEMES[d.theme] ? d.theme : 'calm';
    const coverMotif = MOTIFS[d.coverMotif] ? d.coverMotif : 'tea';
    let wisdomMotif = MOTIFS[d.wisdomMotif] ? d.wisdomMotif : 'tree';
    if (wisdomMotif === coverMotif) wisdomMotif = coverMotif === 'tree' ? 'sprout' : 'tree';
    const pair = (nName, nDesc) => (x) => ({ name: clip(x && x.name, nName, '-'), desc: clip(x && x.desc, nDesc) });
    const blankPair = () => ({ name: '-', desc: '' });
    const people = (Array.isArray(o('life').people) ? o('life').people : []).slice(0, 2).map(pair(6, 30));
    return {
      theme, coverMotif, wisdomMotif,
      cover: { line1: clip(o('cover').line1, 9, '맞춤 심리 코칭'), line2: clip(o('cover').line2, 9), subtitle: clip(o('cover').subtitle, 36) },
      profile: {
        typeCode: clip(o('profile').typeCode, 6), typeName: clip(o('profile').typeName, 11, '유형 추정'), typeDesc: clip(o('profile').typeDesc, 44),
        traits: listOf(o('profile').traits, 3, (x) => ({ label: clip(x && x.label, 8, '-'), value: clip(x && x.value, 6) }), () => ({ label: '-', value: '' })),
        state: clip(o('profile').state, 28),
      },
      signal: { statement: clip(o('signal').statement, 44), subtypes: listOf(o('signal').subtypes, 3, pair(8, 18), blankPair) },
      mechanism: { steps: listOf(o('mechanism').steps, 3, pair(8, 24), blankPair), conclusion: clip(o('mechanism').conclusion, 54) },
      zone: { far: clip(o('zone').far, 18), near: clip(o('zone').near, 18), now: clip(o('zone').now, 18), message: clip(o('zone').message, 38), basis: clip(o('zone').basis, 26) },
      steps: { items: listOf(o('steps').items, 4, (x) => clip(x, 12, '-'), () => '-'), message: clip(o('steps').message, 30) },
      words: { avoid: clip(o('words').avoid, 15), avoidWhy: clip(o('words').avoidWhy, 38), say: clip(o('words').say, 52), sayWhy: clip(o('words').sayWhy, 18) },
      wisdom: { title: clip(o('wisdom').title, 14, '지혜로운 나눔'), items: listOf(o('wisdom').items, 3, pair(12, 44), blankPair) },
      life: { title: clip(o('life').title, 14, '생애 주기에 맞춘 만남'), people: people.length ? people : [{ name: '대상자', desc: '' }], need: clip(o('life').need, 58), message: clip(o('life').message, 40) },
      summary: { line1: clip(o('summary').line1, 12, '코칭 요약'), line2: clip(o('summary').line2, 12), points: listOf(o('summary').points, 3, pair(11, 30), blankPair) },
      notes: listOf(d.notes, 10, (x) => clip(x, 110), () => ''),
    };
  }

  // ── 쪽 만들기: 인치 좌표의 도형(r)·글(t)·화살표(a)·그림(i) 목록 ──

  const quote = (s) => (s ? `“${s.replace(/^[“"']+|[”"']+$/g, '')}”` : '');

  function buildSlides(d) {
    const c = THEMES[d.theme];
    const r = (x, y, w, h, o) => Object.assign({ k: 'r', x, y, w, h }, o);
    const t = (x, y, w, h, text, o) => Object.assign({ k: 't', x, y, w, h, text, size: 22, color: c.ink, valign: 'top', align: 'left' }, o);
    const title = (text, color) => t(M, 0.72, CW, 0.95, text, { size: 40, bold: true, color: color || c.ink, valign: 'middle' });
    const foot = (label, n, dark) => [
      t(M, 6.86, 9.5, 0.32, label, { size: 12, color: dark ? c.onDarkSub : c.sub, valign: 'middle' }),
      t(W - M - 1.5, 6.86, 1.5, 0.32, String(n).padStart(2, '0'), { size: 12, color: dark ? c.onDarkSub : c.sub, align: 'right', valign: 'middle' }),
    ];
    const card = (x, y, w, h, o) => r(x, y, w, h, Object.assign({ fill: c.card, line: c.line, lw: 1, rad: 0.14 }, o));
    const slides = [];
    const add = (bg, els, label, dark) => { const n = slides.length + 1; slides.push({ bg, els: n === 1 ? els : els.concat(foot(label, n, dark)), note: d.notes[n - 1] || '' }); };

    // 1. 표지
    add(c.paper, [
      { k: 'i', x: 8.55, y: 1.85, w: 3.9, h: 3.7, motif: d.coverMotif },
      t(M, 0.85, 7.3, 0.5, '상담사용 · 대상자 맞춤 심리 코칭', { size: 22, bold: true, color: c.accent, valign: 'middle' }),
      t(M, 1.95, 7.5, 2.5, d.cover.line1 + (d.cover.line2 ? '\n' + d.cover.line2 : ''), { size: 56, bold: true, valign: 'middle', lh: 1.2 }),
      t(M, 4.65, 7.3, 1.2, d.cover.subtitle, { size: 26, color: c.sub }),
      t(M, 6.3, 7.3, 0.45, 'AI 심리 상담 · ' + today('.'), { size: 18, color: c.sub, valign: 'middle' }),
    ]);

    // 2. 대상자 한눈에 보기
    const rows = [];
    d.profile.traits.forEach((tr, i) => {
      const y = 1.95 + i * 1.1;
      rows.push(t(7.25, y, 3.35, 1.1, tr.label, { size: 28, bold: true, valign: 'middle' }));
      rows.push(t(10.6, y, 1.83, 1.1, tr.value, { size: 22, color: c.sub, align: 'right', valign: 'middle' }));
      if (i < 2) rows.push(r(7.25, y + 1.09, 5.18, 0.02, { fill: c.line }));
    });
    add(c.paper, [
      title('대상자 한눈에 보기'),
      card(M, 1.95, 5.95, 3.3),
      t(1.2, 2.15, 5.35, 0.5, '하츠 유형 추정' + (d.profile.typeCode ? ' · ' + d.profile.typeCode : ''), { size: 22, bold: true, color: c.accent, valign: 'middle' }),
      t(1.2, 2.7, 5.35, 0.95, d.profile.typeName, { size: d.profile.typeName.length > 9 ? 32 : 40, bold: true, valign: 'middle' }),
      t(1.2, 3.75, 5.35, 1.35, d.profile.typeDesc, { size: 22, color: c.sub }),
      ...rows,
      t(M, 5.5, CW, 1.0, d.profile.state, { size: 28, bold: true, valign: 'middle' }),
    ], '이해 · 유형은 AI 분석의 추정입니다. 진단이 아니라 가설로 다룹니다.');

    // 3. 핵심 문장 + 세부 유형
    const subW = (CW - 0.5) / 3;
    add(c.dark, [
      t(M, 0.85, CW, 2.75, d.signal.statement, { size: 44, bold: true, color: c.onDark, valign: 'middle', lh: 1.25 }),
      t(M, 3.75, CW, 0.5, '지금 어느 상태에 가까운지 먼저 살핍니다', { size: 22, color: c.onDarkSub, valign: 'middle' }),
      ...d.signal.subtypes.flatMap((s, i) => {
        const x = M + i * (subW + 0.25);
        return [
          r(x, 4.35, subW, 2.2, { fill: c.dark2, rad: 0.14 }),
          t(x + 0.25, 4.5, subW - 0.5, 0.65, s.name, { size: 26, bold: true, color: c.accentOnDark, valign: 'middle' }),
          t(x + 0.25, 5.2, subW - 0.5, 1.2, s.desc, { size: 22, color: c.onDark }),
        ];
      }),
    ], '이해 · 추천 세부 유형', true);

    // 4. 마음이 움직이는 방식
    const bw = 3.35, aw = 0.45, ag = 0.12;
    add(c.paper, [
      title('마음이 움직이는 방식'),
      ...d.mechanism.steps.flatMap((s, i) => {
        const x = M + i * (bw + aw + ag * 2);
        const els = [
          card(x, 1.95, bw, 2.45),
          t(x + 0.25, 2.1, bw - 0.5, 0.65, s.name, { size: 26, bold: true, color: c.accent, valign: 'middle' }),
          t(x + 0.25, 2.8, bw - 0.5, 1.5, s.desc, { size: 22 }),
        ];
        if (i < 2) els.push({ k: 'a', x: x + bw + ag, y: 3.0, w: aw, h: 0.34, fill: c.accent });
        return els;
      }),
      t(M, 4.65, CW, 1.75, d.mechanism.conclusion, { size: 28, bold: true, valign: 'middle', lh: 1.3 }),
    ], '이해 · 겉으로 보이는 반응 아래의 마음');

    // 5. 지금 건넬 수 있는 크기
    add(c.paper, [
      title('지금 건넬 수 있는 크기'),
      r(M, 1.9, 6.7, 4.7, { fill: c.paper2, line: c.sub, lw: 1.5, dash: true, rad: 0.2 }),
      t(1.15, 2.0, 6.2, 0.5, '아직은 과도한 도전', { size: 24, bold: true, color: c.sub, valign: 'middle' }),
      t(1.15, 2.5, 6.2, 0.45, d.zone.far, { size: 22, color: c.sub, valign: 'middle' }),
      r(1.15, 3.05, 6.2, 3.3, { fill: c.warm, line: c.accent, lw: 2.5, rad: 0.18 }),
      t(1.4, 3.15, 5.7, 0.5, '지금 닿을 수 있는 영역', { size: 24, bold: true, color: c.accentDeep, valign: 'middle' }),
      t(1.4, 3.65, 5.7, 0.45, d.zone.near, { size: 22, valign: 'middle' }),
      card(1.4, 4.25, 5.7, 1.9),
      t(1.65, 4.42, 5.2, 0.5, '지금의 안전지대', { size: 24, bold: true, valign: 'middle' }),
      t(1.65, 4.95, 5.2, 0.45, d.zone.now, { size: 22, color: c.sub, valign: 'middle' }),
      t(8.0, 2.2, 4.43, 2.9, d.zone.message, { size: 28, bold: true, valign: 'middle', lh: 1.3 }),
      t(8.0, 5.25, 4.43, 1.1, d.zone.basis, { size: 20, color: c.sub }),
    ], '설계 · 안에서 밖으로 읽습니다');

    // 6. 한 계단씩 놓는 받침대
    const sw = 2.7, sg = (CW - sw * 4) / 3, base = 5.55;
    const tones = [c.paper2, c.t2, c.t3, c.dark];
    add(c.paper, [
      title('한 계단씩 놓는 받침대'),
      ...d.steps.items.flatMap((s, i) => {
        const h = 1.55 + i * 0.62, x = M + i * (sw + sg), y = base - h, last = i === 3;
        return [
          r(x, y, sw, h, { fill: tones[i], rad: 0.12 }),
          t(x + 0.22, y + 0.15, sw - 0.44, 0.42, (i + 1) + '단계', { size: 20, bold: true, color: last ? c.accentOnDark : c.accentDeep, valign: 'middle' }),
          t(x + 0.22, y + 0.6, sw - 0.44, 0.9, s, { size: 24, bold: true, color: last ? c.onDark : c.ink, lh: 1.2 }),
        ];
      }),
      t(M, 5.75, CW, 0.9, d.steps.message, { size: 26, bold: true, valign: 'middle' }),
    ], '설계 · 다음 계단은 대상자가 고릅니다');

    // 7. 말 바꾸기
    add(c.paper, [
      title('말 바꾸기'),
      r(M, 1.95, 4.7, 4.6, { fill: c.paper2, rad: 0.14 }),
      t(1.2, 2.15, 4.1, 0.5, '피할 말', { size: 22, bold: true, color: c.sub, valign: 'middle' }),
      t(1.2, 2.75, 4.1, 1.55, quote(d.words.avoid), { size: 32, bold: true, color: c.sub, strike: true, valign: 'middle', lh: 1.25 }),
      t(1.2, 4.45, 4.1, 1.9, d.words.avoidWhy, { size: 22, color: c.sub }),
      card(5.85, 1.95, 6.58, 4.6, { line: c.accent, lw: 2.5 }),
      t(6.15, 2.15, 5.98, 0.5, '건넬 말', { size: 22, bold: true, color: c.accent, valign: 'middle' }),
      t(6.15, 2.75, 5.98, 2.65, quote(d.words.say), { size: 28, bold: true, valign: 'middle', lh: 1.35 }),
      t(6.15, 5.55, 5.98, 0.8, d.words.sayWhy, { size: 22, color: c.sub, valign: 'middle' }),
    ], '실행 · 문턱을 낮추는 말');

    // 8. 지혜로운 나눔
    add(c.paper, [
      title(d.wisdom.title),
      { k: 'i', x: M, y: 1.95, w: 3.6, h: 4.4, motif: d.wisdomMotif },
      ...d.wisdom.items.flatMap((s, i) => {
        const y = 1.95 + i * 1.55;
        return [
          t(4.9, y, 7.53, 0.55, s.name, { size: 26, bold: true, color: c.accent, valign: 'middle' }),
          t(4.9, y + 0.58, 7.53, 0.9, s.desc, { size: 22 }),
        ];
      }),
    ], '실행 · 몸, 고전의 지혜, 자연의 섭리');

    // 9. 생애 주기
    const pn = d.life.people.length, pw = (CW - 0.25 * (pn - 1)) / pn;
    add(c.paper, [
      title(d.life.title),
      ...d.life.people.flatMap((p, i) => {
        const x = M + i * (pw + 0.25);
        return [
          card(x, 1.95, pw, 1.8),
          t(x + 0.3, 2.08, pw - 0.6, 0.65, p.name, { size: 30, bold: true, color: c.accent, valign: 'middle' }),
          t(x + 0.3, 2.78, pw - 0.6, 0.85, p.desc, { size: 22 }),
        ];
      }),
      t(M, 3.95, CW, 1.15, d.life.need, { size: 24, color: c.sub, valign: 'middle', lh: 1.3 }),
      t(M, 5.2, CW, 1.4, quote(d.life.message), { size: 30, bold: true, valign: 'middle', lh: 1.3 }),
    ], '실행 · 생애 주기 상담');

    // 10. 코칭 요약
    add(c.dark, [
      t(M, 0.8, CW, 2.4, [{ text: d.summary.line1, color: c.onDark }, ...(d.summary.line2 ? [{ text: '\n' + d.summary.line2, color: c.accentOnDark }] : [])],
        { size: 48, bold: true, color: c.onDark, valign: 'middle', lh: 1.25 }),
      ...d.summary.points.flatMap((p, i) => {
        const y = 3.4 + i * 1.1;
        return [
          r(M, y, CW, 0.02, { fill: c.darkLine }),
          t(M, y + 0.03, 5.0, 1.07, p.name, { size: 26, bold: true, color: c.accentOnDark, valign: 'middle' }),
          t(6.1, y + 0.03, 6.33, 1.07, p.desc, { size: 24, color: c.onDark, valign: 'middle' }),
        ];
      }),
    ], '실행 · 코칭 요약', true);
    slides[9].note = (slides[9].note ? slides[9].note + ' ' : '') + '식사나 수면이 무너지거나 깊은 무기력·우울이 보이면, 코칭으로 붙들지 말고 정신건강 전문 기관으로 연계합니다.';
    return slides;
  }

  function today(sep) {
    const n = new Date(), p = (v) => String(v).padStart(2, '0');
    return [n.getFullYear(), p(n.getMonth() + 1), p(n.getDate())].join(sep);
  }

  // ── 화면에 그리기 ──

  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const runsOf = (text) => (Array.isArray(text) ? text : [{ text }]);
  const px = (inch) => (inch * PX).toFixed(1) + 'px';

  function slideHtml(s, theme) {
    const c = THEMES[theme];
    const box = (e) => `left:${px(e.x)};top:${px(e.y)};width:${px(e.w)};height:${px(e.h)};`;
    const body = s.els.map((e) => {
      if (e.k === 'r') {
        return `<div style="position:absolute;box-sizing:border-box;${box(e)}background:#${e.fill};${e.line ? `border:${(e.lw || 1) * 1.33}px ${e.dash ? 'dashed' : 'solid'} #${e.line};` : ''}border-radius:${px(e.rad || 0)}"></div>`;
      }
      if (e.k === 'a') {
        return `<svg style="position:absolute;${box(e)}" viewBox="0 0 100 76" preserveAspectRatio="none"><path d="M0 19 H50 V0 L100 38 L50 76 V57 H0 Z" fill="#${e.fill}"/></svg>`;
      }
      if (e.k === 'i') {
        return `<div style="position:absolute;${box(e)}display:flex;align-items:center;justify-content:center" role="img" aria-label="${esc(MOTIFS[e.motif].label)}">${svgOf(e.motif, c).replace('<svg ', '<svg style="max-width:100%;max-height:100%;width:auto;height:100%" ')}</div>`;
      }
      const jc = e.valign === 'middle' ? 'center' : e.valign === 'bottom' ? 'flex-end' : 'flex-start';
      const inner = runsOf(e.text).map((u) => `<span style="${u.color ? `color:#${u.color};` : ''}">${esc(u.text)}</span>`).join('');
      return `<div style="position:absolute;${box(e)}display:flex;flex-direction:column;justify-content:${jc};overflow:hidden"><div style="font-size:${(e.size * PX / 72).toFixed(1)}px;line-height:${e.lh || 1.3};font-weight:${e.bold ? 700 : 400};color:#${e.color};text-align:${e.align};white-space:pre-line;word-break:keep-all;overflow-wrap:anywhere;${e.strike ? 'text-decoration:line-through;' : ''}">${inner}</div></div>`;
    }).join('');
    return `<div class="cs-slide" style="width:${W * PX}px;height:${H * PX}px;background:#${s.bg};font-family:${CSS_FONT}">${body}</div>`;
  }

  // ── PPT로 내려받기 ──

  const loaded = {};
  const loadScript = (src) => loaded[src] || (loaded[src] = new Promise((ok, fail) => {
    const el = document.createElement('script'); el.src = src;
    el.onload = ok; el.onerror = () => { delete loaded[src]; fail(new Error('PPT 도구를 불러오지 못했어요. 인터넷 연결을 확인해주세요.')); };
    document.head.appendChild(el);
  }));

  const svgToPng = (svg, w, h) => new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = w * 2; cv.height = h * 2;
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      ok(cv.toDataURL('image/png'));
    };
    img.onerror = () => fail(new Error('그림을 만들지 못했어요.'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });

  /** pptx 객체에 쪽을 채운다. images = { 그림이름: PNG data URL }. */
  function fillPptx(pptx, slides, images) {
    pptx.layout = 'LAYOUT_WIDE';
    slides.forEach((s) => {
      const sl = pptx.addSlide();
      sl.background = { color: s.bg };
      s.els.forEach((e) => {
        if (e.k === 'r') {
          sl.addShape(e.rad ? pptx.ShapeType.roundRect : pptx.ShapeType.rect, {
            x: e.x, y: e.y, w: e.w, h: e.h, fill: { color: e.fill },
            line: e.line ? { color: e.line, width: e.lw || 1, dashType: e.dash ? 'dash' : 'solid' } : { type: 'none' },
            rectRadius: e.rad ? Math.min(e.rad, Math.min(e.w, e.h) / 2) : undefined,
          });
        } else if (e.k === 'a') {
          sl.addShape(pptx.ShapeType.rightArrow, { x: e.x, y: e.y, w: e.w, h: e.h, fill: { color: e.fill }, line: { type: 'none' } });
        } else if (e.k === 'i') {
          const m = MOTIFS[e.motif], k = Math.min(e.w / m.w, e.h / m.h), w = m.w * k, h = m.h * k;
          if (images[e.motif]) sl.addImage({ data: images[e.motif], x: e.x + (e.w - w) / 2, y: e.y + (e.h - h) / 2, w, h, altText: m.label });
        } else {
          const runs = runsOf(e.text).map((u) => ({ text: u.text, options: u.color ? { color: u.color } : {} }));
          sl.addText(runs, {
            x: e.x, y: e.y, w: e.w, h: e.h, margin: 0, fontFace: FONT, lang: 'ko-KR', fontSize: e.size, bold: !!e.bold, color: e.color,
            align: e.align, valign: e.valign === 'middle' ? 'middle' : e.valign, strike: e.strike ? 'sngStrike' : undefined,
            lineSpacingMultiple: (e.lh || 1.3) / 1.2, fit: 'shrink', wrap: true,
          });
        }
      });
      if (s.note) sl.addNotes(s.note);
    });
  }

  async function download(deck) {
    await loadScript('vendor/pptxgen.bundle.js');
    const c = THEMES[deck.data.theme], images = {};
    for (const name of [deck.data.coverMotif, deck.data.wisdomMotif]) {
      const m = MOTIFS[name];
      images[name] = await svgToPng(svgOf(name, c), m.w, m.h);
    }
    const pptx = new window.PptxGenJS();
    pptx.title = '대상자 맞춤 심리 코칭';
    fillPptx(pptx, deck.slides, images);
    const blob = await fixWrap(await pptx.write({ outputType: 'arraybuffer' }), window.JSZip, 'blob');
    const a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = `코칭슬라이드_${today('')}.pptx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  /** 파워포인트가 한글을 낱말 중간에서 끊지 않게 한다: 글의 언어가 ko-KR이고 문단에 latinLnBrk="0"이 있어야 한다(PptxGenJS에는 뒤의 설정이 없다). */
  async function fixWrap(buffer, JSZip, type) {
    const zip = await JSZip.loadAsync(buffer);
    for (const name of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
      const xml = await zip.file(name).async('string');
      zip.file(name, xml.replace(/<a:pPr(?![^>]*latinLnBrk)/g, '<a:pPr latinLnBrk="0"'));
    }
    return zip.generateAsync({ type, mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', compression: 'DEFLATE' });
  }

  // ── 미리 보기 창 ──

  const CSS = `
  .cs-ov{position:fixed;inset:0;z-index:10050;background:rgba(18,22,20,.94);display:flex;flex-direction:column;color:#fff;font-family:${CSS_FONT}}
  .cs-top{display:flex;align-items:center;gap:10px;padding:10px 14px;flex:none}
  .cs-top b{font-size:15px}.cs-top .cs-pg{font-size:13px;opacity:.75;margin-left:auto}
  .cs-x{width:36px;height:36px;border:0;border-radius:50%;background:rgba(255,255,255,.14);color:#fff;font-size:18px;cursor:pointer}
  .cs-mid{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:0 12px;overflow:hidden}
  .cs-frame{position:relative;overflow:hidden;border-radius:8px;box-shadow:0 10px 40px rgba(0,0,0,.45);flex:none;background:#fff}
  .cs-slide{position:absolute;left:0;top:0;transform-origin:0 0;overflow:hidden}
  .cs-note{width:100%;max-width:900px;max-height:96px;overflow:auto;font-size:13px;line-height:1.55;background:rgba(255,255,255,.08);border-radius:10px;padding:9px 12px;box-sizing:border-box;flex:none}
  .cs-note i{font-style:normal;font-weight:700;opacity:.7;margin-right:6px}
  .cs-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;padding:10px 12px calc(12px + env(safe-area-inset-bottom,0px));flex:none}
  .cs-btn{height:44px;padding:0 16px;border-radius:12px;border:1px solid rgba(255,255,255,.3);background:transparent;color:#fff;font-size:14px;font-weight:700;cursor:pointer}
  .cs-btn:disabled{opacity:.4;cursor:default}
  .cs-btn.main{background:#00AE82;border-color:#00AE82}
  .cs-wait{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:24px;font-size:14px;line-height:1.7}
  .cs-spin{width:38px;height:38px;border-radius:50%;border:4px solid rgba(255,255,255,.25);border-top-color:#00AE82;animation:cs-r .9s linear infinite}
  @keyframes cs-r{to{transform:rotate(360deg)}}`;

  const cache = new Map();   // 분석 글 → 만든 슬라이드(같은 결과는 AI를 다시 부르지 않는다)
  let ov = null, state = null;

  function close() {
    if (!ov) return;
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', fit);
    ov.remove(); ov = null; state = null;
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1);
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1);
  }
  function go(step) {
    if (!state || !state.deck) return;
    const n = state.page + step;
    if (n < 0 || n >= state.deck.slides.length) return;
    state.page = n; renderDeck();
  }
  function fit() {
    if (!ov) return;
    const frame = ov.querySelector('.cs-frame'), mid = ov.querySelector('.cs-mid'), note = ov.querySelector('.cs-note');
    if (!frame || !mid) return;
    const availW = mid.clientWidth - 24, availH = mid.clientHeight - (note ? note.offsetHeight + 10 : 0);
    const k = Math.max(0.1, Math.min(availW / (W * PX), availH / (H * PX)));
    frame.style.width = (W * PX * k) + 'px'; frame.style.height = (H * PX * k) + 'px';
    frame.querySelector('.cs-slide').style.transform = `scale(${k})`;
  }

  function shell(inner, pageText) {
    ov.innerHTML = `<div class="cs-top"><b>코칭 슬라이드</b><span class="cs-pg">${pageText || ''}</span><button type="button" class="cs-x" aria-label="닫기">✕</button></div>${inner}`;
    ov.querySelector('.cs-x').onclick = close;
  }
  function renderWait() {
    shell(`<div class="cs-wait"><div class="cs-spin"></div><div>심리 상담 결과를 10쪽 슬라이드로 옮기는 중이에요.<br>보통 20~40초쯤 걸립니다.</div></div>`);
  }
  function renderError(msg) {
    shell(`<div class="cs-wait"><div>슬라이드를 만들지 못했어요.<br>${esc(msg)}</div><button type="button" class="cs-btn main" data-a="retry">다시 만들기</button></div>`);
    ov.querySelector('[data-a=retry]').onclick = () => make(true);
  }
  function renderDeck() {
    const { deck, page } = state, s = deck.slides[page], total = deck.slides.length;
    shell(`
      <div class="cs-mid">
        <div class="cs-frame">${slideHtml(s, deck.data.theme)}</div>
        ${s.note ? `<div class="cs-note"><i>상담사 메모</i>${esc(s.note)}</div>` : ''}
      </div>
      <div class="cs-bar">
        <button type="button" class="cs-btn" data-a="prev" ${page === 0 ? 'disabled' : ''}>◀ 이전</button>
        <button type="button" class="cs-btn" data-a="next" ${page === total - 1 ? 'disabled' : ''}>다음 ▶</button>
        <button type="button" class="cs-btn" data-a="redo">다시 만들기</button>
        <button type="button" class="cs-btn main" data-a="down" ${state.saving ? 'disabled' : ''}>${state.saving ? 'PPT 만드는 중…' : 'PPT 내려받기'}</button>
      </div>`, `${page + 1} / ${total}`);
    ov.querySelector('[data-a=prev]').onclick = () => go(-1);
    ov.querySelector('[data-a=next]').onclick = () => go(1);
    ov.querySelector('[data-a=redo]').onclick = () => { if (confirm('AI가 슬라이드를 처음부터 다시 만듭니다. 계속할까요?')) make(true); };
    ov.querySelector('[data-a=down]').onclick = async () => {
      state.saving = true; renderDeck();
      try { await download(deck); } catch (e) { alert(e.message || 'PPT를 만들지 못했어요.'); }
      if (state) { state.saving = false; renderDeck(); }
    };
    const frame = ov.querySelector('.cs-frame');
    let x0 = null;
    frame.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    frame.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    });
    frame.onclick = (e) => { const b = frame.getBoundingClientRect(); go(e.clientX - b.left > b.width / 2 ? 1 : -1); };
    fit();
  }

  async function make(force) {
    const ctx = state.ctx;
    if (!force && cache.has(ctx.text)) { state.deck = cache.get(ctx.text); state.page = 0; renderDeck(); return; }
    renderWait();
    try {
      const data = normalize(await askAi(ctx));
      const deck = { data, slides: buildSlides(data) };
      cache.set(ctx.text, deck);
      if (!state || state.ctx !== ctx) return;   // 그 사이 창을 닫았다
      state.deck = deck; state.page = 0; renderDeck();
    } catch (e) {
      if (state && state.ctx === ctx) renderError(e.message || String(e));
    }
  }

  /** ctx = { text: 심리 분석 글, targetGroup, stage, callApi } */
  function open(ctx) {
    close();
    if (!document.getElementById('cs-css')) {
      const st = document.createElement('style'); st.id = 'cs-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    ov = document.createElement('div'); ov.className = 'cs-ov';
    document.body.appendChild(ov);
    state = { ctx, deck: null, page: 0, saving: false };
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', fit);
    make(false);
  }

  window.CoachSlides = { open, close, _test: { normalize, buildSlides, slideHtml, fillPptx, fixWrap, svgToPng, svgOf, THEMES, MOTIFS } };
})();
