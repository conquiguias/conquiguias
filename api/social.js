// api/social.js - VERSIÓN OPTIMIZADA SIN SUBIDA DE ARCHIVOS
import admin from "firebase-admin";
import { createClient } from "@supabase/supabase-js";

const IMGUR_CLIENT_ID = process.env.IMGUR_CLIENT_ID;

// 🔐 Admin emails - ONLY from environment variables (NEVER hardcoded)
const OWNER_EMAIL = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
const ADMIN_EMAILS_LIST = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

// Combine and deduplicate
const ADMIN_EMAILS = Array.from(new Set(
  [OWNER_EMAIL, ...ADMIN_EMAILS_LIST].filter(Boolean)
));

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

// 🔐 Supabase credentials - ONLY from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('ERROR: SUPABASE_URL y SUPABASE_KEY son requeridos en variables de entorno');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TASK_REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;
const TASK_REMINDER_KIND = "task_due_24h";
const APP_BASE_URL = process.env.APP_BASE_URL || "https://conquiguias.xyz";
const REMINDER_TIMEZONE = String(
  process.env.REMINDER_TIMEZONE || process.env.APP_TIMEZONE || "America/Mexico_City",
).trim() || "America/Mexico_City";
const REMINDER_HOUR_LOCAL = Number.isFinite(Number.parseInt(String(process.env.REMINDER_HOUR_LOCAL || "0"), 10))
  ? Math.min(23, Math.max(0, Number.parseInt(String(process.env.REMINDER_HOUR_LOCAL || "0"), 10)))
  : 0;
const ADMIN_NOTES_TABLE = "admin_shared_notes";
const ADMIN_NOTES_ROW_ID = "global";
const ADMIN_NOTES_MAX_HTML = 2_000_000;
const ADMIN_NOTES_MAX_FILE_NAME = 180;

// 🔐 Add security headers to all API responses
function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Strict-Transport-Security", "max-age=31536000");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
}

export default async function handler(req, res) {
  // 🔐 Apply security headers to all responses
  setSecurityHeaders(res);
  
  // 🔐 CORS - Restrict to allowed origins only (NOT wildcard)
  const allowedOrigin = process.env.APP_BASE_URL || "https://conquiguias.xyz";
  const origin = req.headers.origin || allowedOrigin;
  const isAllowed = origin === allowedOrigin || origin.endsWith(".vercel.app");
  
  if (isAllowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Credentials", "true");
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
      case "get-paypal-donations":
        await handleGetPaypalDonations(req, res);
        break;
      case "track-platform-visit":
        await handleTrackPlatformVisit(req, res);
        break;
      case "get-platform-analytics":
        await handleGetPlatformAnalytics(req, res);
        break;
      case "get-admin-notes":
        await handleGetAdminNotes(req, res);
        break;
      case "save-admin-notes":
        await handleSaveAdminNotes(req, res);
        break;
      case "upsert-notification-token":
        await handleUpsertNotificationToken(req, res);
        break;
      case "disable-notification-token":
        await handleDisableNotificationToken(req, res);
        break;
      case "send-task-reminders":
        await handleSendTaskReminders(req, res);
        break;
      case "send-test-notification":
        await handleSendTestNotification(req, res);
        break;
      case "notify-post-approved":
        await handleNotifyPostApproved(req, res);
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

async function handleGetPaypalDonations(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const decodedToken = await requireAuthenticated(req);
    const userId = decodedToken.uid;
    const type = String(req.query?.type || "user").toLowerCase();

    const rawLimit = Number.parseInt(String(req.query?.limit || "25"), 10);
    const safeLimit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(rawLimit, 100))
      : 25;

    const db = admin.firestore();
    let query = db.collection("donaciones_paypal");

    // Si type=user, filtrar por usuario actual (sin requerir admin)
    // Si type=all o cualquier otra cosa, requerir admin y devolver todas
    if (type === "user") {
      // Usuario puede ver solo sus donaciones
      query = query.where("donorUserId", "==", userId).limit(safeLimit);
    } else {
      // Solo admin/owner puede ver todas
      await requireAdminOrOwner(req);
      query = query.orderBy("approvedAt", "desc").limit(safeLimit);
    }

    const snapshot = await query.get();

    let donations = snapshot.docs.map((docSnap) => {
      const data = docSnap.data() || {};
      return {
        id: docSnap.id,
        subscriptionId: String(data.subscriptionId || docSnap.id || "").trim(),
        planId: String(data.planId || "").trim(),
        provider: String(data.provider || "paypal").trim(),
        intent: String(data.intent || "subscription").trim(),
        status: String(data.status || "approved").trim(),
        donorUserId: String(data.donorUserId || "").trim(),
        donorEmail: normalizeEmail(data.donorEmail || ""),
        donorName: String(data.donorName || "").trim(),
        isGuestSession: !!data.isGuestSession,
        approvedAt: String(data.approvedAt || "").trim(),
        updatedAt: data.updatedAt || null,
      };
    });

    // Si es el usuario filtrando sus donaciones, ordenar en cliente (para evitar índice compuesto)
    if (type === "user") {
      donations.sort((a, b) => {
        const dateA = new Date(a.approvedAt || 0);
        const dateB = new Date(b.approvedAt || 0);
        return dateB.getTime() - dateA.getTime();
      });
    }

    return res.status(200).json({
      success: true,
      count: donations.length,
      donations,
    });
  } catch (error) {
    console.error("Error obteniendo donaciones PayPal:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "Error al obtener donaciones",
    });
  }
}

function getAnalyticsDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sanitizeVisitorKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const safe = raw.replace(/[^a-zA-Z0-9:_-]/g, "_");
  return safe.slice(0, 180);
}

function sanitizeAdminNotesPayload(input = {}) {
  const html = String(input?.html || "");
  const fileNameRaw = String(input?.fileName || "Sin título").trim();
  const fileName = fileNameRaw.slice(0, ADMIN_NOTES_MAX_FILE_NAME) || "Sin título";
  const zoomValue = Number.parseInt(String(input?.zoom ?? "100"), 10);
  const zoom = Number.isFinite(zoomValue) ? Math.min(300, Math.max(50, zoomValue)) : 100;
  const wrap = input?.wrap !== false;

  if (html.length > ADMIN_NOTES_MAX_HTML) {
    const error = new Error("El contenido de notas excede el tamaño permitido");
    error.statusCode = 413;
    throw error;
  }

  return { html, fileName, zoom, wrap };
}

async function handleTrackPlatformVisit(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const body = req.body || {};
    const visitorKey = sanitizeVisitorKey(body.visitorKey);
    if (!visitorKey) {
      return res.status(400).json({ success: false, error: "visitorKey es requerido" });
    }

    const db = admin.firestore();
    const dateKey = getAnalyticsDateKey(new Date());
    const summaryRef = db.collection("analytics_daily").doc(dateKey);
    const uniqueVisitorRef = summaryRef.collection("visitors").doc(visitorKey);

    let countedUnique = false;

    await db.runTransaction(async (transaction) => {
      const uniqueVisitorSnap = await transaction.get(uniqueVisitorRef);
      const summaryPayload = {
        dateKey,
        totalVisits: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (!uniqueVisitorSnap.exists) {
        countedUnique = true;
        summaryPayload.uniqueVisits = admin.firestore.FieldValue.increment(1);
        transaction.set(uniqueVisitorRef, {
          visitorKey,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      transaction.set(summaryRef, summaryPayload, { merge: true });
    });

    return res.status(200).json({
      success: true,
      dateKey,
      countedUnique,
    });
  } catch (error) {
    console.error("Error registrando visita de plataforma:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "No se pudo registrar la visita",
    });
  }
}

async function handleGetPlatformAnalytics(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    await requireAdminOrOwner(req);

    const db = admin.firestore();
    const snapshot = await db.collection("analytics_daily").get();

    const rows = snapshot.docs
      .map((docSnap) => {
        const data = docSnap.data() || {};
        return {
          dateKey: String(data.dateKey || docSnap.id || "").trim(),
          totalVisits: Number(data.totalVisits) || 0,
          uniqueVisits: Number(data.uniqueVisits) || 0,
          newRegistrations: Number(data.newRegistrations) || 0,
        };
      })
      .filter((row) => !!row.dateKey)
      .sort((a, b) => String(a.dateKey || "").localeCompare(String(b.dateKey || "")));

    return res.status(200).json({
      success: true,
      rows,
    });
  } catch (error) {
    console.error("Error obteniendo analíticas de plataforma:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "No se pudieron obtener las analíticas",
    });
  }
}

