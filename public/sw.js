/*
 * ziLearn's service worker. Its job is to make the app installable and to keep pages usable when the
 * connection to the computer running ziLearn drops for a moment: built assets are cached for good (their
 * names change with each build), pages are fetched fresh and fall back to the last copy, and the API
 * is never cached, so nothing a page shows or saves is stale.
 */
const CACHE = "zilearn-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/") || /\.(png|svg|ico|woff2?)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then(
            (hit) =>
              hit ||
              new Response(
                '<!doctype html><meta name="viewport" content="width=device-width"><title>ziLearn</title><body style="font:16px system-ui;padding:24px"><h1>ziLearn is out of reach</h1><p>The computer running ziLearn can\'t be reached. Check that it is on and on the same network, then reload.</p>',
                { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
              ),
          ),
        ),
    );
  }
});
