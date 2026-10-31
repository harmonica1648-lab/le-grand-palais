/* ==========================================================
 * Le Grand Palais — Service Worker
 * 策略：
 *   1. 安裝時預先快取 App Shell (HTML / manifest / 圖示) 與 CDN 資源
 *   2. 頁面導覽 (navigate)：Network First，離線時回退到快取，再不行顯示離線頁
 *   3. 同源靜態檔 & CDN (Tailwind / FontAwesome / Google Fonts)：Stale-While-Revalidate
 *   4. Unsplash 圖片：Cache First，並限制快取數量
 * 更新：修改下方 VERSION 即可讓使用者取得新版（頁面會跳出「更新」提示）
 * ========================================================== */

const VERSION = 'v1.0.1';
const PRECACHE = `lgp-precache-${VERSION}`;
const RUNTIME = `lgp-runtime-${VERSION}`;
const IMAGES = `lgp-images-${VERSION}`;
const CURRENT_CACHES = [PRECACHE, RUNTIME, IMAGES];

const MAX_IMAGES = 40;

// 不快取的分析服務網域（Google Analytics 4 / Tag Manager）
const ANALYTICS_HOSTS = [
  'googletagmanager.com',
  'google-analytics.com',
  'analytics.google.com',
  'doubleclick.net'
];

// App Shell（同源）
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/favicon.ico',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png'
];

// 第三方資源（網址需與 index.html 內完全一致）
const CDN_ASSETS = [
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&display=swap'
];

const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="zh-TW"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>目前離線 | Le Grand Palais</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#0b0c0e;color:#e5e7eb;font-family:Georgia,'Noto Serif TC',serif;text-align:center;padding:24px}
  h1{color:#d4af37;letter-spacing:.2em;font-size:1.4rem;margin:0 0 12px}
  p{color:#9ca3af;line-height:1.8;margin:0 0 24px}
  button{background:#c5a059;color:#0b0c0e;border:0;border-radius:999px;padding:12px 28px;
         font-weight:700;letter-spacing:.1em;cursor:pointer}
</style></head>
<body><div>
  <h1>LE GRAND PALAIS</h1>
  <p>目前無法連線到網路，<br>請檢查網路狀態後再試一次。</p>
  <button onclick="location.reload()">重新載入</button>
</div></body></html>`;

/* ---------- 工具函式 ---------- */
function isCacheable(res) {
  return res && (res.ok || res.type === 'opaque');
}

async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    await Promise.all(keys.slice(0, keys.length - maxItems).map((k) => cache.delete(k)));
  }
}

/* ---------- Install ---------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);

      // 同源核心檔案：必須全部成功
      await cache.addAll(CORE_ASSETS);

      // CDN 資源：盡力而為（失敗不會中斷安裝）
      await Promise.allSettled(
        CDN_ASSETS.map(async (url) => {
          const res = await fetch(new Request(url, { mode: 'no-cors' }));
          if (isCacheable(res)) await cache.put(url, res);
        })
      );
    })()
  );
  // 不自動 skipWaiting：讓頁面顯示「有新版本」提示，由使用者決定何時更新
});

/* ---------- Activate ---------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith('lgp-') && !CURRENT_CACHES.includes(n)).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

/* ---------- Messages ---------- */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ---------- Fetch ---------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // 0) 分析／追蹤請求一律不經過 Service Worker（避免 GA 的 collect 請求被快取而漏記資料）
  if (ANALYTICS_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) return;

  // 1) 頁面導覽
  if (req.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(req));
    return;
  }

  // 2) 同源靜態資源
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(req, RUNTIME));
    return;
  }

  // 3) Unsplash 圖片
  if (url.hostname === 'images.unsplash.com') {
    event.respondWith(cacheFirstLimited(req, IMAGES, MAX_IMAGES));
    return;
  }

  // 4) 其他第三方（Tailwind / FontAwesome / Google Fonts…）
  event.respondWith(staleWhileRevalidate(req, RUNTIME));
});

/* ---------- Strategies ---------- */
async function networkFirstNavigation(req) {
  try {
    const fresh = await fetch(req);
    if (isCacheable(fresh)) {
      const cache = await caches.open(PRECACHE);
      cache.put('./index.html', fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached =
      (await caches.match(req, { ignoreSearch: true })) ||
      (await caches.match('./index.html')) ||
      (await caches.match('./'));
    if (cached) return cached;
    return new Response(OFFLINE_HTML, {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await caches.match(req, { ignoreSearch: false });

  const network = fetch(req)
    .then((res) => {
      if (isCacheable(res)) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);

  if (cached) {
    network.catch(() => {}); // 背景更新
    return cached;
  }
  const res = await network;
  return res || new Response('', { status: 504, statusText: 'Offline' });
}

async function cacheFirstLimited(req, cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;

  try {
    const res = await fetch(req);
    if (isCacheable(res)) {
      await cache.put(req, res.clone());
      trimCache(cacheName, maxItems);
    }
    return res;
  } catch (err) {
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}