async function handleGetAdminNotes(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    await requireAdminOrOwner(req);

    const { data, error } = await supabase
      .from(ADMIN_NOTES_TABLE)
      .select("id, html, file_name, zoom, wrap, updated_at, updated_by")
      .eq("id", ADMIN_NOTES_ROW_ID)
      .maybeSingle();

    if (error) {
      throw new Error(`No se pudieron cargar notas admin desde Supabase: ${error.message}`);
    }

    const payload = data
      ? {
        html: String(data.html || ""),
        fileName: String(data.file_name || "Sin título"),
        zoom: Number(data.zoom) || 100,
        wrap: data.wrap !== false,
        updatedAt: data.updated_at || null,
        updatedBy: data.updated_by || null,
      }
      : {
        html: "",
        fileName: "Sin título",
        zoom: 100,
        wrap: true,
        updatedAt: null,
        updatedBy: null,
      };

    return res.status(200).json({
      success: true,
      notes: payload,
    });
  } catch (error) {
    console.error("Error obteniendo notas admin:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "No se pudieron obtener las notas admin",
    });
  }
}

async function handleSaveAdminNotes(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const body = req.body || {};
    const actorEmail = await requireAdminOrOwner(req, body);
    const payload = sanitizeAdminNotesPayload(body);

    const upsertPayload = {
      id: ADMIN_NOTES_ROW_ID,
      html: payload.html,
      file_name: payload.fileName,
      zoom: payload.zoom,
      wrap: payload.wrap,
      updated_at: new Date().toISOString(),
      updated_by: actorEmail,
    };

    const { data, error } = await supabase
      .from(ADMIN_NOTES_TABLE)
      .upsert(upsertPayload, { onConflict: "id" })
      .select("id, html, file_name, zoom, wrap, updated_at, updated_by")
      .single();

    if (error) {
      throw new Error(`No se pudieron guardar notas admin en Supabase: ${error.message}`);
    }

    return res.status(200).json({
      success: true,
      notes: {
        html: String(data?.html || ""),
        fileName: String(data?.file_name || "Sin título"),
        zoom: Number(data?.zoom) || 100,
        wrap: data?.wrap !== false,
        updatedAt: data?.updated_at || null,
        updatedBy: data?.updated_by || actorEmail,
      },
    });
  } catch (error) {
    console.error("Error guardando notas admin:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "No se pudieron guardar las notas admin",
    });
  }
}

function notificationTokenDocId(token) {
  const normalizedToken = String(token || "").trim();
  const encoded = Buffer.from(normalizedToken)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return `tok_${encoded.slice(0, 400)}`;
}

function reminderDocId(formId, email, kind = TASK_REMINDER_KIND) {
  const base = `${String(formId || "").trim()}__${normalizeEmail(email)}__${kind}`;
  return base.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 500);
}

function isCronSecretAuthorized(req) {
  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  if (!cronSecret) return false;

  const authHeader =
    String(req.headers?.authorization || req.headers?.Authorization || "").trim();
  if (!authHeader) return false;

  return authHeader === `Bearer ${cronSecret}`;
}

async function resolveReminderJobAccess(req) {
  if (isCronSecretAuthorized(req)) {
    return { mode: "cron", actor: "vercel-cron" };
  }

  const actor = await requireAdminOrOwner(req);
  return { mode: "admin", actor };
}

function normalizeTaskDeadline(formData = {}) {
  const taskConfig = formData?.tarea || {};
  return (
    taskConfig?.fechaFin ||
    formData?.fechaCierre ||
    null
  );
}

function getHourInTimeZone(date, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const hourPart = parts.find((part) => part.type === "hour")?.value;
    const parsed = Number.parseInt(String(hourPart || ""), 10);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 23) {
      return parsed;
    }
  } catch (_error) {
    // Ignore invalid timezone and fallback to UTC
  }

  return date.getUTCHours();
}

function shouldRunTaskReminderCronNow(date = new Date()) {
  const localHour = getHourInTimeZone(date, REMINDER_TIMEZONE);
  return localHour === REMINDER_HOUR_LOCAL;
}

