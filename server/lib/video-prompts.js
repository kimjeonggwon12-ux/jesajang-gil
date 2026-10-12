// 영상 녹취·요약·자료 패키지의 AI 지시문과 결과 나누기.
// ⚠️ 이 파일은 tools/extract-video-prompts.mjs 가 옛 VideoBackend.gs 에서 그대로 뽑아 만든다 — 직접 고치지 말 것.
/* eslint-disable */

var VT_SEG_SEC = 600;      // 한 구간 10분 — gemini-3.5-flash는 5분 영상(녹취+서머리)에 약 195초 걸려서, 요청 6분 제한 안에 들게 10분으로

var VT_MAX_SEGS = 18;      // 최대 3시간

var VT_MODELS = ['gemini-3.5-flash', 'gemini-3.8-flash'];

var VT_SPLIT = '=====서머리=====';   // 10분 이하 영상은 녹취+서머리를 한 번에 받고 이 줄로 나눔

var VT_PKG = [['lesson', '교안'], ['share', '나눔질문'], ['quiz', '퀴즈'], ['outreach', '전도문구']];

var VT_AUTO_SKIP = /음악|ASMR|BGM|playlist|플레이리스트/i;

function _vtFmt_(sec) {
  sec = Math.max(0, Math.round(sec));
  var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return (h ? h + ':' + p(m) : p(m)) + ':' + p(s);
}

var VT_SUMMARY_FORMAT = [
  '## 한눈에 보기',
  '(영상 전체를 3문장 이내로)',
  '## 핵심 메시지',
  '- (가장 중요한 메시지 3~5개, 한 줄씩)',
  '## 흐름별 요약',
  '### [mm:ss] 소제목',
  '(영상의 흐름을 따라 부분마다 2~4문장. 녹취의 소제목·시간을 활용)',
  '## 핵심 성경 구절',
  '- (언급된 구절과 그 구절로 말한 요지. 없으면 이 부분을 빼세요)',
  '## 교사로서 적용할 점',
  '- (복음방·상담·전도 현장에서 바로 써먹을 점 2~4개)',
  '(영상에 없는 내용은 지어내지 마세요)'
].join('\n');

var VT_PKG_FORMAT = {
  lesson: [
    '[교안 — 이 영상으로 복음방·소그룹에서 30분 정도 가르칠 때 쓰는 수업 진행안]',
    '## 학습 목표',
    '- (이 시간이 끝나면 배우는 사람이 알게 될 것 2~3개)',
    '## 도입 (5분)',
    '- 마음 여는 질문 1~2개와, 영상 내용으로 자연스럽게 넘어가는 연결 멘트',
    '## 본론 (20분)',
    '### 1. 소제목 [mm:ss]',
    '(영상 흐름 순서대로 2~4개 단락. 단락마다: 핵심 내용 설명, 근거 성경 구절(장:절과 본문 요지), "> 교사 팁: ..." 한 줄)',
    '## 정리 (3분)',
    '- 오늘 배운 핵심 3줄',
    '## 적용과 다음 만남 (2분)',
    '- 삶에 적용할 점 1~2개, 다음 만남에 이어서 다룰 주제 한 줄'
  ].join('\n'),
  share: [
    '[나눔 질문 — 영상을 함께 본 뒤 대상자와 나눌 질문]',
    '## 마음 열기',
    '- 질문 1~2개',
    '## 내용 확인',
    '- 질문 2개',
    '## 깊이 생각하기',
    '- 질문 2개',
    '## 삶에 적용',
    '- 질문 1~2개',
    '(질문마다 바로 아래 줄에 "> 도움말: 교사가 대화를 이끌 때 참고할 답의 방향·관련 구절" 한 줄. 쉬운 질문에서 깊은 질문 순서로)'
  ].join('\n'),
  quiz: [
    '[확인 퀴즈 — 영상 내용 이해를 확인하는 문제. 영상에서 실제로 말한 내용만으로 출제]',
    '## OX 문제',
    '### 1. (문제)',
    '- 정답: O 또는 X',
    '- 해설: (한두 문장, 영상의 [mm:ss] 표시)',
    '(OX 3문제)',
    '## 객관식 문제',
    '### 4. (문제)',
    '- ① 보기',
    '- ② 보기',
    '- ③ 보기',
    '- ④ 보기',
    '- 정답: (번호)',
    '- 해설: (한두 문장)',
    '(객관식 3문제, 번호는 OX에 이어서 4~6)'
  ].join('\n'),
  outreach: [
    '[카톡 전도 문구 — 대상자에게 영상 링크와 함께 보낼 짧은 소개 멘트]',
    '### 1. 처음 연락할 때',
    '### 2. 신앙이 있는 분께',
    '### 3. 고민·어려움이 있는 분께',
    '(각 소제목 아래 2~4문장, 부담 없고 따뜻한 말투, 이모지 1~2개, 강요·종교 단체명 언급 없이 영상 내용이 궁금해지게. 링크 자리는 [영상 링크]라고만 쓰세요)'
  ].join('\n')
};

