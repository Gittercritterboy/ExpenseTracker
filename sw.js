/* ExpenseTracker service worker — offline app shell -----------------------
   Bump CACHE when you change any cached file so clients pick it up. */
var CACHE = "expensetracker-v7";
var SHELL = [
  "./",
  "./index.html",
  "./stats.html",
  "./styles.css",
  "./app.js",
  "./stats.js",
  "./config.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; })
                          .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;                       // never touch the Sheets POST
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // let cross-origin pass through

  // Navigations: render instantly from the offline copy (so a slow/flaky
  // connection can never leave you stuck on the splash screen), then quietly
  // refresh the cache in the background for the next launch.
  if (req.mode === "navigate") {
    e.respondWith(
      caches.match(req).then(function (cached) {
        var refresh = fetch(req).then(function (res) {
          if (res && res.ok) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        }).catch(function () { return null; });

        if (cached) {
          refresh.catch(function () {}); // fire-and-forget, never blocks this launch
          return cached;
        }
        // very first-ever load, nothing cached yet: wait on the network once
        return refresh.then(function (res) { return res || caches.match("./index.html"); });
      })
    );
    return;
  }

  // cache-first for static assets
  e.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
