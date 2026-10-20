// Gemini 호출. 실패해도 예외 대신 안내 문구가 든 응답을 돌려준다(화면이 그대로 보여 준다).

const DEFAULT_MODEL = 'gemini-3-flash-preview';
const FALLBACK = '⚠️ AI 응답을 받아오지 못했습니다. 잠시 후 다시 시도해주세요.';

async function callOnce(payload, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model || DEFAULT_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return await r.json();
  } catch (e) {
    return { error: { message: String(e.message || e) } };
  }
}

/** 붐빌 때(503)는 1초 쉬고 두 번 더 해 본다. */
async function callWithRetry(payload, model) {
  let result;
  for (let attempt = 1; attempt <= 3; attempt++) {
    result = await callOnce(payload, model);
    if (result?.error?.code !== 503) return result;
    if (attempt < 3) await new Promise((ok) => setTimeout(ok, 1000));
  }
  return result;
}

function friendlyError(result) {
  const code = result?.error?.code;
  const msg = result?.error?.message || '';
  if (code === 503 || code === 529 || /UNAVAILABLE|overloaded|high demand/i.test(msg)) {
    return '⚠️ AI가 지금 많이 몰려서 응답이 지연되고 있어요. 자동으로 3번 다시 시도했지만 계속 실패했습니다 — 잠시 후 다시 시도해주세요.';
  }
  return FALLBACK + (msg ? ` (${msg})` : '');
}

export const textOf = (result) => result?.candidates?.[0]?.content?.parts?.[0]?.text;

/** Gemini 응답 모양 그대로. 실패하면 같은 모양에 안내 문구를 담는다. */
export async function callAi(payload, model) {
  const result = await callWithRetry(payload, model);
  if (typeof textOf(result) === 'string') return result;
  return { candidates: [{ content: { parts: [{ text: friendlyError(result) }] } }] };
}

/** 글 한 덩이를 보내고 답 글만 받는다. */
export async function askAi(prompt) {
  const result = await callAi({ contents: [{ role: 'user', parts: [{ text: prompt }] }] });
  return textOf(result) ?? FALLBACK;
}

/**
 * 모델을 차례로 써 본다 — 붐빔(503)·하루 한도(429)면 다음 모델로. 다 안 되면 안내 문구.
 * 2026-10-20: 무료 등급 gemini-3-flash-preview(AI상담 기본)는 하루 20회라, 다른 기능은 다른 모델을 앞에 둔다.
 */
export async function askAiModels(prompt, models) {
  let result;
  for (const model of models) {
    result = await callWithRetry({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }, model);
    const text = textOf(result);
    if (typeof text === 'string') return text;
    const code = result?.error?.code;
    if (code !== 429 && code !== 503 && code !== 404) break;
  }
  if (result?.error?.code === 429) return '⚠️ 오늘 AI 사용 한도를 다 썼어요. 내일 다시 시도해 주세요.';
  return friendlyError(result);
}