function _vtTranscribePrompt_(title, segIdx, segs, startSec, endSec, prevTail, withSummary) {
  // segs=0 → 길이를 모르는 '열린 구간'(10분씩 보내며 AI가 끝을 알려 줌)
  var open = segs === 0;
  var range = open ? '이 영상의 ' + _vtFmt_(startSec) + ' ~ ' + _vtFmt_(endSec) + ' 구간'
    : segs > 1 ? '이 영상의 ' + _vtFmt_(startSec) + ' ~ ' + _vtFmt_(endSec) + ' 구간(전체 ' + segs + '구간 중 ' + (segIdx + 1) + '번째)' : '이 영상 전체';
  return [
    '당신은 교회 교사 교육 영상을 문서로 옮기는 전문 녹취사입니다.',
    '영상 제목: ' + title,
    range + '을 녹취하세요.',
    '',
    '[녹취 규칙]',
    '1. 말한 내용을 빠짐없이 옮기세요. 요약하거나 건너뛰지 마세요.',
    '2. "어, 음, 그~" 같은 군말과 같은 말의 단순 반복만 정리하고, 말투와 표현은 살려 읽기 좋은 문장으로 다듬으세요.',
    '3. 영상의 흐름과 맥락을 따라, 이야기 주제가 바뀔 때마다 "## [mm:ss] 소제목" 줄로 나누세요. 시간은 영상 전체 기준이고, 소제목은 그 부분 내용을 한눈에 알 수 있게 짧게 쓰세요.',
    '4. 문단은 의미 단위로 3~6문장씩 나누세요.',
    '5. 말하는 사람이 둘 이상이면 문단 앞에 "**강사:**", "**질문자:**"처럼 구분하고, 한 사람이면 표시하지 마세요.',
    '6. 성경 구절을 말하면 (계 1:3)처럼 책 약칭과 장:절을 괄호로 붙이세요. 화면에 띄운 중요한 글·자료는 "> 화면: ..." 줄로 남기세요.',
    '7. 잘 들리지 않는 곳은 [불명확]으로 표시하고 지어내지 마세요. 말 없이 음악만 나오면 "[음악]"이라고만 쓰세요.',
    segs > 1 || (open && segIdx > 0) ? '8. 구간 시작·끝에서 문장이 잘리면, 시작은 그 문장 처음부터 자연스럽게, 끝은 그 문장을 마무리하는 데까지만 쓰세요.' : '',
    open ? '9. 영상이 이 구간 안에서 끝나면 녹취 본문의 맨 마지막 줄에 [[영상끝]] 이라고 쓰세요. 영상이 ' + _vtFmt_(endSec) + ' 뒤로도 이어지면 쓰지 마세요. 이 구간에 영상 내용이 아예 없으면(이미 끝났으면) [[영상끝]] 한 줄만 쓰세요.' : '',
    prevTail ? '\n[바로 앞 구간 녹취의 끝부분 — 흐름을 이어받기 위한 참고용이며 다시 쓰지 마세요]\n' + prevTail : '',
    '',
    withSummary
      ? '녹취 본문을 다 쓴 다음 새 줄에 "' + VT_SPLIT + '" 한 줄만 쓰고, 그 아래에 이 영상을 보지 못한 교사가 핵심을 바로 알 수 있는 서머리를 아래 [서머리 형식]대로 쓰세요. 그 밖의 머리말·설명·맺음말은 쓰지 마세요.\n\n[서머리 형식 — 마크다운, 이 순서 그대로]\n' + VT_SUMMARY_FORMAT
      : '녹취 본문만 출력하세요(머리말·설명·맺음말 없이).'
  ].filter(function (x) { return x !== ''; }).join('\n');
}

