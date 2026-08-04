// Minimal service worker — its presence (not its logic) is what makes
// Chrome/Android treat this as an installable PWA. Intentionally NOT
// intercepting fetch events for now — a fetch handler that wraps every
// request (including the app's own JS/HTML) is a common cause of blank-page
// bugs on first load. Add real offline caching later once the base app is
// confirmed working end to end.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  self.clients.claim();
});
