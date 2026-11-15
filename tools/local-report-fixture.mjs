// 고정 로컬 도구만 불러온다. 실제 봇 키를 읽지 않고 -990으로 시작하는 가짜 방만 응답한다.
export function localReportFixture(){const calls=[];return async(req,res,url)=>{
 if(!url.pathname.startsWith('/__local_report_fixture/'))return false;
 const respond=(value,status=200)=>{res.statusCode=status;res.setHeader('content-type','application/json');res.end(JSON.stringify(value));return true;};
 if(url.pathname==='/__local_report_fixture/stats')return respond({calls:[...calls],externalRequests:0});
 if(url.pathname==='/__local_report_fixture/reset'&&req.method==='POST'){calls.length=0;return respond({ok:true});}
 const method=url.pathname.split('/').at(-1);if(req.method!=='POST'||!['getChat','sendMessage','sendPhoto','sendDocument'].includes(method))return respond({ok:false},400);
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);
 const body=String(req.headers['content-type']).includes('multipart/form-data')?Object.fromEntries(await new Request('http://127.0.0.1:58433',{method:'POST',headers:req.headers,body:bytes}).formData()):JSON.parse(bytes.toString()||'{}'),chat=String(body.chat_id||'');
 if(!/^-?990\d+$/.test(chat))return respond({ok:false,description:'가짜 방만 허용'},403);
 calls.push({method,chat,textLength:String(body.text||'').length});
 if(chat==='-990999')return respond({ok:false,description:'가짜 연결 거절'},403);
 return respond({ok:true,result:method==='getChat'?{id:Number(chat),title:'가짜 보고방 '+chat}:{message_id:calls.length}});
};}
