/* global importScripts, firebase */

importScripts("https://www.gstatic.com/firebasejs/10.12.3/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.3/firebase-messaging-compat.js");

let messaging = null;

async function initFirebaseMessaging() {
  try {
    const response = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get-config" }),
    });

    if (!response.ok) {
      throw new Error("No se pudo obtener configuración Firebase");
    }

    const config = await response.json();
    if (!firebase.apps.length) {
      firebase.initializeApp({
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        projectId: config.projectId,
        storageBucket: config.storageBucket,
        messagingSenderId: config.messagingSenderId,
        appId: config.appId,
      });
    }

    messaging = firebase.messaging();

    messaging.onBackgroundMessage((payload) => {
      const notificationTitle =
        payload?.notification?.title || "Conquiguias World";
      const notificationBody =
        payload?.notification?.body || "Tienes una notificación nueva.";

      const link =
        payload?.data?.url ||
        payload?.fcmOptions?.link ||
        "/panel";

      self.registration.showNotification(notificationTitle, {
        body: notificationBody,
        icon: "/images/decoracion/favicon-96x96.png",
        badge: "/images/decoracion/favicon-96x96.png",
        data: {
          link,
          payload,
        },
      });
    });
  } catch (error) {
    console.error("[SW] Error inicializando Firebase Messaging:", error);
  }
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.link || "/panel";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes("/panel") && "focus" in client) {
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }

      return null;
    }),
  );
});

initFirebaseMessaging();