async function fetchPendingTaskReminders() {
  const { data: forms, error: formsError } = await supabase
    .from("formularios")
    .select("id, data");

  if (formsError) {
    throw new Error(`No se pudieron leer formularios: ${formsError.message}`);
  }

  const { data: responsesRows, error: responsesError } = await supabase
    .from("respuestas")
    .select("especialidad_id, contenido_respuestas");

  if (responsesError) {
    throw new Error(`No se pudieron leer respuestas: ${responsesError.message}`);
  }

  const { data: evaluationsRows, error: evaluationsError } = await supabase
    .from("evaluaciones")
    .select("especialidad_id, contenido_tareas");

  if (evaluationsError) {
    throw new Error(`No se pudieron leer evaluaciones: ${evaluationsError.message}`);
  }

  const responsesByForm = new Map(
    (responsesRows || []).map((item) => [item.especialidad_id, item]),
  );
  const evalByForm = new Map(
    (evaluationsRows || []).map((item) => [item.especialidad_id, item]),
  );

  const now = Date.now();
  const reminders = [];

  for (const row of forms || []) {
    const formId = String(row?.id || "").trim();
    const formData = row?.data || {};
    const taskConfig = formData?.tarea || null;
    const taskIsActive = !!taskConfig?.activa;

    if (!formId || !taskIsActive) continue;

    const deadlineRaw = normalizeTaskDeadline(formData);
    if (!deadlineRaw) continue;

    const deadlineDate = new Date(deadlineRaw);
    if (Number.isNaN(deadlineDate.getTime())) continue;

    const msRemaining = deadlineDate.getTime() - now;
    if (msRemaining <= 0 || msRemaining > TASK_REMINDER_WINDOW_MS) continue;

    const responses =
      responsesByForm.get(formId)?.contenido_respuestas || [];
    const taskSubmissions =
      evalByForm.get(formId)?.contenido_tareas || {};

    const participants = new Map();

    for (const record of Array.isArray(responses) ? responses : []) {
      const email = normalizeEmail(record?.correo || "");
      if (!email) continue;

      const visitId = String(record?.visitanteId || "").trim();
      const current = participants.get(email) || {
        visitanteIds: new Set(),
      };

      if (visitId) current.visitanteIds.add(visitId);
      participants.set(email, current);
    }

    for (const [email, participant] of participants.entries()) {
      const alreadySubmittedByEmail = !!taskSubmissions[email];
      const alreadySubmittedById = Array.from(participant.visitanteIds).some(
        (id) => !!taskSubmissions[id],
      );

      if (alreadySubmittedByEmail || alreadySubmittedById) {
        continue;
      }

      reminders.push({
        kind: TASK_REMINDER_KIND,
        formId,
        title: String(formData?.titulo || formId).trim(),
        email,
        deadlineISO: deadlineDate.toISOString(),
      });
    }
  }

  return reminders;
}

async function getActiveTokenDocsForEmails(db, emails) {
  const normalizedEmails = Array.from(
    new Set((emails || []).map((item) => normalizeEmail(item)).filter(Boolean)),
  );

  if (!normalizedEmails.length) {
    return [];
  }

  const results = [];
  const chunkSize = 10;

  for (let index = 0; index < normalizedEmails.length; index += chunkSize) {
    const batch = normalizedEmails.slice(index, index + chunkSize);
    const snap = await db
      .collection("notification_tokens")
      .where("email", "in", batch)
      .get();

    snap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      if (data.enabled === false) return;
      const token = String(data.token || "").trim();
      const email = normalizeEmail(data.email || "");
      if (!token || !email) return;
      results.push({
        docId: docSnap.id,
        token,
        email,
      });
    });
  }

  return results;
}

async function handleUpsertNotificationToken(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const body = req.body || {};
    const requester = await requireAuthenticated(req, body);
    const token = String(body.token || "").trim();

    if (!token || token.length < 20) {
      return res.status(400).json({ success: false, error: "Token inválido" });
    }

    const tokenDocId = notificationTokenDocId(token);
    const db = admin.firestore();
    const tokenRef = db.collection("notification_tokens").doc(tokenDocId);

    await tokenRef.set(
      {
        token,
        uid: requester.uid,
        email: requester.email,
        enabled: true,
        permission: String(body.permission || "granted").trim(),
        userAgent: String(body.userAgent || "").trim().slice(0, 500),
        platform: String(body.platform || "web").trim().slice(0, 80),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return res.status(200).json({
      success: true,
      tokenDocId,
    });
  } catch (error) {
    console.error("Error guardando token de notificación:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "No se pudo guardar el token",
    });
  }
}

