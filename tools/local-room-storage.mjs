// 가짜 저장소 주소만 바꾼다. 실제 R2 서명 주소를 로컬로 가져오거나 사용하지 않는다.
export function localRoomUploadResult(value){
  if(!value||typeof value!=='object'||typeof value.put!=='string')return value;
  let url;try{url=new URL(value.put);}catch{return value;}
  if(url.hostname!=='local-image-fixture.r2.cloudflarestorage.com')return value;
  if(url.pathname.startsWith('/fake-images/room-files/'))return {...value,put:'http://127.0.0.1:58433/__local_image_fixture/'+url.pathname.slice('/fake-images/'.length)};
  if(!url.pathname.startsWith('/fake-private/room-private/'))return value;
  return {...value,put:'http://127.0.0.1:58433/__local_image_fixture/'+'private/'+url.pathname.slice('/fake-private/'.length)};
}
// Next Web 응답을 만들 때만 가짜 문서의 직접 업로드 주소를 대체한다.
export function installLocalRoomResponse(){
  const OriginalResponse=globalThis.Response;
  globalThis.Response=class extends OriginalResponse{
    static json(value,init={}){const headers=new Headers(init.headers);headers.set('content-type','application/json');return new this(JSON.stringify(value),{...init,headers});}
    constructor(body,init){
      if(typeof body==='string'&&body.includes('local-image-fixture.r2.cloudflarestorage.com')){
        try{body=JSON.stringify(localRoomUploadResult(JSON.parse(body)));}catch{}
      }
      super(body,init);
    }
  };
}
