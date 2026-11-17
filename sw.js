// عامل الخدمة: الواجهة تُخزَّن مسبقاً، والبيانات تُجلب من الشبكة أولاً مع نسخة احتياطية للعمل دون اتصال
const VERSION = "v4";
const SHELL = `shell-${VERSION}`;
const RUNTIME = `runtime-${VERSION}`;
const SHELL_FILES = [
  "./", "index.html", "styles.css", "app.js", "manifest.webmanifest",
  "icons/icon.svg", "icons/star.svg", "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // ملفات الموقع وبياناته: الشبكة أولاً (حتى تصل التحديثات فوراً)، والمخزن عند انقطاع الاتصال
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req, { cache: "no-cache" }).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(RUNTIME).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() =>
        caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === "navigate" ? caches.match("index.html") : undefined))
      )
    );
    return;
  }

  // الخطوط والصور المصغّرة الخارجية: المخزن أولاً ثم الشبكة
  const cacheable = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) ||
    /(^|\.)ytimg\.com$/.test(url.hostname);
  if (!cacheable) return;

  e.respondWith(
    caches.match(req).then((hit) =>
      hit || fetch(req).then((res) => {
        if (res.ok || res.type === "opaque") {
          const copy = res.clone();
          caches.open(RUNTIME).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => undefined)
    )
  );
});
