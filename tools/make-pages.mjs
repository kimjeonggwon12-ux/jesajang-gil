// 옛 주소(GitHub Pages, main 브랜치)의 화면들을 한꺼번에 바꿔 쓴다.
//   node tools/make-pages.mjs maintenance <main 작업 폴더>   "업데이트 작업 중" 안내 화면으로
//   node tools/make-pages.mjs redirect    <main 작업 폴더>   새 주소의 같은 화면으로 자동 이동
// 폴더 안의 *.html 을 모두 같은 내용으로 덮어쓴다(아이콘·manifest·서비스워커는 그대로 둔다).
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const NEW_SITE = 'https://jesajang-gil.vercel.app/';
const [mode, dir] = process.argv.slice(2);
if (!['maintenance', 'redirect'].includes(mode) || !dir) { console.error('사용법: node tools/make-pages.mjs maintenance|redirect <폴더>'); process.exit(1); }

const shell = (title, head, body) => `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Cache-Control" content="no-cache">
<title>${title}</title>
${head}
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;background:#EEE9E0;font-family:-apple-system,BlinkMacSystemFont,"Malgun Gothic","Apple SD Gothic Neo",sans-serif;color:#1f2a26}
  .box{max-width:420px;margin:24px;padding:32px 26px;background:#fff;border-radius:20px;box-shadow:0 10px 30px rgba(0,0,0,.08);text-align:center;line-height:1.6}
  h1{font-size:20px;margin:0 0 12px;color:#00875f}
  p{margin:8px 0;font-size:15px}
  small{color:#6b7772}
  a{color:#00875f;font-weight:700}
</style>
</head>
<body>
<div class="box">
${body}
</div>
</body>
</html>
`;

// 안내 화면: 1분마다 새로 확인한다 — 작업이 끝나 이 파일이 "자동 이동"으로 바뀌면 열어 둔 화면도 알아서 넘어간다.
const maintenance = shell('교사광장 — 업데이트 작업 중', `<script>setTimeout(function () { location.reload(); }, 60000);</script>`, `  <h1>🔧 시스템 업데이트 작업 중입니다</h1>
  <p>더 빠르고 안정적인 교사광장을 위해<br>시스템 개선 작업을 하고 있습니다.</p>
  <p><b>작업 시간은 1시간 정도</b> 예상됩니다.</p>
  <p><small>작업이 끝나면 이 화면이 자동으로 새 교사광장으로 넘어갑니다.<br>이용에 불편을 드려 죄송합니다.</small></p>`);

// 자동 이동: 같은 이름의 화면으로, 주소 뒤(?…#…)를 그대로 가져간다(출석 QR 의 #attend=… 포함).
// app.html 로 갈 때는 이 기기에 저장된 로그인(이름·고유번호)을 주소 맨 뒤 #carry= 에 실어 보낸다 —
// # 뒤는 서버로 전송되지 않고, 새 앱이 저장한 즉시 주소에서 지운다.
const redirect = shell('교사광장', `<script>
(function () {
  var NEW_SITE = '${NEW_SITE}';
  var page = location.pathname.split('/').pop() || 'app.html';
  var hash = location.hash || '';
  var carry = '';
  if (page === 'app.html') {
    try {
      var saved = JSON.parse(localStorage.getItem('podo_member') || 'null');
      var o = {};
      if (saved && saved.memberId && saved.name) { o.memberId = saved.memberId; o.name = saved.name; }
      if (localStorage.getItem('podo_owner') === '1') o.owner = 1;
      if ((window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true) o.app = 1;
      if (Object.keys(o).length) {
        var bin = '';
        new TextEncoder().encode(JSON.stringify(o)).forEach(function (b) { bin += String.fromCharCode(b); });
        carry = 'carry=' + btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
      }
    } catch (e) {}
  }
  var tail = hash ? hash + (carry ? '&' + carry : '') : (carry ? '#' + carry : '');
  window.__next = NEW_SITE + page + location.search + tail;
  location.replace(window.__next);
})();
</script>`, `  <h1>교사광장 주소가 바뀌었습니다</h1>
  <p>새 주소로 이동하고 있습니다…</p>
  <p><a id="go" href="${NEW_SITE}app.html">자동으로 넘어가지 않으면 여기를 눌러 주세요</a></p>
  <script>if (window.__next) document.getElementById('go').href = window.__next;</script>`);

const files = readdirSync(dir).filter((f) => f.endsWith('.html'));
for (const f of files) writeFileSync(join(dir, f), mode === 'maintenance' ? maintenance : redirect);
console.log(`${mode}: ${files.length}개 화면을 바꿨습니다 — ${files.join(', ')}`);
