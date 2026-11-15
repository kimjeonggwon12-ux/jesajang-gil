'use client';
import {useState} from 'react';
import Link from 'next/link';
import {useDevice} from './AppRuntime';
import {installSteps} from '../../lib/device';
import {ErrorNote} from '../Ui';
import InstallQr from './InstallQr';
export default function DeviceSettings(){
 const d=useDevice(),[qr,setQr]=useState(false),member=d.owner&&!d.owner.account.guest&&!d.owner.token.startsWith('g');
 const permissionText={loading:'브라우저 설정을 확인하고 있어요.',default:'아직 알림을 허용하지 않았어요.',granted:'이 브라우저에서 알림이 허용돼 있어요.',denied:'브라우저에서 알림을 차단한 상태예요.',unsupported:'현재 브라우저에서는 알림을 사용할 수 없어요.',insecure:'알림은 보안 연결(HTTPS)에서 사용할 수 있어요.'}[d.permission];
 return <><header className="site-header"><Link className="brand" href="/">✦ 교사광장</Link><nav aria-label="기기 안내 메뉴"><Link href="/">홈</Link><Link href="/menu">전체 메뉴</Link></nav></header><main className="workspace device-settings"><h1>앱 설치·기기 알림</h1>{d.message?<p role="status">{d.message}</p>:null}
 <section className="panel" id="install"><h2>홈 화면에 교사광장 추가</h2><p>아이콘을 눌러 교사광장을 바로 열 수 있어요.</p><ol>{installSteps(d.device).map(step=><li key={step}>{step}</li>)}</ol>{d.canInstall&&!d.device.installed?<button className="primary" disabled={d.installBusy} onClick={()=>void d.install()}>{d.installBusy?'설치 창을 확인해 주세요…':'앱 설치하기'}</button>:null}<div id="install-qr"><h3>함께 설치하기</h3><p>모임에서 설치용 QR을 크게 띄우거나 그림으로 저장해 사용할 수 있어요.</p><button className="secondary" onClick={()=>setQr(true)}>앱 설치 QR 보기</button></div></section>
 <section className="panel" id="notifications"><h2>이 기기의 알림</h2><p>{permissionText}</p>{d.permission==='default'?<button className="primary" onClick={()=>void d.allow()}>알림 허용하기</button>:null}{d.permission==='denied'?<p>브라우저의 사이트 설정에서 교사광장 알림을 허용한 뒤 이 화면을 다시 열어 주세요.</p>:null}{d.permission==='unsupported'&&d.device.ios?<p>Safari에서 홈 화면에 추가한 뒤, 홈 화면의 교사광장 아이콘으로 열어 알림을 확인해 주세요.</p>:null}<ErrorNote message={d.workerError}/><ErrorNote message={d.reminderError}/>
 {member?<><p>{d.owner!.account.name}님의 이 기기 알림 설정이에요.</p><label className="check-line"><input type="checkbox" checked={d.preferences.calendar} onChange={e=>d.setPreference('calendar',e.target.checked)}/>일정 하루 전 알림</label><label className="check-line"><input type="checkbox" checked={d.preferences.posts} onChange={e=>d.setPreference('posts',e.target.checked)}/>새 글 알림</label>{d.permission==='granted'&&d.preferences.calendar?<>{!d.reminderError&&!d.workerError?<p role="status">{d.reminderBusy?'이번 주 일정을 확인하고 있어요.':d.reminderCount!==null?`이번 주 일정 ${d.reminderCount}개의 알림을 준비했어요.`:'일정 알림을 준비하고 있어요.'}</p>:null}<button className="secondary" disabled={d.reminderBusy} onClick={d.refresh}>일정 알림 다시 확인</button></>:null}</>:<p>로그인하면 본인 일정과 새 글의 알림을 설정할 수 있어요. <Link href="/">로그인하기</Link></p>}
 <p className="help">일정 알림에는 일정 이름과 장소가 표시돼요. 알림은 이번 주에 시작하는 본인 범위 일정의 하루 전 오전 9시를 기준으로 준비합니다. 기기에 설정된 시간을 사용해요.</p><p className="help">앱이나 브라우저를 종료하면 예약이 사라질 수 있어요. 놓친 일정은 앱에서 다시 확인해 주세요. 새 글도 앱이 확인한 내용만 알려드리며, 앱을 닫은 동안 계속 받는 기능은 아직 제공하지 않아요.</p><p className="help">이 설정을 꺼도 브라우저의 허용 상태는 유지됩니다. 모든 알림을 차단하려면 브라우저 사이트 설정에서 변경해 주세요.</p></section>{qr?<InstallQr onClose={()=>setQr(false)}/>:null}</main></>;
}
