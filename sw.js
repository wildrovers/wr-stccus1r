/* オフライン対応（サービスワーカー）
 * ・自分のサイトのファイル（HTML/JSON）は「まずネットから最新を取得、失敗したら保存済みを使う」
 * ・three.js やフォントなど外部ファイルは「保存済みがあればそれを使う」
 * 公開サーバー（https）上でのみ動きます。ダブルクリックで開いた場合は動きません。
 */
const CACHE = 'wr-v3';
const CORE = ['./', 'index.html', 'wr-core.js', 'data.js', 'players.json', 'stats.json', 'games.json', 'rankings.json', 'cards.js',
  'logo-data.js', 'logo-512.png', 'icon-192.png', 'icon-180.png', 'favicon-32.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.endsWith('admin.html')) return; // 管理画面はキャッシュしない
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
  } else {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }))
    );
  }
});
