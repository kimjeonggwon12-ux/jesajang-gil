-- 2026-11-10(사용자): 섭외자 대화방에 PPT·한글 문서·PDF 첨부 — 파일은 R2(room-files/), 표엔 주소·이름·크기만.
alter table target_room_messages add column if not exists file_url  text   not null default '';
alter table target_room_messages add column if not exists file_name text   not null default '';
alter table target_room_messages add column if not exists file_size bigint not null default 0;
