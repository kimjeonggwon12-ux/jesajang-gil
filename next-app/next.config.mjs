import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @type {import('next').NextConfig} */
const config = {
  poweredByHeader: false,
  outputFileTracingRoot: root,
  outputFileTracingIncludes: {'/api': ['../server/assets/**/*'], '/api/tg': ['../server/assets/**/*'], '/api/pilot-page':['../*.html']},
  serverExternalPackages: ['sharp', '@resvg/resvg-js'],
  webpack(config, {isServer}) {
    // 공유 server/와 Next에 각각 설치된 sharp의 경로 차이 때문에 기본 외부화가
    // 해제될 수 있다. 네이티브 모듈을 JS 번들에 넣지 않고 런타임에서 로드한다.
    if (isServer) config.externals = [{sharp: 'commonjs sharp'}, ...[].concat(config.externals || [])];
    return config;
  },
  async headers() {
    return [{source:'/service-worker.js',headers:[{key:'Cache-Control',value:'no-cache, no-store, must-revalidate'},{key:'Service-Worker-Allowed',value:'/'}]},{source: '/:path*', headers: [
      {key:'X-Robots-Tag',value:'noindex, nofollow, noarchive'},
      {key:'X-Content-Type-Options',value:'nosniff'},
      {key:'Referrer-Policy',value:'same-origin'},
    ]}];
  },
};
export default config;
