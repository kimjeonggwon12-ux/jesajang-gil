// 선택한 파일은 변경하지 않고 게시판의 기존 전송 한도에 맞춘 사본을 만든다.
export async function plazaPhoto(source:File|string,thumbnail=false):Promise<string>{
 const url=typeof source==='string'?source:URL.createObjectURL(source);
 try{const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const img=new Image();if(/^https?:/.test(url))img.crossOrigin='anonymous';img.onload=()=>resolve(img);img.onerror=()=>reject(Error('사진을 읽지 못했어요.'));img.src=url;});
 let side=thumbnail?200:1000;const max=thumbnail?12000:44000;
 for(let round=0;round<8;round++){const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');if(!ctx)throw Error('사진을 처리하지 못했어요.');
  if(thumbnail){canvas.width=canvas.height=side;const crop=Math.min(image.width,image.height);ctx.drawImage(image,(image.width-crop)/2,(image.height-crop)/2,crop,crop,0,0,side,side);}
  else{const scale=Math.min(1,side/Math.max(image.width,image.height));canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));ctx.drawImage(image,0,0,canvas.width,canvas.height);}
  for(const quality of [.82,.72,.62,.52,.42,.32]){const data=canvas.toDataURL('image/jpeg',quality);if(data.length<=max)return data;}side=Math.round(side*.8);
 }throw Error('사진이 너무 커요. 다른 사진을 골라 주세요.');
 }finally{if(typeof source!=='string')URL.revokeObjectURL(url);}
}
