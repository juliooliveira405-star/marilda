// Madrila ERP service worker: enables "install as app". Network-only on purpose —
// business data is never cached on the device ("dados não saem do app").
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
