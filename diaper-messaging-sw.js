// Service worker for background (Web Push) diaper reminders.
// Port of the original /diaper-messaging-sw.js; routes use hashes here.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); } catch { data = { body: event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || "יומן תינוק", {
    body: data.body, tag: data.tag, icon: "/icons/baby-journal-180.png", data: { url: "/#/stats" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL("/#/stats", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = windows.find((item) => new URL(item.url).origin === self.location.origin);
    if (client) { await client.navigate(url); await client.focus(); }
    else await self.clients.openWindow(url);
  })());
});
