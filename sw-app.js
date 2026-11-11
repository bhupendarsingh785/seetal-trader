const CACHE = "seetal-app-v1";
const FILES = ["./seetal-app.html", "./manifest-app.webmanifest"];
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES).catch(()=>{}))); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const u = new URL(e.request.url);
  if (/live\.json|workers\.dev|supabase\.co|pollinations|googleapis|api\./.test(u.href)) return;
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
    const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(()=>{}); return res;
  }).catch(() => caches.match("./seetal-app.html"))));
});
