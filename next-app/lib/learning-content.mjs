// 기존 교재·영상의 순수 표시/검색/문서 계약. 원문 app.html과 비교 검사한다.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const TBX_BOOKS = '창|출|레|민|신|수|삿|룻|삼상|삼하|왕상|왕하|대상|대하|스|느|에|욥|시|잠|전|아|사|렘|애|겔|단|호|욜|암|옵|욘|미|나|합|습|학|슥|말|마|막|눅|요|행|롬|고전|고후|갈|엡|빌|골|살전|살후|딤전|딤후|딛|몬|히|약|벧전|벧후|요일|요이|요삼|유|계';
const TBX_REF = new RegExp('^(?:' + TBX_BOOKS + ')\\s*\\d+:\\d+(?:\\s*[~-]\\s*\\d+(?::\\d+)?)?(?:\\s*,\\s*\\d+(?:[~-]\\d+)?)*');
const tbxIsStruct = l => /^(●|○\s|\||[⚫•▪■◆◇▶※]|\d+\.\s|\d+\)\s?|[가-하]\.\s|제목\s*:)/.test(l) || TBX_REF.test(l);
const tbxEnds = l => /[.?!…~。」』"'”’)\]:;]$/.test(l) || /(다|요|죠|까|니다|세요|어요|아요|네요|지요|잖아|거든)[.?!~]*$/.test(l) && l.length < 38;
function tbxJoin(text) {
  // 줄 단위로 보고, 앞줄이 길고 끝맺음이 없으며 다음 줄이 새 덩어리가 아니면 잇는다(빈 줄 하나를 사이에 둔 경우도)
  const raw = String(text || '').replace(/[​-‍﻿]/g, '').replace(/\r/g, '').split('\n').map(l => l.replace(/\s+$/, ''));
  const out = [];
  // 낱말 가운데서 끊긴 줄(사/람에게)은 붙이고, 낱말 사이에서 끊긴 줄은 띄운다 — 이어 붙인 글자가 본문의 한 줄 안에 있으면 한 낱말로 본다
  const glue = (a, b) => {
    const ta = (a.match(/[가-힣]+$/) || [''])[0], hb = (b.match(/^[가-힣]+/) || [''])[0];
    if (!ta || !hb) return a + ' ' + b;
    const key = ta.slice(-2) + hb.slice(0, 2);
    return raw.some(l => l.includes(key)) ? a + b : a + ' ' + b;
  };
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i].trim();
    const prev = out.length ? out[out.length - 1] : null;
    if (!cur) { if (prev !== '') out.push(''); continue; }
    let joinTo = -1;
    const headLike = p => /^(\||●|제목\s*:)/.test(p) || (/^\d+[.)]\s/.test(p) && p.length < 48);   // 짧은 번호 줄은 제목 — 다음 줄을 붙이지 않음
    if (prev && !tbxEnds(prev) && prev.length >= 30 && !tbxIsStruct(cur) && !headLike(prev)) joinTo = out.length - 1;
    else if (prev === '' && out.length >= 2) { const p2 = out[out.length - 2]; if (p2 && !tbxEnds(p2) && p2.length >= 30 && !tbxIsStruct(cur) && !/^[●|]/.test(p2) && /[가-힣]$/.test(p2)) { out.pop(); joinTo = out.length - 1; } }
    if (joinTo >= 0) out[joinTo] = glue(out[joinTo], cur); else out.push(cur);
  }
  return out;
}
function tsTerms(q) { return String(q || '').toLowerCase().split(/\s+/).filter(Boolean); }
function tsMatch(text, terms) {
  const h = String(text || '').toLowerCase().replace(/\s+/g, '');
  return terms.every(t => h.includes(t));
}
// 찾은 낱말을 노란 칠로 — 원문을 쪼개서 조각마다 esc 하므로 안전
function tsHi(text, terms) {
  const s = String(text || '');
  if (!terms.length) return esc(s);
  const re = new RegExp('(' + terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  return s.split(re).map((p, i) => i % 2 ? `<mark class="ts-hit">${esc(p)}</mark>` : esc(p)).join('');
}
// 본문에서 처음 걸린 곳 앞뒤로 잘라 미리보기
function tsSnippet(text, terms) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  const low = s.toLowerCase();
  let at = -1;
  terms.forEach(t => { const i = low.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; });
  if (at < 0) return '';
  const a = Math.max(0, at - 30), b = Math.min(s.length, at + 70);
  return (a ? '…' : '') + tsHi(s.slice(a, b), terms) + (b < s.length ? '…' : '');
}
    function vdIdFrom(s) {
      s = String(s || '').trim();
      if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
      const m = s.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/|\/v\/)([A-Za-z0-9_-]{11})/);
      return m ? m[1] : '';
    }
    const vdDate = d => String(d || '').replace(/-/g, '.');
    // 2026-10-06: 한 영상이 여러 파트에 같이 들어갈 수 있음(서버가 '소양,상담'으로 줌)
    const vdParts = v => String((v && v.part) || '').split(',').filter(Boolean);
    const vdNorm = t => String(t || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
    function vdSimilarTitle(a, b) {
      const nums = t => (String(t || '').match(/\d+/g) || []).join(',');
      if (nums(a) !== nums(b)) return false;
      a = vdNorm(a); b = vdNorm(b);
      if (a.length < 4 || b.length < 4) return false;
      if (a === b) return true;
      const s = a.length < b.length ? a : b, l = s === a ? b : a;
      if (s.length >= 8 && l.includes(s)) return true;
      const bg = x => { const m = {}; for (let i = 0; i < x.length - 1; i++) { const k = x.substr(i, 2); m[k] = (m[k] || 0) + 1; } return m; };
      const A = bg(a), B = bg(b); let hit = 0;
      for (const k in A) hit += Math.min(A[k], B[k] || 0);
      return 2 * hit / (a.length - 1 + b.length - 1) >= 0.72;
    }
    function vtText(v, r, key) {
      const t = key === 'summary' ? r.summary : key === 'transcript' ? r.transcript : ((r.pkg || {})[key] || '');
      return String(t || '').replace(/^\[[^\]\n]*—[^\]\n]*\]\s*\n/, '').replace(/\[영상 ?링크\]/g, 'https://youtu.be/' + v.videoId).trim();
    }
    function vtMsgs(text) {
      const out = [];
      String(text || '').split('\n').forEach(line => {
        const m = line.trim().match(/^#{2,4}\s+(.*)$/);
        if (m) out.push({ title: m[1].replace(/\*\*/g, ''), body: '' });
        else if (out.length) out[out.length - 1].body += line.replace(/\*\*(.+?)\*\*/g, '$1') + '\n';
      });
      out.forEach(m => { m.body = m.body.trim(); });
      return out.filter(m => m.body);
    }
    const VT_ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ', 'Ⅴ', 'Ⅵ', 'Ⅶ', 'Ⅷ', 'Ⅸ', 'Ⅹ', 'Ⅺ', 'Ⅻ'];
    function vtLesson(v, r, kind) {
      const secs = VT_TABS.filter(t => kind === 'all' || t[0] === kind).map(t => [t[2], vtText(v, r, t[0])]).filter(x => x[1]);
      const meta = `${vdParts(v).join(' · ')} · ${vdDate(v.uploadDate)} · https://youtu.be/${v.videoId}`;
      const F = "font-family:'맑은 고딕','Malgun Gothic',sans-serif;";
      const hi = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      const pl = s => String(s).replace(/\*\*(.+?)\*\*/g, '$1');
      let html = `<div style="${F}font-size:11pt;line-height:1.7;color:#111;">
        <p style="margin:0 0 4px;font-size:18pt;font-weight:bold;">${esc(v.title)}</p>
        <p style="margin:0 0 14px;font-size:9.5pt;color:#666;">${esc(meta)}</p>`;
      const plain = [`📖 ${v.title}`, meta];
      secs.forEach(([label, text]) => {
        html += `<p style="margin:18px 0 8px;padding-bottom:4px;font-size:15pt;font-weight:bold;border-bottom:2px solid #00AE82;">${esc(label)}</p>`;
        plain.push('', `【 ${label} 】`);
        let big = 0, sub = 0, list = false;
        const para = x => { const last = plain[plain.length - 1]; if (last !== '' && last !== '──────────' && !/^▶ /.test(last)) plain.push(''); plain.push(x); };   // 문단 사이 빈 줄
        const endList = () => { if (list) { html += '</ul>'; list = false; } };
        String(text || '').split('\n').forEach(line => {
          const t = line.trim();
          if (/^[-*] /.test(t)) {
            if (!list) { html += '<ul style="margin:0 0 10px;padding-left:22px;">'; list = true; }
            html += `<li style="margin:2px 0;">${hi(t.slice(2))}</li>`; plain.push(`• ${pl(t.slice(2))}`); return;
          }
          endList();
          if (!t || /^-{3,}$/.test(t)) return;
          const m = t.match(/^(#{1,4})\s+(.*)$/);
          if (m && m[1].length <= 2) {
            const no = (VT_ROMAN[big] || big + 1) + '.'; big++; sub = 0;
            html += `<p style="margin:18px 0 6px;font-size:13.5pt;font-weight:bold;color:#00936E;">${no} ${hi(m[2])}</p>`;
            plain.push('', `${no} ${pl(m[2])}`, '──────────'); return;
          }
          if (m && m[1].length === 3) {
            sub++;
            const no3 = /^\d+[.)]\s/.test(m[2]) ? '' : sub + '. ';   // 퀴즈처럼 이미 번호가 있으면 그대로
            html += `<p style="margin:12px 0 4px;font-size:12pt;font-weight:bold;">${no3}${hi(m[2])}</p>`;
            plain.push('', `▶ ${no3}${pl(m[2])}`); return;
          }
          if (m) { html += `<p style="margin:8px 0 4px;font-weight:bold;">· ${hi(m[2])}</p>`; plain.push(`· ${pl(m[2])}`); return; }
          if (t.startsWith('>')) {
            const q = t.replace(/^>\s?/, '');
            html += `<p style="margin:0 0 10px;padding:4px 10px;border-left:3px solid #00AE82;background:#F3FBF8;color:#444;">${hi(q)}</p>`;
            para(`※ ${pl(q)}`); return;
          }
          html += `<p style="margin:0 0 10px;">${hi(t)}</p>`; para(pl(t));
        });
        endList();
      });
      html += '</div>';
      return { html, plain: plain.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
    }

const COURSE_TABS=[{key:'teacherQuality',category:'교사소양',label:'소양'},{key:'counseling',category:'상담',label:'상담'},{key:'batgal',category:'밭갈기',label:'밭갈기'},{key:'noFaith',category:'무신앙',label:'무신앙'},{key:'gospelRoom',category:'복음방',label:'복음방'}];
const VIDEO_PARTS=['소양','상담','밭갈기','무신앙','복음방'];
const LC_PARTS=[...VIDEO_PARTS,'우수복음방교육'];
const VT_TABS=[['summary','요약'],['transcript','녹취 전문'],['lesson','교안'],['share','나눔 질문'],['quiz','확인 퀴즈'],['outreach','카톡 전도 문구']].map(([k,t])=>[k,t,t]);
const VT_AUTO_SKIP=/음악|ASMR|BGM|playlist|플레이리스트/i;
export {esc,TBX_BOOKS,TBX_REF,tbxJoin,tsTerms,tsMatch,tsHi,tsSnippet,vdNorm,vdSimilarTitle,vdIdFrom,vdDate,vdParts,vtText,vtMsgs,vtLesson,COURSE_TABS,VIDEO_PARTS,LC_PARTS,VT_TABS,VT_AUTO_SKIP};
