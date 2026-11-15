'use client';
import {useEffect,useRef,useState} from 'react';
import {attendanceId} from '../../lib/attendance';
type Decoder=(data:Uint8ClampedArray,width:number,height:number)=>{data:string}|null;
type ScanWindow=Window&{jsQR?:Decoder;BarcodeDetector?:new(options:{formats:string[]})=>{detect:(image:HTMLVideoElement)=>Promise<{rawValue:string}[]>}};
let decoder:Promise<Decoder>|null=null;
function loadDecoder(){
 const win=window as ScanWindow;if(win.jsQR)return Promise.resolve(win.jsQR);
 if(!decoder)decoder=new Promise<Decoder>((resolve,reject)=>{const script=document.createElement('script');let timer:ReturnType<typeof setTimeout>;const fail=()=>{clearTimeout(timer);script.remove();decoder=null;reject(Error('QR 도구를 불러오지 못했어요. 다시 시도해 주세요.'));};script.src='https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';script.onload=()=>{clearTimeout(timer);if(win.jsQR)resolve(win.jsQR);else fail();};script.onerror=fail;timer=setTimeout(fail,15000);document.head.appendChild(script);});
 return decoder;
}
export default function AttendanceScanner({onFound,onClose}:{onFound:(id:string)=>void;onClose:()=>void}){
 const video=useRef<HTMLVideoElement>(null),[message,setMessage]=useState('카메라를 켜는 중이에요.'),[failed,setFailed]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let active=true,stream:MediaStream|undefined,timer:ReturnType<typeof setTimeout>|undefined;const element=video.current;
  const stop=()=>{active=false;clearTimeout(timer);stream?.getTracks().forEach(track=>track.stop());if(element)element.srcObject=null;};
  const hidden=()=>{if(document.hidden){stop();setFailed(true);setMessage('화면을 떠나 카메라를 껐어요. 다시 시작할 수 있어요.');}};
  document.addEventListener('visibilitychange',hidden);
  async function begin(){
   try{
    setFailed(false);setMessage('카메라를 켜는 중이에요.');
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
    if(!active||!element){stream.getTracks().forEach(t=>t.stop());return;}
    element.srcObject=stream;await element.play();if(!active)return;
    let detect:(()=>Promise<string|undefined>)|undefined;const Detector=(window as ScanWindow).BarcodeDetector;
    if(Detector){try{const detector=new Detector({formats:['qr_code']});await detector.detect(element);detect=async()=>(await detector.detect(element))[0]?.rawValue;}catch{/* 지원하지 않으면 기존 jsQR 경로를 사용한다. */}}
    if(!detect){const qr=await loadDecoder();if(!active)return;const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});if(!context)throw Error('카메라 영상을 읽을 수 없어요.');detect=async()=>{if(!element.videoWidth)return;const scale=Math.min(1,960/element.videoWidth);canvas.width=Math.round(element.videoWidth*scale);canvas.height=Math.round(element.videoHeight*scale);context.drawImage(element,0,0,canvas.width,canvas.height);return qr(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height)?.data;};}
    setMessage('모임 화면의 QR을 비춰 주세요.');
    const tick=async()=>{if(!active)return;try{const raw=await detect!();if(!active)return;const id=raw?attendanceId(raw):'';if(id){stop();onFound(id);return;}if(raw)setMessage('출석용 QR이 아니에요. 모임 화면의 QR을 비춰 주세요.');}catch{if(active)setMessage('QR을 읽지 못했어요. 카메라를 QR에 맞춰 주세요.');}if(active)timer=setTimeout(tick,250);};void tick();
   }catch(error){if(!active)return;stop();setFailed(true);setMessage(error instanceof Error&&error.message.includes('QR 도구')?error.message:'카메라를 쓸 수 없어요. 권한을 확인하거나 휴대폰 기본 카메라로 QR을 찍어 주세요.');}
  }void begin();return()=>{stop();document.removeEventListener('visibilitychange',hidden);};
 },[onFound,attempt]);
 return <section className="panel attendance-camera" aria-label="출석 QR 카메라"><h2>QR로 출석하기</h2><video ref={video} playsInline muted aria-label="QR 카메라 영상"/><p role="status">{message}</p><div className="actions">{failed?<button className="primary" onClick={()=>setAttempt(n=>n+1)}>카메라 다시 시작</button>:null}<button className="secondary" onClick={onClose}>카메라 닫기</button></div><p className="help">휴대폰 기본 카메라로 찍거나 출석 링크를 입력할 수도 있어요.</p></section>;
}
