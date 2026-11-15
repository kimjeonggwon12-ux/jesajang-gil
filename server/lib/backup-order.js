// 기존 서버와 새 후보가 같은 정렬 규칙으로 페이지를 읽는다.
// 새 표를 추가할 때 실제 고유 키와 함께 백업/복원 검사에 포함한다.
const ORDER_KEYS = Object.freeze({
  teachers: ['member_id'], app_visits: ['nid'], cohort_tg_chats: ['chat_id'], report_rooms: ['dept'],
  member_pins: ['nid'], member_registration_contacts: ['nid'], pin_enrollment_attempts: ['nid'], pin_recovery_challenges: ['nid'],
  edu_roster_policy: ['roster_key'], edu_delivery_log: ['delivery_key'], site_pilot_members: ['nid'],
  telegram_update_receipts: ['update_id', 'bot_key'],
});

export function backupTableQuery(client, table) {
  let query = client.from(table).select('*');
  for (const key of ORDER_KEYS[table] || ['id']) query = query.order(key);
  return query;
}