function _vtSummaryPrompt_(title, transcript) {
  return [
    '아래는 교회 교사 교육 영상 "' + title + '"의 녹취 전문입니다. 이 영상을 보지 못한 교사가 읽고 핵심을 바로 알 수 있도록 서머리를 쓰세요.',
    '',
    '[형식 — 마크다운, 이 순서 그대로]',
    VT_SUMMARY_FORMAT,
    '',
    '서머리 본문만 출력하세요.',
    '',
    '[녹취 전문]',
    transcript
  ].join('\n');
}

function _vtPkgPrompt_(title, summary, transcript, keys) {
  var lines = [
    '아래는 교회 교사 교육 영상 "' + title + '"의 서머리와 녹취 전문입니다. 교사가 이 영상으로 바로 쓸 수 있는 자료를 만드세요.',
    '각 자료는 정확히 "=====이름=====" 구분 줄 한 줄로 시작하고, 그 아래에 형식대로 마크다운으로 쓰세요. 구분 줄 말고 다른 머리말·맺음말은 쓰지 마세요.',
    '영상과 녹취에 없는 내용은 지어내지 마세요. 성경 구절은 녹취에 나온 것을 쓰세요.',
    ''
  ];
  lines.push('(아래 각 형식의 [대괄호 안내 줄]과 괄호 설명은 쓰는 방법 안내이니 출력하지 마세요)', '');
  keys.forEach(function (p) { lines.push('=====' + p[1] + '=====', VT_PKG_FORMAT[p[0]], ''); });
  lines.push('[서머리]', summary, '', '[녹취 전문]', transcript);
  return lines.join('\n');
}

function _vtPkgParse_(text) {
  var out = {}, re = /^=====\s*(교안|나눔질문|나눔 질문|퀴즈|전도문구|전도 문구)\s*=====\s*$/gm, m, marks = [];
  while ((m = re.exec(text))) marks.push({ name: m[1].replace(/\s/g, ''), start: m.index, body: m.index + m[0].length });
  marks.forEach(function (mk, i) {
    var body = text.slice(mk.body, i + 1 < marks.length ? marks[i + 1].start : text.length).trim();
    var key = (VT_PKG.filter(function (p) { return p[1] === mk.name; })[0] || [])[0];
    body = body.replace(/^\[[^\]\n]*—[^\]\n]*\]\s*\n/, '').trim();   // AI가 형식 안내 줄([교안 — ...])을 따라 쓴 경우 지움
    if (key && body) out[key] = body;
  });
  return out;
}

export {
  VT_SEG_SEC as SEGMENT_SECONDS, VT_MAX_SEGS as MAX_SEGMENTS, VT_MODELS as MODELS, VT_SPLIT as SUMMARY_SPLIT,
  VT_PKG as PACKAGE_PARTS, VT_AUTO_SKIP as AUTO_SKIP,
  _vtTranscribePrompt_ as transcribePrompt, _vtSummaryPrompt_ as summaryPrompt,
  _vtPkgPrompt_ as packagePrompt, _vtPkgParse_ as parsePackage,
};
