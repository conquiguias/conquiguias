// api/social.js - VERSIÓN OPTIMIZADA SIN SUBIDA DE ARCHIVOS
import admin from "firebase-admin";

const IMGUR_CLIENT_ID = process.env.IMGUR_CLIENT_ID;
const OWNER_EMAIL = "kendall.torres.17@gmail.com";
const ADMIN_EMAILS = [
  OWNER_EMAIL,
  "pruebaja@gmail.com",
  "lunabecky026@gmail.com",
  "ayurelihrdz@gmail.com",
];

if (!admin.apps.length) {
  const serviceAccount = {
    type: "service_account",
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
  };

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: "conquiguias-world-85ccd.firebasestorage.app",
  });
}

export default async function handler(req, res) {
  // Configurar CORS
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,OPTIONS,PATCH,DELETE,POST,PUT",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version",
  );

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const { action } = req.query;

  try {
    switch (action) {
      case "delete":
        await handleDelete(req, res);
        break;
      case "health":
        res
          .status(200)
          .json({ status: "OK", message: "Social API is running" });
        break;
      case "get-client-id":
        await handleGetClientId(req, res);
        break;
      case "get-admins":
        await handleGetAdmins(req, res);
        break;
      case "get-instructor-assignments":
        await handleGetInstructorAssignments(req, res);
        break;
      case "get-my-instructor-assignment":
        await handleGetMyInstructorAssignment(req, res);
        break;
      case "save-instructor-assignments":
        await handleSaveInstructorAssignments(req, res);
        break;
      case "get-assignable-users":
        await handleGetAssignableUsers(req, res);
        break;
      case "save-paypal-donation":
        await handleSavePaypalDonation(req, res);
        break;
      case "check-stream":
        await handleCheckStream(req, res);
        break;
      default:
        res.status(400).json({ error: "Acción no válida" });
    }
  } catch (error) {
    console.error("Error en social API:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Error interno del servidor",
    });
  }
}

