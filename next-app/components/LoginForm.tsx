'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import Link from 'next/link';
import {LOGIN_DEPTS} from '../../shared/login-options.js';
import {callApi} from '../lib/api';
import {saveSession,type Session} from '../lib/session';

import {takeEntry} from '../lib/entry-handoff';

type Mode='login'|'register'|'recover';
type LoginResult={ok?:boolean;token?:string;name?:string;pinVer?:string};
const labels:Record<Mode,string>={login:'입장하기',register:'PIN 등록하고 입장',recover:'PIN 복구하고 입장'};
export default function LoginForm({onLogin,initialMessage=''}:{onLogin:(session:Session)=>void;initialMessage?:string}) {
  const [mode,setMode]=useState<Mode>('login'),[message,setMessage]=useState(initialMessage),[busy,setBusy]=useState(false);
  const pending=useRef(false),form=useRef<HTMLFormElement>(null);
  useEffect(()=>{const hint=takeEntry('hints');if(!hint)return;for(const [key,value]of Object.entries(hint)){const field=form.current?.elements.namedItem(key);if(field instanceof HTMLInputElement||field instanceof HTMLSelectElement)field.value=value;}},[]);
  function choose(next:Mode) {
    setMode(next);setMessage('');
    for(const name of ['pin','confirmPin','code']){const input=form.current?.elements.namedItem(name);if(input instanceof HTMLInputElement)input.value='';}
  }
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(pending.current)return;
    const data=new FormData(event.currentTarget),field=(name:string)=>String(data.get(name)||'').trim();
    const memberId=field('memberId'),name=field('name'),dept=field('dept'),pin=field('pin');
    if(mode!=='login' && (pin!==field('confirmPin')||!/^\d{6}$/.test(pin))){setMessage('새 PIN은 같은 숫자 6자리로 두 번 입력해 주세요.');return;}
    pending.current=true;setBusy(true);setMessage('');
    try {
      const r=await callApi<LoginResult>(mode==='register'?'registerPin':mode==='recover'?'recoverPin':'verifyLogin',{
        memberId,name,dept,pin,...(mode==='register'?{phone:field('phone')}:mode==='recover'?{code:field('code')}:{})});
      if(r.ok&&r.token){onLogin(saveSession(r.token,{memberId,name:r.name||name,dept},r.pinVer));return;}
      if(r.needsRegistration)choose('register');else if(r.needsRecovery)choose('recover');
      setMessage(r.error||'입력한 정보를 확인해 주세요.');
    }catch(e){setMessage(e instanceof Error?e.message:'다시 시도해 주세요.');}
    finally{pending.current=false;setBusy(false);}
  }
  return <main className="login-page"><section className="login-card" aria-labelledby="welcome">
    <a className="brand" href="/">✦ 교사광장</a>
    <p className="eyebrow">함께 기록하고, 함께 성장해요</p>
    <h1 id="welcome">반가워요</h1><p className="muted">교사들의 이야기와 활동을 한곳에서 만나세요.</p>
    <div className="auth-tabs" aria-label="입장 방법">{(['login','register','recover'] as const).map((value)=><button key={value} type="button" aria-pressed={mode===value} disabled={busy} onClick={()=>choose(value)}>{value==='login'?'PIN으로 입장':value==='register'?'처음 PIN 등록':'PIN 복구'}</button>)}</div>
    <form ref={form} onSubmit={submit} aria-busy={busy}>
      <fieldset disabled={busy}><legend className="sr-only">로그인 정보</legend>
        <label htmlFor="dept">부서</label><select id="dept" name="dept" required defaultValue=""><option value="" disabled>부서를 고르세요</option>{LOGIN_DEPTS.map(dept=><option key={dept}>{dept}</option>)}</select>
        <label htmlFor="name">이름</label><input id="name" name="name" autoComplete="name" maxLength={80} required />
        <label htmlFor="memberId">고유번호</label><input id="memberId" name="memberId" inputMode="numeric" autoComplete="username" minLength={8} maxLength={40} required />
        {mode==='register'?<><p className="help">부서·이름·고유번호를 확인합니다. 기존 전화번호가 있으면 대조하고, 없으면 입력한 번호와 PIN을 등록합니다.</p><label htmlFor="phone">휴대전화 번호</label><input id="phone" name="phone" type="tel" autoComplete="tel" maxLength={20} required /></>:null}
        {mode==='recover'?<><p className="help">PIN을 잊었거나 다른 사람이 먼저 등록했다면 교육·전도 담당자에게 문의해 주세요. 담당자가 본인을 확인한 뒤 발급한 코드는 30분 동안 한 번 사용할 수 있어요.</p><label htmlFor="code">담당자 복구 코드</label><input id="code" name="code" autoComplete="one-time-code" maxLength={30} required /></>:null}
        <label htmlFor="pin">{mode==='login'?'PIN':'새 PIN'} <span className="muted">숫자 6자리</span></label><input key={mode} id="pin" name="pin" type="password" inputMode="numeric" autoComplete={mode==='login'?'current-password':'new-password'} pattern="[0-9]{6}" minLength={6} maxLength={6} required />
        {mode!=='login'?<><label htmlFor="confirmPin">새 PIN 확인</label><input id="confirmPin" name="confirmPin" type="password" inputMode="numeric" autoComplete="new-password" minLength={6} maxLength={6} required /></>:null}
      </fieldset>
      {message?<p className="error" role="alert">{message}</p>:null}
      <button className="primary full" disabled={busy} type="submit">{busy?'확인 중…':labels[mode]}</button>
    </form><p><Link href="/device">앱 설치·기기 알림 안내</Link></p>

  </section></main>;
}
