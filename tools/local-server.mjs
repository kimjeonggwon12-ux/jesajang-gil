// 배포 없이 내 컴퓨터에서 API 를 띄운다(비교·시험용).
//   node --env-file=.env tools/local-server.mjs [포트]
import http from 'node:http';
import handler from '../api/index.js';

const port = Number(process.argv[2] || 3939);

http.createServer((req, res) => {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (obj) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); };
  handler(req, res);
}).listen(port, () => console.log('http://localhost:' + port + '/api'));
