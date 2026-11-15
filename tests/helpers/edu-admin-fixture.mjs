import {seedEduReport,ER} from './edu-report-fixture.mjs';import {sql,ids} from './local-db.mjs';
export {ER};
export function seedEduAdmin(bulk=false){seedEduReport(bulk);sql(`truncate edu_roster_changes restart identity;update education_delegations set permissions='{members,settings,reports}' where nid='${ids.admin}' and scope_id='${ER.series}';`);}
