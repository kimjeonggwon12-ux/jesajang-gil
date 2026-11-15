// 기존 화면의 표시 규칙만 재사용한다. HTML 실행 코드/인증/업무 로직은 가져오지 않는다.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import postcss from '../next-app/node_modules/postcss/lib/postcss.mjs';
const root=new URL('../',import.meta.url);
const html=await readFile(new URL('app.html',root),'utf8');
const head=html.slice(0,html.indexOf('</head>'));
// 원본 주석의 와일드카드 뒤 '/'가 주석을 조기 종료하는 부분은 파싱 사본에서만 보정한다.
const css=[...head.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n').replace('--radius-*/--shadow-card','--radius-/--shadow-card').replace('.act-feed-*/.act-fab','.act-feed- / .act-fab').replace('.role-*/.radio-row','.role- / .radio-row').replace('.avatar*/','.avatar /');
const dynamicRoomCss=html.match(/function trCss\(\)[\s\S]*?st\.textContent = `([\s\S]*?)`;/)?.[1];
if(!dynamicRoomCss||dynamicRoomCss.includes('${'))throw Error('피드백방의 고정 표시 CSS만 허용합니다.');
const source=postcss.parse(css+'\n'+dynamicRoomCss),output=postcss.root();
const allowed=/(?:\.(?:dk-[\w-]+|pz-gnb|hdr-[\w-]+|room-ic|room-name|lucide-i|l2|er-[\w-]+|gl-[\w-]+|ms-[\w-]+|ei-[\w-]+|pzm-[\w-]+|edu-roster-box|ctc[\w-]*|act-[\w-]+|rp-[\w-]+|tg-note|tr-[\w-]+|fbh[\w-]*|fbf-[\w-]+|cn-[\w-]+|pz-[\w-]+|cal-[\w-]+|tb-[\w-]+|kko-[\w-]+|l3|adm-[\w-]+|study-tab-btn)|#(?:bottomTabBar|actTabs|sec-activity|sec-calendar|sec-connect|sec-ai|sec-textbook|sec-admin|admin-subtabs))\b/;
const vars=postcss.rule({selector:'.classic-ui'});source.walkRules(':root',rule=>{rule.walkDecls(d=>{if(d.prop.startsWith('--'))vars.append(d.clone());});});output.append(vars);
source.walkRules(rule=>{
 if(rule.parent?.type==='atrule'&&/keyframes/.test(rule.parent.name))return;
 const selectors=rule.selectors.filter(s=>allowed.test(s));
 if(!selectors.length)return;
 for(const selector of selectors){
  const desktop=selector.includes('html.pz-dk'),mobile=selector.includes('html:not(.pz-dk)');
  let normalized=selector.replace(/html\.pz-dk(?::not\([^)]*\))?/g,'.classic-ui').replace(/html:not\(\.pz-dk\)/g,'.classic-ui');
  if(!normalized.startsWith('.classic-ui'))normalized='.classic-ui '+normalized;
  let copy=rule.clone({selector:normalized});
  const ancestors=[];for(let p=rule.parent;p&&p.type!=='root';p=p.parent)if(p.type==='atrule')ancestors.push(p);
  if(desktop||mobile)copy=postcss.atRule({name:'media',params:desktop?'(min-width: 1024px)':'(max-width: 1023px)'}).append(copy);
  for(const a of ancestors)copy=postcss.atRule({name:a.name,params:a.params}).append(copy);
  output.append(copy);
 }
});
output.walkComments(c=>c.remove());
await writeFile(new URL('next-app/app/classic-extracted.css',root),'/* app.html에서 추출한 표시 전용 CSS. tools/extract-classic-presentation.mjs로 갱신. */\n'+output.toString()+'\n');
const nav=html.slice(html.indexOf('<nav id="bottomTabBar"'),html.indexOf('</nav>',html.indexOf('<nav id="bottomTabBar"')));
const icons={};
for(const match of nav.matchAll(/<button\b[^>]*data-tab="([^"]+)"[\s\S]*?<svg\b[^>]*>([\s\S]*?)<\/svg>/g)){
 const body=match[2].replace(/<!--[\s\S]*?-->/g,'').trim();
 if(/<script|on\w+=|href=|url\(/i.test(body))throw Error('표시 아이콘 이외의 내용은 허용하지 않습니다.');
 icons[match[1]]=body;
}
if(Object.keys(icons).length!==8)throw Error('기존 메뉴 8개를 확인해야 합니다.');
await mkdir(new URL('next-app/components/presentation/',root),{recursive:true});
await writeFile(new URL('next-app/components/presentation/classic-icons.json',root),JSON.stringify(icons,null,2)+'\n');
// 기존 공개 문의처만 그대로 사용한다. 명단·등록 연락처를 조회하지 않는다.
const contactBlock=html.match(/const CTC_PARTS = \{([\s\S]*?)\n\s*\};/);
if(!contactBlock)throw Error('기존 공개 문의처 표를 확인해야 합니다.');
const contacts={};
for(const m of contactBlock[1].matchAll(/(\w+):\s*\{\s*name:\s*'([^']*)',\s*phone:\s*'([^']*)'\s*\}/g))contacts[m[1]]={name:m[2],phone:m[3]};
if(Object.keys(contacts).length!==8)throw Error('기존 공개 문의처 8개를 확인해야 합니다.');
await writeFile(new URL('next-app/components/presentation/classic-contacts.json',root),JSON.stringify(contacts,null,2)+'\n');
console.log(JSON.stringify({sourceSha256:createHash('sha256').update(html).digest('hex'),rules:output.nodes.length,icons:Object.keys(icons)}));
