// 텔레그램 발송. 알림 실패가 본 기능을 막지 않도록 오류는 삼킨다.

async function send(token, chatId, text) {
  if (!token || !chatId) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** 활동 등록 알림 채널(옛 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID). */
export const notifyActivityChannel = (text) =>
  send(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID, text);