// Manejar eliminación de archivos
async function handleDelete(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const { deletehash } = req.body;

  if (!deletehash) {
    return res.status(400).json({ error: "Deletehash requerido" });
  }

  try {
    const response = await fetch(
      `https://api.imgur.com/3/image/${deletehash}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Client-ID ${IMGUR_CLIENT_ID}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error("Error al eliminar imagen de Imgur");
    }

    res.status(200).json({
      success: true,
      message: "Imagen eliminada correctamente",
    });
  } catch (error) {
    console.error("Error en delete:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Error al eliminar la imagen",
    });
  }
}

async function handleGetClientId(req, res) {
  res.status(200).json({
    clientId: process.env.IMGUR_CLIENT_ID,
  });
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb", // Reducido porque ya no manejamos archivos grandes
    },
  },
};

// 🔒 Endpoint para obtener lista de administradores
async function handleGetAdmins(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    await requireAdminOrOwner(req);

    const adminsUnicos = getAdminEmails();

    res.status(200).json({
      success: true,
      ownerEmail: OWNER_EMAIL,
      admins: adminsUnicos,
    });
  } catch (error) {
    console.error("Error obteniendo administradores:", error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "Error al obtener lista de administradores",
    });
  }
}

function normalizeEmail(value) {
  return (value || "").trim().toLowerCase();
}

function getAdminEmails() {
  return Array.from(
    new Set(ADMIN_EMAILS.map((email) => normalizeEmail(email)).filter(Boolean)),
  );
}

function getBearerToken(req) {
  const authHeader =
    req.headers?.authorization || req.headers?.Authorization || "";
  if (typeof authHeader !== "string") return "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function requireOwner(req, body = {}) {
  const token = getBearerToken(req) || String(body.idToken || "").trim();

  if (!token) {
    const error = new Error("Token de autenticación requerido");
    error.statusCode = 401;
    throw error;
  }

  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(token);
  } catch (_error) {
    const error = new Error("Token de autenticación inválido");
    error.statusCode = 401;
    throw error;
  }

  const requesterEmail = normalizeEmail(decodedToken?.email || "");
  if (!requesterEmail || requesterEmail !== normalizeEmail(OWNER_EMAIL)) {
    const error = new Error("Solo el propietario puede realizar esta acción");
    error.statusCode = 403;
    throw error;
  }

  return requesterEmail;
}

async function requireAdminOrOwner(req, body = {}) {
  const token = getBearerToken(req) || String(body.idToken || "").trim();

  if (!token) {
    const error = new Error("Token de autenticación requerido");
    error.statusCode = 401;
    throw error;
  }

  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(token);
  } catch (_error) {
    const error = new Error("Token de autenticación inválido");
    error.statusCode = 401;
    throw error;
  }

  const requesterEmail = normalizeEmail(decodedToken?.email || "");
  const admins = getAdminEmails();
  if (!requesterEmail || !admins.includes(requesterEmail)) {
    const error = new Error("No tienes permisos para realizar esta acción");
    error.statusCode = 403;
    throw error;
  }

  return requesterEmail;
}

async function requireAuthenticated(req, body = {}) {
  const token = getBearerToken(req) || String(body.idToken || "").trim();

  if (!token) {
    const error = new Error("Token de autenticación requerido");
    error.statusCode = 401;
    throw error;
  }

  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(token);
  } catch (_error) {
    const error = new Error("Token de autenticación inválido");
    error.statusCode = 401;
    throw error;
  }

  return {
    uid: String(decodedToken?.uid || "").trim(),
    email: normalizeEmail(decodedToken?.email || ""),
  };
}

function sanitizeSpecialties(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => ({
      id: String(item?.id || "").trim(),
      titulo: String(item?.titulo || item?.id || "").trim(),
    }))
    .filter((item) => !!item.id);
}

function sanitizeAssignments(input) {
  const source = input && typeof input === "object" ? input : {};
  const sanitized = {};

  Object.entries(source).forEach(([rawKey, rawValue]) => {
    if (!rawValue || typeof rawValue !== "object") return;

    const assignmentKey = String(rawKey || "").trim();
    if (!assignmentKey) return;

    const email = normalizeEmail(rawValue.email);
    const especialidades = sanitizeSpecialties(rawValue.especialidades);

    if (!email || especialidades.length === 0) return;

    sanitized[assignmentKey] = {
      userId: String(rawValue.userId || assignmentKey).trim(),
      email,
      name: String(rawValue.name || email).trim(),
      especialidades,
      updatedAt: rawValue.updatedAt || new Date().toISOString(),
      assignedBy: normalizeEmail(rawValue.assignedBy || ""),
    };
  });

  return sanitized;
}

async function handleGetInstructorAssignments(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    await requireAdminOrOwner(req);

    const configRef = admin
      .firestore()
      .collection("configuracion")
      .doc("rolesPermisos");
    const configSnap = await configRef.get();
    const data = configSnap.exists ? configSnap.data() || {} : {};

    res.status(200).json({
      success: true,
      ownerEmail: data.ownerEmail || OWNER_EMAIL,
      instructores: data.instructores || {},
    });
  } catch (error) {
    console.error("Error obteniendo asignaciones de instructores:", error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "Error al obtener asignaciones de instructores",
    });
  }
}

async function handleGetMyInstructorAssignment(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const requester = await requireAuthenticated(req);
    const configRef = admin
      .firestore()
      .collection("configuracion")
      .doc("rolesPermisos");
    const configSnap = await configRef.get();
    const data = configSnap.exists ? configSnap.data() || {} : {};
    const assignments = data.instructores || {};

    let assignment = null;
    let assignmentKey = "";

    if (requester.uid && assignments[requester.uid]) {
      assignment = assignments[requester.uid];
      assignmentKey = requester.uid;
    } else if (requester.email && assignments[requester.email]) {
      assignment = assignments[requester.email];
      assignmentKey = requester.email;
    } else if (requester.email) {
      for (const [key, value] of Object.entries(assignments)) {
        if (!value || typeof value !== "object") continue;
        if (normalizeEmail(value.email || "") === requester.email) {
          assignment = value;
          assignmentKey = key;
          break;
        }
      }
    }

    res.status(200).json({
      success: true,
      ownerEmail: data.ownerEmail || OWNER_EMAIL,
      admins: getAdminEmails(),
      assignmentKey,
      assignment: assignment || null,
    });
  } catch (error) {
    console.error("Error obteniendo asignación del instructor actual:", error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "Error al obtener asignación del instructor",
    });
  }
}

async function handleSaveInstructorAssignments(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const body = req.body || {};
    const requesterEmail = await requireOwner(req, body);
    const instructoresSanitizados = sanitizeAssignments(body.instructores);

    const configRef = admin
      .firestore()
      .collection("configuracion")
      .doc("rolesPermisos");
    await configRef.set({
      ownerEmail: OWNER_EMAIL,
      instructores: instructoresSanitizados,
      updatedAt: new Date().toISOString(),
      updatedBy: requesterEmail,
    });

    res.status(200).json({
      success: true,
      ownerEmail: OWNER_EMAIL,
      instructores: instructoresSanitizados,
    });
  } catch (error) {
    console.error("Error guardando asignaciones de instructores:", error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "Error al guardar asignaciones de instructores",
    });
  }
}

async function handleGetAssignableUsers(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    await requireAdminOrOwner(req);

    const map = new Map();

    const usuariosSnap = await admin.firestore().collection("usuarios").get();
    usuariosSnap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const email = normalizeEmail(
        data.email || data.correo || data.mail || "",
      );
      if (!email) return;

      const nombre = String(data.nombre || "").trim();
      const apellido = String(data.apellido || "").trim();
      const name =
        `${nombre} ${apellido}`.trim() || String(data.userName || email).trim();

      map.set(docSnap.id, {
        uid: docSnap.id,
        email,
        name,
      });
    });

    try {
      const postsSnap = await admin
        .firestore()
        .collection("posts")
        .orderBy("timestamp", "desc")
        .limit(200)
        .get();

      postsSnap.forEach((docSnap) => {
        const post = docSnap.data() || {};
        const key = String(
          post.userId || normalizeEmail(post.userEmail || ""),
        ).trim();
        const email = normalizeEmail(post.userEmail || "");
        if (!key || !email) return;

        if (!map.has(key)) {
          map.set(key, {
            uid: String(post.userId || "").trim(),
            email,
            name: String(post.userName || email).trim(),
          });
        }
      });
    } catch (error) {
      console.warn(
        "[WARN] No se pudieron completar usuarios desde publicaciones:",
        error,
      );
    }

    const users = Array.from(map.values())
      .filter((item) => !!item.email)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    res.status(200).json({
      success: true,
      users,
    });
  } catch (error) {
    console.error("Error obteniendo usuarios asignables:", error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "Error al obtener usuarios asignables",
    });
  }
}

async function handleSavePaypalDonation(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const body = req.body || {};
    const requester = await requireAuthenticated(req, body);

    const subscriptionId = String(body.subscriptionId || "").trim();
    const planId = String(body.planId || "").trim();
    const provider = String(body.provider || "paypal").trim().toLowerCase();
    const intent = String(body.intent || "subscription").trim().toLowerCase();

    if (!subscriptionId) {
      return res.status(400).json({ success: false, error: "subscriptionId es requerido" });
    }

    if (!planId) {
      return res.status(400).json({ success: false, error: "planId es requerido" });
    }

    const donorEmail = normalizeEmail(body.donorEmail || requester.email || "");
    const donorName = String(body.donorName || "").trim();
    const donorUserId = String(body.donorUserId || requester.uid || "").trim();

    const db = admin.firestore();
    const donationRef = db.collection("donaciones_paypal").doc(subscriptionId);

    await donationRef.set(
      {
        subscriptionId,
        planId,
        provider,
        intent,
        status: "approved",
        donorUserId,
        donorEmail,
        donorName,
        isGuestSession: !!body.isGuestSession,
        approvedAt: body.approvedAt || new Date().toISOString(),
        payload: body.payload || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        requestedBy: {
          uid: requester.uid,
          email: requester.email,
        },
      },
      { merge: true },
    );

    return res.status(200).json({
      success: true,
      message: "Donación guardada correctamente",
      subscriptionId,
    });
  } catch (error) {
    console.error("Error guardando donación PayPal:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "Error al guardar donación",
    });
  }
}

const LIVE_STREAM_URL =
  "https://edge1-us-losangeles.picarto.tv/stream/hls/golive%2bXSTUDIOCODE/1_0/index.m3u8";
const LIVE_POST_ID = "live_stream";
const STREAM_CHECK_CACHE_MS = 30000;
const OWNER_PROFILE_CACHE_MS = 10 * 60 * 1000;
const LIVE_POST_SYNC_INTERVAL_MS = 120000;

let streamStatusCache = { checkedAt: 0, data: { live: false } };
let ownerProfileCache = {
  checkedAt: 0,
  data: { email: OWNER_EMAIL, name: "Admin", photo: "", uid: "" },
};
let lastLivePostSyncAt = 0;

async function detectLiveStatus() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2800);

  try {
    const streamRes = await fetch(LIVE_STREAM_URL, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept:
          "application/vnd.apple.mpegurl, application/x-mpegURL, text/plain;q=0.9, */*;q=0.8",
        "Cache-Control": "no-cache",
      },
    });

    if (!streamRes.ok) {
      return { live: false };
    }

    const playlist = await streamRes.text();
    const hasSegments = /#EXTINF/i.test(playlist);
    const hasVariantInfo = /#EXT-X-STREAM-INF/i.test(playlist);
    const hasMediaOrVariantUrls =
      /^[^#\n\r][^\n\r]*\.(ts|m4s|m3u8)(\?[^\n\r]*)?\s*$/im.test(playlist);
    const looksOffline =
      /\boffline\b|\bnot.?found\b|\bforbidden\b|\berror\b/i.test(
        playlist.slice(0, 500),
      );

    return {
      live:
        (hasSegments || hasVariantInfo || hasMediaOrVariantUrls) &&
        !looksOffline &&
        playlist.trim().length > 30,
    };
  } catch (_error) {
    return { live: false };
  } finally {
    clearTimeout(timer);
  }
}

async function getOwnerProfileCached(force = false) {
  const now = Date.now();
  if (
    !force &&
    ownerProfileCache.checkedAt &&
    now - ownerProfileCache.checkedAt < OWNER_PROFILE_CACHE_MS
  ) {
    return ownerProfileCache.data;
  }

  const profile = { email: OWNER_EMAIL, name: "Admin", photo: "", uid: "" };

  try {
    const userRecord = await admin.auth().getUserByEmail(OWNER_EMAIL);
    profile.uid = userRecord.uid || "";
    profile.name = userRecord.displayName || "Admin";
    profile.photo = userRecord.photoURL || "";

    if (profile.uid) {
      const db = admin.firestore();
      const userDoc = await db.collection("usuarios").doc(profile.uid).get();
      if (userDoc.exists) {
        const d = userDoc.data() || {};
        const fullName = `${d.nombre || ""} ${d.apellido || ""}`.trim();
        if (fullName) profile.name = fullName;
        if (d.photoURL) profile.photo = d.photoURL;
      }
    }
  } catch (_error) {
    // Mantener defaults si falla
  }

  ownerProfileCache = {
    checkedAt: now,
    data: profile,
  };

  return profile;
}

async function syncLivePost(ownerProfile) {
  const now = Date.now();
  if (lastLivePostSyncAt && now - lastLivePostSyncAt < LIVE_POST_SYNC_INTERVAL_MS) {
    return;
  }

  lastLivePostSyncAt = now;
  const db = admin.firestore();
  const liveRef = db.collection("posts").doc(LIVE_POST_ID);
  const liveSnap = await liveRef.get();
  const existing = liveSnap.exists ? liveSnap.data() || {} : {};

  await liveRef.set(
    {
      userId: ownerProfile.uid || existing.userId || "",
      userEmail: OWNER_EMAIL,
      userName: ownerProfile.name || existing.userName || "Admin",
      userPhoto:
        ownerProfile.photo ||
        existing.userPhoto ||
        "https://dummyimage.com/40x40/ccc/fff",
      mediaType: "video/url",
      mediaUrl: LIVE_STREAM_URL,
      description: existing.description || "🔴 Transmisión en vivo",
      timestamp: new Date().toISOString(),
      reactions: existing.reactions || { like: [], laugh: [], seven: [] },
      comments: existing.comments || [],
      shareCount: Number.isFinite(existing.shareCount) ? existing.shareCount : 0,
      viewCount: Number.isFinite(existing.viewCount) ? existing.viewCount : 0,
      status: "approved",
      isLive: true,
      isSpecialLive: true,
    },
    { merge: true },
  );
}

async function handleCheckStream(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const now = Date.now();
  const streamCacheFresh =
    streamStatusCache.checkedAt &&
    now - streamStatusCache.checkedAt < STREAM_CHECK_CACHE_MS;

  const streamPromise = streamCacheFresh
    ? Promise.resolve(streamStatusCache.data)
    : detectLiveStatus();

  const [streamData, ownerProfile] = await Promise.all([
    streamPromise,
    getOwnerProfileCached(),
  ]);

  if (!streamCacheFresh) {
    streamStatusCache = {
      checkedAt: Date.now(),
      data: streamData || { live: false },
    };
  }

  const live = !!(streamData && streamData.live);
  if (live) {
    syncLivePost(ownerProfile).catch((error) => {
      console.warn("[WARN] No se pudo sincronizar post live:", error);
    });
  }

  return res.status(200).json({ live, ownerProfile, livePostId: LIVE_POST_ID });
}
