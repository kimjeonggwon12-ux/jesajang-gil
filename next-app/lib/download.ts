export function downloadBase64(fileName:string,base64:string,mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
 const binary=atob(base64),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
 const url=URL.createObjectURL(new Blob([bytes],{type:mime}));const link=document.createElement('a');
 link.href=url;link.download=fileName;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
