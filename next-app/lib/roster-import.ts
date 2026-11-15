export type ImportRow={memberId:string;name:string;dept:string;region:string;note:string;tier:string;regLeads?:number;unregLeads?:number;counsel?:number;gospelRoom?:number;companion?:number;activeState?:string;format?:string;monthStats?:Record<string,string|number>};
export type ParsedRoster={rows:ImportRow[];problems:string[]};
export type ImportPerson={memberId:string;name:string;dept:string;region:string;position?:string;adminPosition?:string;tier?:string;from?:string;to?:string;excelName?:string;apply?:boolean};
export type ImportList={count:number;rows:ImportPerson[]};
export type ImportPreview={before:number;after:number;excelRows:number;applyTiers:boolean;added:ImportList;removed:ImportList;kept:ImportList;moved:ImportList;renamed:ImportList;tierChanges:ImportList;tierTotals:Record<string,number>;review:string};
export type ImportChoice={applyTiers:boolean;keepIds:string[];renameIds:string[]};
export function defaultKeepIds(preview:ImportPreview){return [...preview.removed.rows,...preview.kept.rows].filter(p=>p.position||p.adminPosition).map(p=>p.memberId);}
export function toggleId(ids:string[],id:string,checked:boolean){return checked?[...new Set([...ids,id])]:ids.filter(value=>value!==id);}
