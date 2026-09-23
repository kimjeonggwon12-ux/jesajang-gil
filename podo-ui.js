/* ═══════════════════════════════════════════════════════════════════
   포도원(podo) 목업 공용 스크립트 — 하단 탭바 + 토스트
   ───────────────────────────────────────────────────────────────────
   2026-09-23 신설. 4개 목업 페이지가 똑같은 탭바를 갖도록 여기서 한 번만
   그립니다(색/아이콘/순서를 고칠 때 이 파일 한 곳만 고치면 전부 반영).

   사용법: <body data-tab="home"> 처럼 현재 탭을 표시하고 이 파일을 로드.
   ⚠️ 목업이라 백엔드 호출은 없습니다. 아직 안 만든 탭은 토스트만 띄웁니다.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  var TABS = [
    { key: 'calendar', label: '캘린더',  href: null,                 icon: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>' },
    { key: 'home',     label: '내활동',  href: 'podo-home.html',     icon: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>' },
    { key: 'connect',  label: '연결',    href: 'podo-connect.html',  icon: '<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2"/><path d="M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3"/><path d="M3 4h8"/>' },
    { key: 'ai',       label: 'AI상담',  href: null,                 icon: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>' },
    { key: 'textbook', label: '교재',    href: null,                 icon: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>' },
    { key: 'admin',    label: '관리자',  href: 'podo-admin.html',    icon: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>' }
  ];

  function svg(paths) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + paths + '</svg>';
  }

  var toastTimer;
  window.podoToast = function (msg) {
    var el = document.getElementById('podoToast');
    if (!el) { el = document.createElement('div'); el.id = 'podoToast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2000);
  };

  function mountTabbar() {
    var current = document.body.dataset.tab || '';
    var nav = document.createElement('nav');
    nav.className = 'podo-tabbar';
    nav.innerHTML = TABS.map(function (t) {
      var on = t.key === current ? ' on' : '';
      var inner = svg(t.icon) + '<span>' + t.label + '</span>';
      if (t.href && t.key !== current) return '<a class="' + on.trim() + '" href="' + t.href + '">' + inner + '</a>';
      if (t.href) return '<a class="' + on.trim() + '" href="' + t.href + '">' + inner + '</a>';
      return '<button class="soon' + on + '" data-label="' + t.label + '">' + inner + '</button>';
    }).join('');
    document.body.appendChild(nav);

    nav.querySelectorAll('button.soon').forEach(function (b) {
      b.addEventListener('click', function () {
        window.podoToast(b.dataset.label + ' 화면은 아직 목업이 없어요');
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountTabbar);
  else mountTabbar();
})();
