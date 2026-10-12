// 교재(공부방 단원)
import { db, selectAll } from '../lib/db.js';

// 카테고리 칸이 비어 있으면 교재번호 앞머리로 정한다.
const CATEGORY_BY_PREFIX = { G1: '복음방', G2: '상담', G3: '복음방', G4: '밭갈기' };

async function getCourseList(body) {
  const data = await selectAll(() => db().from('courses').select('*').neq('course_id', '').order('id'));
  const rows = data.map((c) => ({
    courseId: c.course_id, courseName: c.course_name, unitName: c.unit_name, order: Number(c.sort_no),
    content: c.content, minutes: Number(c.minutes),
    category: c.category || CATEGORY_BY_PREFIX[c.course_id.split('-')[0]] || '',
    stageHint: c.stage_hint,
  })).filter((c) => !body.category || c.category === body.category);
  return { rows };
}

export default { getCourseList };
