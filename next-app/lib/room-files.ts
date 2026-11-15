import {ROOM_INLINE_MAX,type RoomAttachment} from './rooms';
export function readFileData(file:File):Promise<string>{return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('파일을 읽지 못했어요.'));reader.onload=()=>resolve(String(reader.result));reader.readAsDataURL(file);});}
export function roomPhoto(file:File):Promise<string>{return new Promise((resolve,reject)=>{
  const url=URL.createObjectURL(file),image=new Image();
  image.onerror=()=>{URL.revokeObjectURL(url);reject(Error('사진을 열지 못했어요.'));};
  image.onload=()=>{URL.revokeObjectURL(url);try{let side=1280;for(let round=0;round<5;round++){
    const scale=Math.min(1,side/Math.max(image.width,image.height)),canvas=document.createElement('canvas');canvas.width=Math.round(image.width*scale);canvas.height=Math.round(image.height*scale);
    const context=canvas.getContext('2d');if(!context)throw Error('사진을 처리하지 못했어요.');context.drawImage(image,0,0,canvas.width,canvas.height);
    for(const quality of [.8,.7,.6,.5]){let data=canvas.toDataURL('image/webp',quality);if(!data.startsWith('data:image/webp'))data=canvas.toDataURL('image/jpeg',quality);if(data.length<=550000){resolve(data);return;}}
    side=Math.round(side*.8);
  }throw Error('사진이 너무 커요. 다른 사진을 골라 주세요.');}catch(error){reject(error);}};image.src=url;
});}
type Request=<T>(action:string,body:Record<string,unknown>)=>Promise<T>;
export async function uploadRoomDocument(attachment:RoomAttachment,request:Request){
  if(attachment.uploaded)return attachment.uploaded;
  const file=attachment.file;if(!file)throw Error('첨부 파일을 확인해 주세요.');
  const result=await request<{url:string;name:string;put?:string;headers?:Record<string,string>}>('roomFileUpload',file.size<=ROOM_INLINE_MAX?{fileName:file.name,data:await readFileData(file)}:{fileName:file.name,size:file.size});
  if(file.size>ROOM_INLINE_MAX){if(!result.put)throw Error('파일 업로드 주소를 받지 못했어요.');const response=await fetch(result.put,{method:'PUT',headers:result.headers,body:file});if(!response.ok)throw Error(`파일을 올리지 못했어요(${response.status}).`);}
  return {url:result.url,name:result.name};
}
