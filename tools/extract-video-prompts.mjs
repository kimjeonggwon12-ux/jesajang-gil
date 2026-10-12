// 옛 VideoBackend.gs 에서 녹취·요약·자료 패키지의 지시문과 파싱 함수를 글자 그대로 뽑아
// server/lib/video-prompts.js 를 만든다(지시문이 한 글자라도 달라지면 결과물이 달라지므로 손으로 옮기지 않는다).
//   node tools/extract-video-prompts.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../backend-source/VideoBackend.gs', import.meta.url), 'utf8').split(/\r?\n/);

/** name 으로 시작하는 선언(var … = / function …)을 끝까지 잘라 온다. */
function block(startPattern) {
  const start = src.findIndex((l) => startPattern.test(l));
  if (start === -1) throw new Error('못 찾음: ' + startPattern);
  if (/;\s*(\/\/.*)?$/.test(src[start]) && !/[\[{(]\s*(\/\/.*)?$/.test(src[start])) return src[start];
  let end = start;
  while (!/^(\}|\]|\};|\]\.join\('\\n'\);|\}\);?)\s*(\/\/.*)?$/.test(src[end]) || end === start) end++;
  return src.slice(start, end + 1).join('\n');
}

const parts = [
  block(/^var VT_SEG_SEC\b/), block(/^var VT_MAX_SEGS\b/), block(/^var VT_MODELS\b/), block(/^var VT_SPLIT\b/),
  block(/^var VT_PKG\b/), block(/^var VT_AUTO_SKIP\b/),
  block(/^function _vtFmt_\(/), block(/^var VT_SUMMARY_FORMAT\b/), block(/^var VT_PKG_FORMAT\b/),
  block(/^function _vtTranscribePrompt_\(/), block(/^function _vtSummaryPrompt_\(/),
  block(/^function _vtPkgPrompt_\(/), block(/^function _vtPkgParse_\(/),
];

writeFileSync(new URL('../server/lib/video-prompts.js', import.meta.url), `// 영상 녹취·요약·자료 패키지의 AI 지시문과 결과 나누기.
// ⚠️ 이 파일은 tools/extract-video-prompts.mjs 가 옛 VideoBackend.gs 에서 그대로 뽑아 만든다 — 직접 고치지 말 것.
/* eslint-disable */

${parts.join('\n\n')}

export {
  VT_SEG_SEC as SEGMENT_SECONDS, VT_MAX_SEGS as MAX_SEGMENTS, VT_MODELS as MODELS, VT_SPLIT as SUMMARY_SPLIT,
  VT_PKG as PACKAGE_PARTS, VT_AUTO_SKIP as AUTO_SKIP,
  _vtTranscribePrompt_ as transcribePrompt, _vtSummaryPrompt_ as summaryPrompt,
  _vtPkgPrompt_ as packagePrompt, _vtPkgParse_ as parsePackage,
};
`);
console.log('server/lib/video-prompts.js 생성');
