'use client';
import {useEffect,useRef,useState} from 'react';
import {qrLibrary} from '../../lib/qr';
import {installAddress} from '../../lib/device';
import {downloadAttendance} from '../../lib/attendance-admin';
import {Modal,ErrorNote} from '../Ui';
export default function InstallQr({onClose}:{onClose:()=>void}){
 const box=useRef<HTMLDivElement>(null),[url,setUrl]=useState(''),[error,setError]=useState(''),[ready,setReady]=useState(false);
 useEffect(()=>{let live=true;const target=box.current,link=installAddress(location.href);setUrl(link);void qrLibrary().then(QR=>{if(!live||!target)return;target.replaceChildren();new QR(target,{text:link,width:600,height:600,correctLevel:QR.CorrectLevel.M});setReady(true);}).catch(()=>{if(live)setError('QR 그림을 만들지 못했어요. 아래 주소로 교사광장을 열어 주세요.');});return()=>{live=false;target?.replaceChildren();};},[]);
 function save(){const source=box.current?.querySelector('canvas');if(!source)return;const canvas=document.createElement('canvas');canvas.width=canvas.height=648;const context=canvas.getContext('2d');if(!context)return;context.fillStyle='white';context.fillRect(0,0,648,648);context.drawImage(source,24,24);canvas.toBlob(blob=>{if(blob)downloadAttendance('교사광장-설치QR.png',blob);},'image/png');}
 return <Modal title="교사광장 설치용 QR" onClose={onClose}><div className="install-qr" ref={box} role="img" aria-label="교사광장 첫 화면으로 연결하는 QR"/><ErrorNote message={error}/><p>휴대폰 카메라로 QR을 찍어 교사광장을 열어 주세요. 열린 화면의 ‘앱 설치’에서 안내를 볼 수 있어요.</p><p className="device-url">{url}</p><button className="secondary" disabled={!ready} onClick={save}>QR 그림 저장</button></Modal>;
}
