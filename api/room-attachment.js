import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {roomDownload} from '../server/lib/room-download.js';
export default async function handler(req,res){
 let body=req.body;
 if(body===undefined){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>4096){res.statusCode=413;res.end();return;}chunks.push(c);}body=Buffer.concat(chunks).toString();}
 const response=await roomDownload(new Request('http://local.invalid/api/room-attachment',{method:req.method,headers:{'content-type':'application/json'},...(!['GET','HEAD'].includes(req.method)?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}));
 res.writeHead(response.status,Object.fromEntries(response.headers));
 if(response.body&&req.method!=='HEAD')await pipeline(Readable.fromWeb(response.body),res);else res.end();
}