async function handleDisableNotificationToken(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const body = req.body || {};
    const requester = await requireAuthenticated(req, body);
    const token = String(body.token || "").trim();
    const db = admin.firestore();

    if (token) {
      const docId = notificationTokenDocId(token);
      await db.collection("notification_tokens").doc(docId).set(
        {
          enabled: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          disabledBy: requester.email,
        },
        { merge: true },
      );
    } else {
      const snap = await db
        .collection("notification_tokens")
        .where("uid", "==", requester.uid)
        .get();

      const updates = snap.docs.map((docSnap) =>
        docSnap.ref.set(
          {
            enabled: false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            disabledBy: requester.email,
          },
          { merge: true },
        ),
      );
      await Promise.all(updates);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error desactivando token de notificación:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "No se pudo desactivar el token",
    });
  }
}

async function handleSendTaskReminders(req, res) {
  if (!["GET", "POST"].includes(req.method || "")) {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const access = await resolveReminderJobAccess(req);

    if (access.mode === "cron" && !shouldRunTaskReminderCronNow()) {
      return res.status(200).json({
        success: true,
        mode: access.mode,
        actor: access.actor,
        sent: 0,
        skippedBySchedule: true,
        timezone: REMINDER_TIMEZONE,
        targetHour: REMINDER_HOUR_LOCAL,
        message: "Cron ejecutado fuera de la hora configurada para recordatorios",
      });
    }

    const db = admin.firestore();

    const reminders = await fetchPendingTaskReminders();
    if (!reminders.length) {
      return res.status(200).json({
        success: true,
        mode: access.mode,
        actor: access.actor,
        scanned: 0,
        sent: 0,
        message: "No hay recordatorios pendientes en la ventana de 24h",
      });
    }

    const alreadySent = new Set();
    const uniqueEmails = new Set();
    const remindersToSend = [];

    for (const reminder of reminders) {
      const sentRef = db
        .collection("task_reminder_notifications")
        .doc(reminderDocId(reminder.formId, reminder.email, reminder.kind));
      const sentSnap = await sentRef.get();
      if (sentSnap.exists) {
        alreadySent.add(reminder.email);
        continue;
      }

      uniqueEmails.add(reminder.email);
      remindersToSend.push(reminder);
    }

    if (!remindersToSend.length) {
      return res.status(200).json({
        success: true,
        mode: access.mode,
        actor: access.actor,
        scanned: reminders.length,
        sent: 0,
        skippedAlreadyNotified: reminders.length,
      });
    }

    const tokenDocs = await getActiveTokenDocsForEmails(db, Array.from(uniqueEmails));
    const tokensByEmail = new Map();
    tokenDocs.forEach((entry) => {
      const list = tokensByEmail.get(entry.email) || [];
      list.push(entry);
      tokensByEmail.set(entry.email, list);
    });

    let sentCount = 0;
    let invalidTokenCount = 0;

    for (const reminder of remindersToSend) {
      const tokenEntries = tokensByEmail.get(reminder.email) || [];
      if (!tokenEntries.length) continue;

      const message = {
        tokens: tokenEntries.map((entry) => entry.token),
        notification: {
          title: `⏰ Tarea por vencer: ${reminder.title}`,
          body: "Tu tarea vence en menos de 24 horas. Entra ahora para enviarla.",
        },
        data: {
          type: reminder.kind,
          formId: reminder.formId,
          title: reminder.title,
          deadlineISO: reminder.deadlineISO,
          url: "/panel",
        },
        webpush: {
          fcmOptions: {
            link: `${APP_BASE_URL}/panel`,
          },
        },
      };

      const result = await admin.messaging().sendEachForMulticast(message);
      if (result.successCount > 0) {
        sentCount += result.successCount;
      }

      const invalidDocIds = [];
      result.responses.forEach((responseItem, index) => {
        if (responseItem.success) return;
        const code = String(responseItem.error?.code || "");
        if (
          code.includes("registration-token-not-registered") ||
          code.includes("invalid-registration-token")
        ) {
          invalidDocIds.push(tokenEntries[index]?.docId);
        }
      });

      if (invalidDocIds.length) {
        invalidTokenCount += invalidDocIds.length;
        await Promise.all(
          invalidDocIds
            .filter(Boolean)
            .map((docId) =>
              db.collection("notification_tokens").doc(docId).set(
                {
                  enabled: false,
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                  disabledBy: "fcm-invalid-token",
                },
                { merge: true },
              ),
            ),
        );
      }

      const logRef = db
        .collection("task_reminder_notifications")
        .doc(reminderDocId(reminder.formId, reminder.email, reminder.kind));

      await logRef.set(
        {
          kind: reminder.kind,
          formId: reminder.formId,
          email: reminder.email,
          title: reminder.title,
          deadlineISO: reminder.deadlineISO,
          sentAt: admin.firestore.FieldValue.serverTimestamp(),
          triggeredBy: access.actor,
          triggeredMode: access.mode,
          successCount: result.successCount,
          failureCount: result.failureCount,
        },
        { merge: true },
      );
    }

    return res.status(200).json({
      success: true,
      mode: access.mode,
      actor: access.actor,
      scanned: reminders.length,
      queued: remindersToSend.length,
      sent: sentCount,
      invalidTokensDisabled: invalidTokenCount,
      alreadyNotified: reminders.length - remindersToSend.length,
    });
  } catch (error) {
    console.error("Error enviando recordatorios de tareas:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "No se pudieron enviar recordatorios de tareas",
    });
  }
}

