-- 방 안의 최신/이전/증분 페이지를 ID 순서로 찾는다. 기존 인덱스는 다른 조회를 위해 유지한다.
create index if not exists chat_messages_chat_id_idx on public.chat_messages(chat_id,id);
