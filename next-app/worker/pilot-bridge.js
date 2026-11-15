// 동일 출처의 기존 로그인 표를 HttpOnly 화면 선택 쿠키에 연결한다.
// 쿠키는 API 인증을 대신하지 않으며 A/B 표시·별도 접속 주소를 만들지 않는다.
(()=>{
 if(window.__teacherPilotBridge)return;window.__teacherPilotBridge=true;
 const script=document.currentScript||document.querySelector('script[src="/pilot-bridge.js"]');
 const site=script?.dataset.site||'B',common=['/admin/pilot','/admin/reports','/account','/device','/attend'].includes(location.pathname);
 let busy=false,again=false,enabled=false,last=0,dirty=false,lastToken='';
 const token=()=>{try{return localStorage.getItem('pd_tk_v1')||'';}catch{return '';}};
 const release=()=>{document.documentElement.removeAttribute('data-pilot-pending');document.getElementById('pilot-entry-error')?.remove();};
 const fail=()=>{release();const show=()=>{if(document.getElementById('pilot-entry-error'))return;const p=document.createElement('div');p.id='pilot-entry-error';p.setAttribute('role','alert');p.style.cssText='position:fixed;inset:0;z-index:2147483647;background:white;padding:24px;color:#222';p.textContent='접속 정보를 확인하지 못했어요. ';const b=document.createElement('button');b.textContent='다시 확인';b.onclick=()=>void sync();p.append(b);document.body.append(p);};document.body?show():document.addEventListener('DOMContentLoaded',show,{once:true});};
 async function sync(){
  if(busy){again=true;return;}busy=true;const current=token();if(current!==lastToken){dirty=false;lastToken=current;}
  try{
   const response=await fetch('/api/pilot-session',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:current})});
   if(current!==token()){again=true;return;}
   if(response.status===401){for(const k of ['pd_tk_v1','podo_member','podo_pin'])localStorage.removeItem(k);location.reload();return;}
   if(!response.ok)throw Error('entry');
   const data=await response.json();enabled=data.enabled===true;last=Date.now();
   if(enabled&&!common&&data.site!==site&&data.site!=='common'){
    if(dirty){release();const go=confirm('접속 설정이 바뀌었어요. 작성 중인 내용을 저장하지 않고 화면을 다시 열까요?');if(!go)return;}
    location.reload();return;
   }
   if(enabled&&site==='A'&&data.site==='common'){location.reload();return;}
   if(enabled&&site==='A'&&data.canManage){const add=()=>{if(document.getElementById('pilot-manager-link'))return;const a=document.createElement('a');a.id='pilot-manager-link';a.href='/admin/pilot';a.textContent='사이트 운영';a.style.cssText='position:fixed;right:12px;bottom:90px;z-index:9999;background:white;padding:10px;border:1px solid #ccc;border-radius:8px';document.body.append(a);};document.body?add():document.addEventListener('DOMContentLoaded',add,{once:true});}
   release();
  }catch{fail();}finally{busy=false;if(again){again=false;void sync();}}
 }
 const style=document.createElement('style');style.textContent='html[data-pilot-pending] body{visibility:hidden}';document.head.append(style);
 document.documentElement.setAttribute('data-pilot-pending','');
 document.addEventListener('input',()=>{if(token())dirty=true;},true);
 window.addEventListener('storage',e=>{if(e.key==='pd_tk_v1'||e.key===null)void sync();});
 window.addEventListener('ts-session-change',()=>void sync());
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-last>5000)void sync();});
 window.addEventListener('focus',()=>{if(Date.now()-last>5000)void sync();});
 // 화면 전환마다 서버에서 최신 배정을 확인한다. 쓰기 요청 자동 재시도는 하지 않는다.
 document.addEventListener('click',event=>{if(!enabled||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;const a=event.target.closest?.('a[href]');if(!a||a.target||a.hasAttribute('download'))return;const u=new URL(a.href,location.href);if(u.origin!==location.origin||u.pathname===location.pathname&&u.search===location.search)return;event.preventDefault();event.stopImmediatePropagation();location.assign(u.href);},true);
 void sync();
})();