async function handleSendTestNotification(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const body = req.body || {};
    const requester = await requireAuthenticated(req, body);
    const db = admin.firestore();

    const rawTargetEmail = normalizeEmail(body.targetEmail || requester.email || "");
    if (!rawTargetEmail) {
      return res.status(400).json({ success: false, error: "No se encontró correo destino" });
    }

    const isSelfTarget = rawTargetEmail === requester.email;
    if (!isSelfTarget) {
      await requireAdminOrOwner(req, body);
    }

    const title = String(body.title || "🔔 Notificación de prueba").trim().slice(0, 120);
    const message = String(
      body.message || "Push de prueba enviado correctamente desde Conquiguias World."
    ).trim().slice(0, 300);
    const targetUrl = String(body.url || "/panel").trim() || "/panel";

    const tokenDocs = await getActiveTokenDocsForEmails(db, [rawTargetEmail]);
    if (!tokenDocs.length) {
      return res.status(200).json({
        success: true,
        sent: 0,
        targetEmail: rawTargetEmail,
        message: "No hay tokens push activos para este usuario",
      });
    }

    const pushMessage = {
      tokens: tokenDocs.map((entry) => entry.token),
      notification: {
        title,
        body: message,
      },
      data: {
        type: "test_notification",
        url: targetUrl,
        requestedBy: requester.email || "",
      },
      webpush: {
        fcmOptions: {
          link: `${APP_BASE_URL}${targetUrl.startsWith("/") ? targetUrl : `/${targetUrl}`}`,
        },
      },
    };

    const result = await admin.messaging().sendEachForMulticast(pushMessage);

    const invalidDocIds = [];
    result.responses.forEach((responseItem, index) => {
      if (responseItem.success) return;
      const code = String(responseItem.error?.code || "");
      if (
        code.includes("registration-token-not-registered") ||
        code.includes("invalid-registration-token")
      ) {
        invalidDocIds.push(tokenDocs[index]?.docId);
      }
    });

    if (invalidDocIds.length) {
      await Promise.all(
        invalidDocIds
          .filter(Boolean)
          .map((docId) =>
            db.collection("notification_tokens").doc(docId).set(
              {
                enabled: false,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                disabledBy: "fcm-invalid-token",
              },
              { merge: true },
            ),
          ),
      );
    }

    await db.collection("push_test_notifications").add({
      targetEmail: rawTargetEmail,
      title,
      message,
      url: targetUrl,
      requestedBy: requester.email || "",
      successCount: result.successCount,
      failureCount: result.failureCount,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({
      success: true,
      targetEmail: rawTargetEmail,
      sent: result.successCount,
      failed: result.failureCount,
      invalidTokensDisabled: invalidDocIds.length,
    });
  } catch (error) {
    console.error("Error enviando notificación de prueba:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "No se pudo enviar notificación de prueba",
    });
  }
}

