// ShareGood Web Push Service Worker（master-plan §6a 交付內容 9）。
//
// 查證來源（不是憑印象寫的）：
// - `push` 事件與 `self.registration.showNotification`：MDN
//   ServiceWorkerGlobalScope: push event
//   （https://developer.mozilla.org/docs/Web/API/ServiceWorkerGlobalScope/push_event）。
// - `notificationclick` 事件用 `clients.matchAll({type:"window"})` 找既有分頁 focus、
//   都沒找到才 `clients.openWindow()`：MDN ServiceWorkerGlobalScope: notificationclick
//   event
//   （https://developer.mozilla.org/docs/Web/API/ServiceWorkerGlobalScope/notificationclick_event）。
//   這是這份規格草擬階段就記錄過的已知技術細節：`clients.openWindow()` 本身沒有「找既有
//   分頁」的語意，一定是開新分頁，必須自己比對 URL 才能做到「優先 focus 既有分頁」。

self.addEventListener("push", (event) => {
  let payload = { title: "ShareGood 好物共享", body: "你有一則新通知", itemUrl: "/" };
  try {
    if (event.data) {
      payload = { ...payload, ...event.data.json() };
    }
  } catch {
    // payload 不是合法 JSON 就用預設文字，不讓整個 push 事件處理失敗。
  }

  const { title, body, itemUrl } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: { itemUrl },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const itemUrl = event.notification.data?.itemUrl ?? "/";
  const targetUrl = new URL(itemUrl, self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: "window" }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
      return undefined;
    }),
  );
});
