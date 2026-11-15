// Web Request/Response와 기존 API의 req/res 약속만 연결한다. 권한·번호 가림은 기존 진입점이 담당한다.
export function webHandler(handler) {
  return async request => {
    const headers = new Headers({'Cache-Control':'no-store'});
    let status = 200, bytes = null;
    const response = {
      setHeader(name,value) { headers.set(name,String(value)); },
      status(code) { status=code; return response; },
      json(data) { headers.set('Content-Type','application/json; charset=utf-8'); bytes=JSON.stringify(data); return response; },
      end(body) { bytes=body ?? null; return response; },
    };
    const body = ['GET','HEAD','OPTIONS'].includes(request.method) ? undefined : (await request.text() || '{}');
    await handler({method:request.method, headers:Object.fromEntries(request.headers), body}, response);
    return new Response(request.method==='HEAD'||status===204?null:bytes,{status,headers});
  };
}