async function handleNotifyPostApproved(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const body = req.body || {};
    const actorEmail = await requireAdminOrOwner(req, body);
    const postId = String(body.postId || "").trim();

    if (!postId) {
      return res.status(400).json({ success: false, error: "postId requerido" });
    }

    const db = admin.firestore();
    const postRef = db.collection("posts").doc(postId);
    const postSnap = await postRef.get();

    if (!postSnap.exists) {
      return res.status(404).json({ success: false, error: "Publicación no encontrada" });
    }

    const postData = postSnap.data() || {};
    const status = String(postData.status || "").trim().toLowerCase();
    if (status !== "approved") {
      return res.status(200).json({
        success: true,
        sent: 0,
        postId,
        message: "La publicación aún no está aprobada",
      });
    }

    const targetEmail = normalizeEmail(postData.userEmail || "");
    if (!targetEmail) {
      return res.status(200).json({
        success: true,
        sent: 0,
        postId,
        message: "La publicación no tiene correo de autor",
      });
    }

    const tokenDocs = await getActiveTokenDocsForEmails(db, [targetEmail]);
    if (!tokenDocs.length) {
      return res.status(200).json({
        success: true,
        sent: 0,
        postId,
        targetEmail,
        message: "No hay tokens push activos para el autor",
      });
    }

    const authorName = String(postData.userName || "").trim();
    const title = "✅ Tu publicación fue aprobada";
    const bodyMessage = authorName
      ? `${authorName}, tu publicación ya está visible para todos.`
      : "Tu publicación ya está visible para todos.";

    const pushMessage = {
      tokens: tokenDocs.map((entry) => entry.token),
      notification: {
        title,
        body: bodyMessage,
      },
      data: {
        type: "post_approved",
        postId,
        url: "/panel",
      },
      webpush: {
        fcmOptions: {
          link: `${APP_BASE_URL}/panel`,
        },
      },
    };

    const result = await admin.messaging().sendEachForMulticast(pushMessage);

    const invalidDocIds = [];
    result.responses.forEach((responseItem, index) => {
      if (responseItem.success) return;
      const code = String(responseItem.error?.code || "");
      if (
        code.includes("registration-token-not-registered") ||
        code.includes("invalid-registration-token")
      ) {
        invalidDocIds.push(tokenDocs[index]?.docId);
      }
    });

    if (invalidDocIds.length) {
      await Promise.all(
        invalidDocIds
          .filter(Boolean)
          .map((docId) =>
            db.collection("notification_tokens").doc(docId).set(
              {
                enabled: false,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                disabledBy: "fcm-invalid-token",
              },
              { merge: true },
            ),
          ),
      );
    }

    await db.collection("post_approval_notifications").add({
      postId,
      targetEmail,
      triggeredBy: actorEmail,
      successCount: result.successCount,
      failureCount: result.failureCount,
      invalidTokensDisabled: invalidDocIds.length,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({
      success: true,
      postId,
      targetEmail,
      sent: result.successCount,
      failed: result.failureCount,
      invalidTokensDisabled: invalidDocIds.length,
    });
  } catch (error) {
    console.error("Error enviando notificación de aprobación:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "No se pudo enviar notificación de aprobación",
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
  data: { email: OWNER_EMAIL, name: "Admin", photo: "", uid: "", age: null },
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

  const profile = { email: OWNER_EMAIL, name: "Admin", photo: "", uid: "", age: null };

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
        const age = Number.parseInt(String(d.edad ?? "").trim(), 10);
        if (Number.isFinite(age)) profile.age = age;
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
      userIsOwner: true,
      userIsAdmin: true,
      userIsInstructor: true,
      userIsPremium: true,
      userEdad:
        Number.isFinite(ownerProfile.age)
          ? ownerProfile.age
          : Number.isFinite(existing.userEdad)
            ? existing.userEdad
            : null,
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
