import {
  getMessaging,
  getToken,
  isSupported,
  onMessage,
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-messaging.js";

const LOCAL_TOKEN_KEY = "cw_push_token";
const LOCAL_PROMPT_KEY = "cw_push_prompt_requested";

function getStoredToken() {
  try {
    return String(localStorage.getItem(LOCAL_TOKEN_KEY) || "").trim();
  } catch (_error) {
    return "";
  }
}

function setStoredToken(token) {
  try {
    if (token) {
      localStorage.setItem(LOCAL_TOKEN_KEY, token);
    } else {
      localStorage.removeItem(LOCAL_TOKEN_KEY);
    }
  } catch (_error) {
    // Ignorar fallos de storage
  }
}

async function fetchFirebaseConfig() {
  const response = await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "get-config" }),
  });

  if (!response.ok) {
    throw new Error("No se pudo cargar la configuración de Firebase");
  }

  return response.json();
}

async function postWithAuth(action, idToken, payload = {}) {
  const response = await fetch(`/api/social?action=${encodeURIComponent(action)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      idToken,
      ...payload,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Error en ${action}`);
  }

  return data;
}

async function disableStoredToken(idToken) {
  const token = getStoredToken();
  if (!token) return;

  await postWithAuth("disable-notification-token", idToken, { token });
  setStoredToken("");
}

export async function setupTaskReminderPush({
  app,
  auth,
  forcePrompt = false,
  onForegroundMessage,
} = {}) {
  if (!app || !auth || !auth.currentUser) {
    return { enabled: false, reason: "no-auth" };
  }

  if (!("serviceWorker" in navigator) || !("Notification" in window)) {
    return { enabled: false, reason: "unsupported-browser" };
  }

  const messagingSupported = await isSupported().catch(() => false);
  if (!messagingSupported) {
    return { enabled: false, reason: "unsupported-fcm" };
  }

  const config = await fetchFirebaseConfig();
  const vapidKey = String(config?.vapidKey || "").trim();
  if (!vapidKey) {
    return { enabled: false, reason: "missing-vapid-key" };
  }

  const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");

  let permission = Notification.permission;
  const alreadyAsked = localStorage.getItem(LOCAL_PROMPT_KEY) === "1";

  if (permission === "default" && (forcePrompt || !alreadyAsked)) {
    localStorage.setItem(LOCAL_PROMPT_KEY, "1");
    permission = await Notification.requestPermission();
  }

  if (permission !== "granted") {
    return { enabled: false, reason: "permission-denied" };
  }

  const messaging = getMessaging(app);
  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: registration,
  });

  if (!token) {
    return { enabled: false, reason: "missing-token" };
  }

  const idToken = await auth.currentUser.getIdToken(true);
  await postWithAuth("upsert-notification-token", idToken, {
    token,
    permission,
    platform: "web",
    userAgent: navigator.userAgent,
  });

  setStoredToken(token);

  onMessage(messaging, (payload) => {
    if (typeof onForegroundMessage === "function") {
      onForegroundMessage(payload);
    }
  });

  return { enabled: true, token };
}

export async function disableTaskReminderPush({ auth } = {}) {
  if (!auth?.currentUser) return;

  try {
    const idToken = await auth.currentUser.getIdToken(true);
    await disableStoredToken(idToken);
  } catch (_error) {
    // Ignorar en cierre de sesión
  }
}
