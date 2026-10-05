// 2026-09-17: 복음방 교사 PWA — 기본 캐시 전략 + 오프라인 기본 화면.
// 2026-10-05: 브라우저 Push 이벤트 핸들러 추가 (Web Push API 지원 브라우저용).
const CACHE_NAME = 'kko-teacher-v3';
const OFFLINE_URL = 'home.html';
const PRECACHE = ['home.html', 'manifest.json', 'app.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' }) // 2026-09-20: 브라우저 HTTP 캐시가 옛 화면을 붙잡지 않도록 매번 재검증
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return res;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match(OFFLINE_URL))
      )
  );
});

// ══ 2026-10-05: 브라우저 Push 알림 핸들러 ══
// Web Push 서버에서 PushEvent를 보내면 Service Worker가 알림을 표시합니다.
// 페이로드 형식: { title, body, url, icon, badge, tag }
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch(e) { data = { title: '교사광장', body: event.data.text() }; }
  const options = {
    body: data.body || '',
    icon: data.icon || 'icons/icon-192.png',
    badge: data.badge || 'icons/icon-96.png',
    tag: data.tag || 'teacher-push',
    data: { url: data.url || './app.html' },
    requireInteraction: false,
    vibrate: [100, 50, 100],
  };
  event.waitUntil(
    self.registration.showNotification(data.title || '교사광장', options)
  );
});

// 알림 클릭 → 앱 해당 화면으로 이동
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './app.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes('app.html') && 'focus' in client) {
          client.focus();
          if (client.navigate) client.navigate(url);
          return;
        }
      }
      return clients.openWindow(url);
    })
  );
});

// 앱에서 메시지로 '예약 알림' 요청을 보내면 처리
// { type: 'SCHEDULE_NOTIFICATION', delayMs, title, body, url }
self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'SCHEDULE_NOTIFICATION') return;
  const { delayMs, title, body, url, tag } = event.data;
  setTimeout(() => {
    self.registration.showNotification(title || '교사광장', {
      body: body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-96.png',
      tag: tag || 'scheduled',
      data: { url: url || './app.html' },
      vibrate: [100, 50, 100],
    });
  }, delayMs || 0);
});
