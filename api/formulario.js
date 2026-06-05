const { createClient } = require("@supabase/supabase-js");
const admin = require("firebase-admin");
const busboy = require("busboy");
const crypto = require("crypto");

// 🔐 Configuración Supabase - SOLO desde variables de entorno
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('ERROR: SUPABASE_URL y SUPABASE_KEY son requeridos en variables de entorno');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 🔐 Admin emails - cargar SOLO desde variables de entorno (nunca hardcoded)
const OWNER_EMAIL = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
const ADMIN_EMAILS_LIST = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

// Combinar y deduplicar
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
  });
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function maskEmailPartial(value) {
  const email = normalizeEmail(value);
  if (!email) return "";

  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return email;

  const visible = localPart.slice(0, 2);
  const hiddenLength = Math.max(3, localPart.length - 2);
  return `${visible}${"*".repeat(hiddenLength)}@${domain}`;
}

function maskNamePartial(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0];

  return `${parts[0]} ${parts
    .slice(1)
    .map((part) => "*".repeat(Math.max(3, part.length)))
    .join(" ")}`;
}

function maskPublicUserData(record = {}, requester = {}) {
  if (!record || typeof record !== "object") return record;

  const requesterEmail = normalizeEmail(requester?.email || "");
  const requesterUid = String(requester?.visitanteId || "").trim();
  const recordEmail = normalizeEmail(record?.correo || record?.email || "");
  const recordUid = String(record?.visitanteId || "").trim();
  const isOwnRecord =
    (!!requesterEmail && !!recordEmail && requesterEmail === recordEmail) ||
    (!!requesterUid && !!recordUid && requesterUid === recordUid);

  if (isOwnRecord) return { ...record };

  const masked = { ...record };
  if (Object.prototype.hasOwnProperty.call(masked, "nombre")) {
    masked.nombre = maskNamePartial(masked.nombre);
  }
  if (Object.prototype.hasOwnProperty.call(masked, "correo")) {
    masked.correo = maskEmailPartial(masked.correo);
  }
  if (Object.prototype.hasOwnProperty.call(masked, "email")) {
    masked.email = maskEmailPartial(masked.email);
  }

  return masked;
}

const TASK_PDF_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;
const SECURITY_RATE_LIMITS_COLLECTION = "security_rate_limits";

function getRequesterIp(req) {
  const forwardedFor = String(req?.headers?.["x-forwarded-for"] || "").trim();
  if (forwardedFor) {
    return String(forwardedFor.split(",")[0] || "").trim();
  }
  return String(req?.socket?.remoteAddress || "").trim();
}

function getRateLimitDocId(scope, key) {
  const payload = `${String(scope || "").trim()}::${String(key || "").trim()}`;
  return crypto.createHash("sha256").update(payload).digest("hex");
}

async function consumePersistentRateLimit(scope, key, limit, windowMs) {
  const safeScope = String(scope || "").trim();
  const safeKey = String(key || "").trim();
  if (!safeScope || !safeKey) return;

  const maxRequests = Math.max(1, Number(limit) || 1);
  const ttlWindowMs = Math.max(1000, Number(windowMs) || 60 * 1000);
  const now = Date.now();

  const db = admin.firestore();
  const docRef = db
    .collection(SECURITY_RATE_LIMITS_COLLECTION)
    .doc(getRateLimitDocId(safeScope, safeKey));

  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(docRef);
    const data = snap.exists ? snap.data() || {} : {};

    const previousWindowStart = Number(data.windowStartMs || 0);
    const previousCount = Number(data.count || 0);
    const stillInWindow = previousWindowStart > 0 && now - previousWindowStart < ttlWindowMs;

    const nextCount = stillInWindow ? previousCount + 1 : 1;
    const nextWindowStart = stillInWindow ? previousWindowStart : now;

    if (nextCount > maxRequests) {
      const error = new Error("Demasiados intentos. Intenta más tarde");
      error.statusCode = 429;
      throw error;
    }

    transaction.set(
      docRef,
      {
        scope: safeScope,
        keyHash: getRateLimitDocId("key", safeKey),
        windowStartMs: nextWindowStart,
        count: nextCount,
        expiresAtMs: nextWindowStart + ttlWindowMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
}

async function withFreshTaskSignedUrl(task) {
  if (!task || typeof task !== "object") return task;

  const normalizedTask = { ...task };
  const storagePath = String(task.storagePath || "").trim();
  if (!storagePath) return normalizedTask;

  const { data: signedUrlData, error: signError } = await supabase.storage
    .from("tareas-pdf")
    .createSignedUrl(storagePath, TASK_PDF_SIGNED_URL_TTL_SECONDS);

  if (signError) {
    console.warn("[WARN] No se pudo refrescar signed URL de tarea:", {
      storagePath,
      message: signError.message,
    });
    normalizedTask.url = "";
    return normalizedTask;
  }

  normalizedTask.url = signedUrlData?.signedUrl || "";
  return normalizedTask;
}

async function withFreshTasksSignedUrls(tasksMap) {
  const entries = Object.entries(tasksMap || {});
  if (entries.length === 0) return {};

  const refreshedEntries = await Promise.all(
    entries.map(async ([ident, task]) => [ident, await withFreshTaskSignedUrl(task)]),
  );

  return Object.fromEntries(refreshedEntries);
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

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1";
  }
  return false;
}

function normalizeAsistenciasActivas(rawState = {}) {
  const state = {
    1: toBoolean(rawState?.[1] ?? rawState?.["1"]),
    2: toBoolean(rawState?.[2] ?? rawState?.["2"]),
  };

  return state;
}

async function verifyAuthenticatedUserFromBody(body = {}) {
  const token =
    getBearerToken({ headers: body?.__headers || {} }) ||
    String(body?.idToken || "").trim();
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

async function verifyAuthenticatedUser(req) {
  const body = req?.body || {};
  return verifyAuthenticatedUserFromBody({
    ...body,
    __headers: req?.headers || {},
  });
}

function resolveRequesterFromPublicPayload(req) {
  const body = req?.body || {};
  const query = req?.query || {};

  const email = normalizeEmail(body?.email || query?.email || "");
  const uid = String(body?.visitanteId || query?.visitanteId || "").trim();

  if (!email && !uid) return null;

  return {
    uid,
    email,
  };
}

async function resolveRequesterForResponses(req) {
  try {
    return await verifyAuthenticatedUser(req);
  } catch (_error) {
    const fallbackRequester = resolveRequesterFromPublicPayload(req);
    if (fallbackRequester) return fallbackRequester;

    const error = new Error("Token de autenticación o identificador requerido");
    error.statusCode = 401;
    throw error;
  }
}

function isAdminEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  return getAdminEmails().includes(normalized);
}

function resolveAdminSessionSecret() {
  return String(
    process.env.ADMIN_SESSION_SECRET ||
      process.env.FIREBASE_PRIVATE_KEY ||
      process.env.FIREBASE_PRIVATE_KEY_ID ||
      "",
  ).trim();
}

function decodeBase64Url(value) {
  const normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  return Buffer.from(padded, "base64").toString("utf8");
}

function signAdminSessionPayload(payloadJson, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(payloadJson)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function verifyAdminSessionToken(token) {
  const rawToken = String(token || "").trim();
  if (!rawToken) return null;

  const secret = resolveAdminSessionSecret();
  if (!secret) return null;

  const [payloadEncoded, signature] = rawToken.split(".");
  if (!payloadEncoded || !signature) return null;

  let payloadJson;
  let payload;
  try {
    payloadJson = decodeBase64Url(payloadEncoded);
    payload = JSON.parse(payloadJson);
  } catch (_error) {
    return null;
  }

  const expectedSignature = signAdminSessionPayload(payloadJson, secret);
  if (signature !== expectedSignature) return null;

  const exp = Number(payload?.exp || 0);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;

  const email = normalizeEmail(payload?.email || "");
  if (!isAdminEmail(email)) return null;

  return {
    uid: "",
    email,
  };
}

async function verifyAdminOrOwner(req, body = {}) {
  let requester = null;

  try {
    requester = await verifyAuthenticatedUserFromBody({
      ...body,
      __headers: req?.headers || {},
    });
  } catch (_error) {
    const adminSessionToken =
      req?.headers?.["x-admin-session"] ||
      req?.headers?.["X-Admin-Session"] ||
      body?.adminSessionToken ||
      "";
    requester = verifyAdminSessionToken(adminSessionToken);
  }

  if (!requester) {
    const error = new Error("Token de autenticación requerido");
    error.statusCode = 401;
    throw error;
  }

  if (!isAdminEmail(requester.email)) {
    const error = new Error("No autorizado");
    error.statusCode = 403;
    throw error;
  }

  return requester;
}

// Cache en memoria simple para Serverless (persiste mientras la instancia esté caliente)
const memoryCache = new Map();
const CACHE_TTL = 60 * 1000; // 1 minuto por defecto para datos dinámicos
const CACHE_TTL_STATIC = 5 * 60 * 1000; // 5 minutos para datos estáticos (imágenes, evaluaciones)

// 🔐 Add security headers to all API responses
function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Strict-Transport-Security", "max-age=31536000");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
}

// 🔐 Set CORS headers
function setCORSHeaders(req, res) {
  const primaryOrigin = process.env.APP_BASE_URL || "https://conquiguias.xyz";
  const extraOrigins = String(process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const allowedOrigins = Array.from(new Set([primaryOrigin, ...extraOrigins]));

  const origin = String(req.headers.origin || "").trim();
  const isAllowed = !!origin && allowedOrigins.includes(origin);

  if (isAllowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version");
}

module.exports = async function handler(req, res) {
  // 🔐 Apply security headers and CORS
  setSecurityHeaders(res);
  setCORSHeaders(req, res);
  
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  
  const { action } = req.query;
  // Repositorio SOLO para datos binarios
  const repo = "conquiguias/conquiguias-data";

  try {
    if (req.method === "GET") {
      switch (action) {
        case "obtenerFormulario":
          await handleObtenerFormulario(req, res);
          break;
        case "listarFormularios":
          await handleListarFormularios(req, res);
          break;
        case "listarImagenes":
          await handleListarImagenes(req, res, repo);
          break;
        case "obtenerEvaluacion":
          await handleObtenerEvaluacion(req, res);
          break;
        case "verRespuestas":
          await handleVerRespuestas(req, res);
          break;
        case "listarEntregas":
          await handleListarEntregas(req, res);
          break;
        case "listarArchivosPDF":
          await handleListarArchivosPDF(req, res, repo);
          break;
        case "listarFormulariosPendientes":
          await handleListarFormulariosPendientes(req, res);
          break;
        default:
          res.status(400).json({ error: `Acción GET no válida: ${action}` });
          break;
      }
    } else if (req.method === "POST") {
      switch (action) {
        case "guardar":
          await handleGuardar(req, res);
          break;
        case "guardarEvaluacion":
          await handleGuardarEvaluacion(req, res);
          break;
        case "guardarFormulario":
          await handleGuardarFormulario(req, res);
          break;
        case "guardarResultadoExamen":
          await handleGuardarResultadoExamen(req, res);
          break;
        case "limpiarFormulariosVencidos":
          await handleLimpiarFormulariosVencidos(req, res);
          break;
        case "subirImagen":
          await handleSubirImagen(req, res, repo);
          break;
        case "actualizarEstadoAsistencia":
          await handleActualizarEstadoAsistencia(req, res);
          break;
        case "eliminarFormulario":
          await handleEliminarFormulario(req, res);
          break;
        case "subirTarea":
          await handleSubirTarea(req, res, repo);
          break;
        case "calificarTareas":
          await handleCalificarTareas(req, res);
          break;
        case "obtenerEstadoUsuario":
          await handleObtenerEstadoUsuario(req, res);
          break;
        case "verRespuestas":
          await handleVerRespuestas(req, res);
          break;
        case "eliminarImagen":
          await handleEliminarImagen(req, res, repo);
          break;
        case "eliminarTodasTareasPDF":
          await handleEliminarTodasTareasPDF(req, res, repo);
          break;
        case "eliminarTareasPDF":
          await handleEliminarTareasPDF(req, res, repo);
          break;
        case "restaurarTareasPDF":
          await handleRestaurarTareasPDF(req, res, repo);
          break;
        case "verificarIntentoExamen":
          await handleVerificarIntentoExamen(req, res);
          break;
        default:
          res.status(400).json({ error: `Acción POST no válida: ${action}` });
          break;
      }
    } else {
      res.setHeader("Allow", "GET, POST");
      res.status(405).json({ error: "Method Not Allowed" });
    }
  } catch (error) {
    console.error("Error en API formulario:", error);
    const statusCode = Number(error?.statusCode) || 500;
    if (statusCode >= 400 && statusCode < 500) {
      return res.status(statusCode).json({ error: error.message });
    }
    res
      .status(500)
      .json({ error: "Error interno del servidor: " + error.message });
  }
};

// --- HANDLERS (Migrados a Supabase con la misma lógica) ---

async function handleListarFormularios(req, res) {
  await verifyAuthenticatedUser(req);

  const { data, error } = await supabase
    .from("formularios")
    .select("id, data")
    .order("creado", { ascending: false });
  if (error) throw error;

  // Convertimos al formato original: Objeto { "ID": { ...datos } }
  const forms = {};
  if (data) data.forEach((item) => (forms[item.id] = item.data));
  res.status(200).json(forms);
}

async function handleObtenerFormulario(req, res) {
  const { id } = req.query;
  const { data, error } = await supabase
    .from("formularios")
    .select("data")
    .eq("id", id)
    .single();

  if (error || !data)
    return res.status(404).json({ error: "Formulario no encontrado" });

  const form = data.data;
  const fechaCierreValor = form?.tarea?.fechaFin || form?.fechaCierre || null;
  const fechaCierre = fechaCierreValor ? new Date(fechaCierreValor) : null;
  const fechaValida = fechaCierre && !Number.isNaN(fechaCierre.getTime());
  const estado =
    fechaValida && new Date() > fechaCierre ? "cerrado" : "abierto";

  // Devolvemos el JSON exacto que espera el frontend
  res.status(200).json({
    ...form,
    id, // Asegurar que el ID va
    estado,
    asistenciasActivas: normalizeAsistenciasActivas(form.asistenciasActivas),
  });
}

async function handleObtenerEvaluacion(req, res) {
  const { id } = req.query;
  const { data, error } = await supabase
    .from("evaluaciones")
    .select("contenido_evaluacion")
    .eq("especialidad_id", id)
    .single();

  // Retornar array vacío si no hay evaluación (igual que el original)
  if ((error && error.code !== "PGRST116") || !data)
    return res.status(200).json([]);
  res.status(200).json(data.contenido_evaluacion || []);
}

async function handleVerRespuestas(req, res) {
  const requesterAuth = await resolveRequesterForResponses(req);
  const { id } = req.query;
  const requesterEmail = normalizeEmail(requesterAuth?.email || "");
  const requesterVisitanteId = String(requesterAuth?.uid || "").trim();

  // Consultas paralelas a las tablas "respuestas" y "evaluaciones"
  const { data: respData } = await supabase
    .from("respuestas")
    .select("contenido_respuestas")
    .eq("especialidad_id", id)
    .single();
  const { data: evalData } = await supabase
    .from("evaluaciones")
    .select("contenido_resultados, contenido_tareas")
    .eq("especialidad_id", id)
    .single();

  const asistenciasRaw = Array.isArray(respData?.contenido_respuestas)
    ? respData.contenido_respuestas
    : [];
  const examenesRaw = Array.isArray(evalData?.contenido_resultados)
    ? evalData.contenido_resultados
    : [];
  const tareasRaw =
    evalData?.contenido_tareas && typeof evalData.contenido_tareas === "object"
      ? evalData.contenido_tareas
      : {};

  const requester = {
    email: requesterEmail,
    visitanteId: requesterVisitanteId,
  };

  const asistenciasPublicas = asistenciasRaw.map((item) => maskPublicUserData(item, requester));
  const examenesPublicos = examenesRaw.map((item) => maskPublicUserData(item, requester));
  const tareasPublicas = {};
  Object.entries(tareasRaw).forEach(([key, value]) => {
    tareasPublicas[key] = maskPublicUserData(value, requester);
  });

  res.status(200).json({
    asistencias: asistenciasPublicas,
    examenes: examenesPublicos,
    tareas: tareasPublicas,
  });
}

async function handleListarEntregas(req, res) {
  await verifyAdminOrOwner(req);

  const { id } = req.query;
  const { data, error } = await supabase
    .from("evaluaciones")
    .select("contenido_tareas")
    .eq("especialidad_id", id)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  const tareasConUrlRefrescada = await withFreshTasksSignedUrls(
    data?.contenido_tareas || {},
  );
  res.status(200).json(tareasConUrlRefrescada);
}

async function handleListarFormulariosPendientes(req, res) {
  await verifyAdminOrOwner(req);

  const { data: evalData, error } = await supabase
    .from("evaluaciones")
    .select("especialidad_id, contenido_tareas");
  if (error) throw error;

  const { data: respuestasData, error: respuestasError } = await supabase
    .from("respuestas")
    .select("especialidad_id, contenido_respuestas");
  if (respuestasError) throw respuestasError;

  const asistieronPrimeraPorEspecialidad = {};
  if (respuestasData) {
    respuestasData.forEach((item) => {
      const registros = Array.isArray(item?.contenido_respuestas)
        ? item.contenido_respuestas
        : [];
      const asistentesUnicos = new Set();

      registros.forEach((registro) => {
        if (Number(registro?.asistenciaNumero) !== 1) return;
        const correo = normalizeEmail(registro?.correo || "");
        const visitanteId = String(registro?.visitanteId || "").trim();
        const uniqueKey = correo || visitanteId;
        if (!uniqueKey) return;
        asistentesUnicos.add(uniqueKey);
      });

      asistieronPrimeraPorEspecialidad[item?.especialidad_id] =
        asistentesUnicos.size;
    });
  }

  // Necesitamos el título desde formularios
  const { data: formData } = await supabase
    .from("formularios")
    .select("id, titulo");
  const titulos = {};
  if (formData) formData.forEach((f) => (titulos[f.id] = f.titulo));

  const pendientes = [];
  if (evalData) {
    evalData.forEach((item) => {
      const tareas = item.contenido_tareas || {};
      let count = 0;
      let calificadas = 0;
      let total = 0;

      Object.values(tareas).forEach((t) => {
        if (t) {
          const estado = String(t.estado || "").trim().toLowerCase();
          if (estado === "devuelta") {
            return;
          }

          total++;
          if (estado === "calificado") {
            calificadas++;
          } else if (estado === "entregado") {
            count++;
          }
        }
      });

      if (count > 0) {
        pendientes.push({
          id: item.especialidad_id,
          titulo: titulos[item.especialidad_id] || item.especialidad_id,
          asistieron:
            asistieronPrimeraPorEspecialidad[item.especialidad_id] || 0,
          pendientes: count,
          calificadas: calificadas,
          total: total,
        });
      }
    });
  }
  res.status(200).json(pendientes);
}

// --- HANDLERS POST (Lógica idéntica pero guardando en Supabase) ---

async function handleGuardarFormulario(req, res) {
  await verifyAdminOrOwner(req, req.body || {});

  const {
    id,
    titulo,
    fechaCierre,
    evaluation,
    imagenEspecialidad,
    imagenFirma1,
    imagenFirma2,
    imagenFirma3,
    tomaAsistencia,
    tarea,
  } = req.body;

  // Logica original de construcción de objeto
  const nuevoForm = {
    titulo,
    creado: new Date().toISOString(),
    tieneEvaluacion: !!(evaluation && evaluation.length > 0),
    tomaAsistencia: tomaAsistencia !== undefined ? tomaAsistencia : true,
    tarea: tarea || null,
    asistenciasActivas: { 1: false, 2: false },
    imagenEspecialidad: imagenEspecialidad || null,
    imagenFirma1: imagenFirma1 || null,
    imagenFirma2: imagenFirma2 || null,
    imagenFirma3: imagenFirma3 || null,
  };

  if (fechaCierre) {
    nuevoForm.fechaCierre = fechaCierre;
  }

  // Guardar en 'formularios' (sobrescribir ID si existe, lógica upsert)
  const { error } = await supabase.from("formularios").upsert({
    id,
    titulo, // Columna helper
    creado: nuevoForm.creado, // Columna helper de orden
    data: nuevoForm, // JSON completo
  });
  if (error) throw new Error("Error guardando formulario: " + error.message);

  // Si hay evaluación, guardar en tabla 'evaluaciones'
  if (evaluation && evaluation.length > 0) {
    await supabase.from("evaluaciones").upsert({
      especialidad_id: id,
      contenido_evaluacion: evaluation,
    });
  }

  res
    .status(200)
    .json({ ok: true, message: "Formulario creado exitosamente", id });
}

async function handleGuardar(req, res) {
  const {
    id,
    nombre,
    correo,
    edad,
    telefono,
    asociacion,
    visitanteId,
    asistenciaNumero,
  } = req.body;

  const asistenciaNum = Number(asistenciaNumero);
  const correoNormalizado = (correo || "").trim().toLowerCase();
  const ip = getRequesterIp(req) || "unknown";
  const visitanteKey = String(visitanteId || "").trim();

  if (!id) {
    return res.status(400).json({ error: "❌ Falta el ID del formulario." });
  }

  if (![1, 2].includes(asistenciaNum)) {
    return res
      .status(400)
      .json({ error: "❌ Número de asistencia inválido (solo 1 o 2)." });
  }

  if (!correoNormalizado) {
    return res.status(400).json({ error: "❌ El correo es obligatorio." });
  }

  if (asistenciaNum === 1 && !(nombre || "").trim()) {
    return res
      .status(400)
      .json({
        error: "❌ El nombre es obligatorio para la primera asistencia.",
      });
  }

  await consumePersistentRateLimit("guardar_asistencia_ip", ip, 20, 10 * 60 * 1000);
  await consumePersistentRateLimit(
    "guardar_asistencia_email_form",
    `${id}::${correoNormalizado}`,
    6,
    10 * 60 * 1000,
  );
  if (visitanteKey) {
    await consumePersistentRateLimit(
      "guardar_asistencia_visitante_form",
      `${id}::${visitanteKey}`,
      8,
      10 * 60 * 1000,
    );
  }

  // 1. Verificar estado activo desde Supabase
  const { data: formData, error: fErr } = await supabase
    .from("formularios")
    .select("data")
    .eq("id", id)
    .single();
  if (fErr || !formData) throw new Error("Formulario no encontrado");

  if (!formData.data.asistenciasActivas?.[asistenciaNum]) {
    return res
      .status(403)
      .json({ error: "❌ La asistencia no está activa en este momento." });
  }

  // 2. Leer array actual de respuestas
  const { data: rData } = await supabase
    .from("respuestas")
    .select("contenido_respuestas")
    .eq("especialidad_id", id)
    .single();
  let registros = rData?.contenido_respuestas || [];

  const misRegistros = registros.filter(
    (r) => (r.correo || "").trim().toLowerCase() === correoNormalizado,
  );
  const registroPrimera = misRegistros.find(
    (r) => Number(r.asistenciaNumero) === 1,
  );
  const misAsistencias = new Set(
    misRegistros
      .map((r) => Number(r.asistenciaNumero))
      .filter((n) => [1, 2].includes(n)),
  );

  const visitanteIdCanonico =
    registroPrimera?.visitanteId ||
    misRegistros.find((r) => r.visitanteId)?.visitanteId ||
    visitanteId;

  if (asistenciaNum === 2 && !misAsistencias.has(1)) {
    return res.status(400).json({
      error:
        "❌ No registraste primera asistencia, perdiste la especialidad. Vuelve a intentar en otro momento.",
    });
  }

  if (misAsistencias.has(asistenciaNum)) {
    const duplicateMsg =
      asistenciaNum === 1
        ? "❌ Ya se encuentra registrada la primera asistencia para este correo."
        : "❌ Ya se encuentra registrada la segunda asistencia para este correo.";

    return res.status(200).json({
      ok: true,
      message: duplicateMsg,
      correo: correoNormalizado,
      visitanteId: visitanteIdCanonico,
      misAsistencias: Array.from(misAsistencias).sort((a, b) => a - b),
    });
  }

  if (misAsistencias.size >= 2) {
    return res.status(400).json({
      error: "❌ Ya completaste el máximo de asistencias permitidas (2).",
    });
  }

  const fecha = new Date().toISOString();
  const visitanteIdRegistro =
    asistenciaNum === 2 ? visitanteIdCanonico : visitanteId;

  const nuevoRegistro =
    asistenciaNum === 1
      ? {
          nombre: nombre.trim(),
          correo: correoNormalizado,
          edad: edad || "",
          telefono: telefono || "",
          asociacion: asociacion || "",
          fecha,
          visitanteId: visitanteIdRegistro,
          asistenciaNumero: asistenciaNum,
        }
      : {
          correo: correoNormalizado,
          fecha,
          visitanteId: visitanteIdRegistro,
          asistenciaNumero: asistenciaNum,
          id,
        };

  registros.push(nuevoRegistro);
  misAsistencias.add(asistenciaNum);

  // Guardar array actualizado
  await supabase
    .from("respuestas")
    .upsert({ especialidad_id: id, contenido_respuestas: registros });

  res.status(200).json({
    ok: true,
    message: "✅ Asistencia registrada correctamente.",
    correo: correoNormalizado,
    visitanteId: visitanteIdRegistro,
    misAsistencias: Array.from(misAsistencias).sort((a, b) => a - b),
  });
}

async function handleGuardarEvaluacion(req, res) {
  await verifyAdminOrOwner(req, req.body || {});

  const { id, evaluation } = req.body;
  await supabase
    .from("evaluaciones")
    .upsert({ especialidad_id: id, contenido_evaluacion: evaluation });
  res
    .status(200)
    .json({ ok: true, message: "✅ Evaluación guardada correctamente." });
}

async function handleVerificarIntentoExamen(req, res) {
  const { id, visitanteId } = req.body;

  // Leer formulario para obtener intentos configurados
  const { data: fData } = await supabase
    .from("formularios")
    .select("data")
    .eq("id", id)
    .single();

  if (!fData) return res.status(404).json({ ok: false, error: "Formulario no encontrado" });

  const data = { ...fData.data };

  // Si no existe el atributo intentos, crearlo con valor 1
  if (data.intentos === undefined || data.intentos === null) {
    data.intentos = 1;
    await supabase.from("formularios").update({ data }).eq("id", id);
  }

  const intentosPermitidos = data.intentos;

  // Contar intentos del usuario
  const { data: exData } = await supabase
    .from("evaluaciones")
    .select("contenido_resultados")
    .eq("especialidad_id", id)
    .single();

  const resultados = exData?.contenido_resultados || [];
  const misResultados = resultados.filter(
    (r) => r.visitanteId === visitanteId
  );
  const intentosUsados = misResultados.length;
  const haAprobado = misResultados.some(
    (r) => parseFloat(r.puntaje) >= 70
  );
  const puedeHacerExamen = !haAprobado && intentosUsados < intentosPermitidos;

  res.json({
    ok: true,
    intentosPermitidos,
    intentosUsados,
    puedeHacerExamen,
    haAprobado,
  });
}

async function handleGuardarResultadoExamen(req, res) {
  const { id, visitanteId, respuestas, puntaje, email } = req.body;

  // Validar límite de intentos
  const { data: fData } = await supabase
    .from("formularios")
    .select("data")
    .eq("id", id)
    .single();
  const intentosPermitidos = fData?.data?.intentos || 1;

  const { data: exData } = await supabase
    .from("evaluaciones")
    .select("contenido_resultados")
    .eq("especialidad_id", id)
    .single();
  let resultados = exData?.contenido_resultados || [];

  const misIntentos = resultados.filter(
    (r) => r.visitanteId === visitanteId
  );
  const intento = misIntentos.length + 1;

  if (intento > intentosPermitidos) {
    return res.status(400).json({ ok: false, error: "Límite de intentos alcanzado" });
  }

  resultados.push({
    visitanteId,
    respuestas,
    puntaje,
    fecha: new Date().toISOString(),
    correo: email || null,
    intento,
  });

  await supabase
    .from("evaluaciones")
    .upsert({ especialidad_id: id, contenido_resultados: resultados });
  res
    .status(200)
    .json({ ok: true, message: "✅ Examen enviado correctamente.", puntaje, intento });
}

async function handleActualizarEstadoAsistencia(req, res) {
  await verifyAdminOrOwner(req, req.body || {});

  const { id, asistencia, activo } = req.body;

  const { data: fData } = await supabase
    .from("formularios")
    .select("data")
    .eq("id", id)
    .single();
  if (!fData) return res.status(404).json({ error: "No encontrado" });

  const nuevoData = { ...fData.data };
  const asistenciaNumero = Number(asistencia);
  if (![1, 2].includes(asistenciaNumero)) {
    return res.status(400).json({ error: "Número de asistencia inválido" });
  }

  const estadoActual = normalizeAsistenciasActivas(nuevoData.asistenciasActivas);
  estadoActual[asistenciaNumero] = toBoolean(activo);
  nuevoData.asistenciasActivas = normalizeAsistenciasActivas(estadoActual);

  await supabase.from("formularios").update({ data: nuevoData }).eq("id", id);
  res
    .status(200)
    .json({ ok: true, asistenciasActivas: nuevoData.asistenciasActivas });
}

async function handleCalificarTareas(req, res) {
  try {
    const requester = await verifyAdminOrOwner(req, req.body || {});
    const { id, tareas, targetVisitanteId } = req.body || {};
    const requesterEmail = normalizeEmail(requester?.email || "");
    const isOwner = requesterEmail === normalizeEmail(OWNER_EMAIL);

    if (!id || !tareas || typeof tareas !== "object") {
      return res
        .status(400)
        .json({ error: "Payload inválido para calificar tareas" });
    }

    const targetId = String(targetVisitanteId || "").trim();
    const targetData =
      targetId && tareas[targetId] && typeof tareas[targetId] === "object"
        ? tareas[targetId]
        : null;
    const targetEmail = normalizeEmail(
      targetData?.email || (targetId.includes("@") ? targetId : ""),
    );
    const adminEmails = getAdminEmails();
    const isTargetAdmin = !!targetEmail && adminEmails.includes(targetEmail);
    const isTargetSelfByEmail =
      !!targetEmail && !!requesterEmail && targetEmail === requesterEmail;
    const isTargetSelfByUid = false;
    const isTargetSelf = isTargetSelfByEmail || isTargetSelfByUid;

    if (!isOwner && isTargetSelf) {
      return res.status(403).json({
        error: "Solo el propietario puede evaluarse a sí mismo",
      });
    }

    if (!isOwner && isTargetAdmin) {
      return res.status(403).json({
        error: "Solo el propietario puede calificar a administradores",
      });
    }

    await supabase
      .from("evaluaciones")
      .upsert({ especialidad_id: id, contenido_tareas: tareas });

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Error en calificarTareas:", error);
    res.status(error.statusCode || 500).json({
      error: error.message || "Error interno al calificar tareas",
    });
  }
}

async function handleEliminarFormulario(req, res) {
  await verifyAdminOrOwner(req, req.body || {});

  const { id } = req.body;
  // Borrado en cascada manual (aunque FKs podrian hacerlo, aqui aseguramos)
  await supabase.from("respuestas").delete().eq("especialidad_id", id);
  await supabase.from("evaluaciones").delete().eq("especialidad_id", id);
  await supabase.from("formularios").delete().eq("id", id);
  res
    .status(200)
    .json({ ok: true, message: "Formulario eliminado correctamente" });
}

async function handleLimpiarFormulariosVencidos(req, res) {
  await verifyAdminOrOwner(req, req.body || {});

  const { data: forms } = await supabase
    .from("formularios")
    .select("id, creado");
  const ahora = new Date();
  const vencidos = [];

  if (forms) {
    forms.forEach((f) => {
      if ((ahora - new Date(f.creado)) / (1000 * 60 * 60 * 24) >= 90)
        vencidos.push(f.id);
    });
  }

  if (vencidos.length > 0) {
    await supabase.from("respuestas").delete().in("especialidad_id", vencidos);
    await supabase
      .from("evaluaciones")
      .delete()
      .in("especialidad_id", vencidos);
    await supabase.from("formularios").delete().in("id", vencidos);
  }

  res.status(200).json({
    mensaje: `🧹 Formularios vencidos eliminados: ${vencidos.join(", ")}`,
    total: vencidos.length,
  });
}

// --- HANDLERS HIBRIDOS (GitHub para binarios, Supabase para lógica) ---

async function handleListarImagenes(req, res, repo) {
  const { carpeta } = req.query;
  const url = `https://api.github.com/repos/${repo}/contents/images/${carpeta}?ref=main`;
  const resp = await fetch(url, {
    headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` },
  });

  if (!resp.ok) return res.status(200).json([]); // Vacío si error

  const files = await resp.json();
  const imgs = Array.isArray(files)
    ? files
        .filter((f) => f.type === "file")
        .map((f) => ({
          nombre: f.name,
          url: f.download_url,
          ruta: f.path,
        }))
    : [];
  res.status(200).json(imgs);
}

async function handleSubirImagen(req, res, repo) {
  await verifyAdminOrOwner(req, req.body || {});

  const { carpeta, nombre, contenido } = req.body;
  const path = `images/${encodeURIComponent(carpeta)}/${encodeURIComponent(nombre)}`;

  await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: "PUT",
    headers: {
      Authorization: `token ${process.env.GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: `Subir img ${nombre}`,
      content: contenido,
      branch: "main",
    }),
  });

  res.status(200).json({
    ok: true,
    message: "✅ Imagen subida",
    url: `https://raw.githubusercontent.com/${repo}/main/${path}`,
  });
}

async function handleEliminarImagen(req, res, repo) {
  await verifyAdminOrOwner(req, req.body || {});

  const { carpeta, nombre } = req.body;
  const path = `images/${carpeta}/${nombre}`;

  const get = await fetch(
    `https://api.github.com/repos/${repo}/contents/${path}?ref=main`,
    { headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` } },
  );
  if (get.ok) {
    const d = await get.json();
    await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      method: "DELETE",
      headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` },
      body: JSON.stringify({ message: "Del img", sha: d.sha, branch: "main" }),
    });
  }
  res.status(200).json({ ok: true });
}

async function handleListarArchivosPDF(req, res, repo) {
  await verifyAdminOrOwner(req);

  // Leer PDFs desde metadatos guardados en Supabase
  const { data: formData } = await supabase
    .from("formularios")
    .select("id, titulo");
  const titulos = {};
  (formData || []).forEach((f) => {
    titulos[f.id] = f.titulo || f.id;
  });

  const { data: evalData } = await supabase
    .from("evaluaciones")
    .select("especialidad_id, contenido_tareas");
  
  const pdfs = [];
  if (evalData) {
    evalData.forEach((item) => {
      const tareas = item.contenido_tareas || {};
      Object.entries(tareas).forEach(([ident, tarea]) => {
        if (tarea && tarea.storagePath && tarea.url) {
          pdfs.push({
            nombre: tarea.nombreArchivoOriginal || `${ident}.pdf`,
            ruta: tarea.storagePath,
            url: tarea.url,
            tamano: tarea.tamano || 0,
            especialidadId: item.especialidad_id,
            especialidadNombre: titulos[item.especialidad_id] || item.especialidad_id,
            ident: ident,
          });
        }
      });
    });
  }
  res.status(200).json(pdfs);
}

// Actualizado: recibe archivo vía FormData, lo sube a Supabase Storage (privado)
async function handleSubirTarea(req, res, repo) {
  try {
    // Parsear multipart/form-data usando busboy
    const bb = busboy({ headers: req.headers });
    const fields = {};
    let fileBuffer = null;
    let fileName = '';

    await new Promise((resolve, reject) => {
      bb.on('file', (name, stream, info) => {
        if (name === 'file') {
          const chunks = [];
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', () => {
            fileBuffer = Buffer.concat(chunks);
            fileName = info.filename;
          });
          stream.on('error', reject);
        }
      });

      bb.on('field', (name, value) => {
        fields[name] = value;
      });

      bb.on('close', resolve);
      bb.on('error', reject);

      req.pipe(bb);
    });

    // Validar que se recibió el archivo
    if (!fileBuffer || fileBuffer.length === 0) {
      return res.status(400).json({ error: "Ningún archivo fue recibido" });
    }

    const { id, visitanteId, email } = fields;
    if (!id) {
      return res.status(400).json({ error: "ID de especialidad requerido" });
    }

    // Generar ruta de almacenamiento
    const ident = (email || visitanteId || 'usuario').replace(/[^a-zA-Z0-9._@-]/g, '_');
    const storagePath = `tareas/${id}/${ident}.pdf`;

    // Subir a Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('tareas-pdf')
      .upload(storagePath, fileBuffer, {
        contentType: 'application/pdf',
        upsert: false
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      if (uploadError.message.includes('already exists')) {
        return res.status(400).json({ error: 'Ya entregaste una tarea para esta especialidad' });
      }
      return res.status(500).json({ error: 'Error al subir: ' + uploadError.message });
    }

    // Crear URL firmada (7 días)
    const { data: signedUrl, error: signError } = await supabase.storage
      .from('tareas-pdf')
      .createSignedUrl(storagePath, 7 * 24 * 60 * 60);

    if (signError) {
      console.error('Signed URL error:', signError);
      return res.status(500).json({ error: 'Error al generar descarga' });
    }

    // Guardar metadatos en Supabase
    const { data: evalData } = await supabase
      .from("evaluaciones")
      .select("contenido_tareas")
      .eq("especialidad_id", id)
      .single();

    const tareas = evalData?.contenido_tareas || {};
    tareas[ident] = {
      estado: "entregado",
      fecha: new Date().toISOString(),
      url: signedUrl?.signedUrl || '',
      storagePath,
      nota: null,
      nombreArchivoOriginal: fileName,
      tamano: fileBuffer.length,
    };

    await supabase
      .from("evaluaciones")
      .upsert({ especialidad_id: id, contenido_tareas: tareas });

    res.status(200).json({ ok: true, message: "Tarea enviada correctamente" });

  } catch (error) {
    console.error('handleSubirTarea error:', error.message);
    res.status(500).json({ error: error.message });
  }
}

async function handleEliminarTodasTareasPDF(req, res, repo) {
  await verifyAdminOrOwner(req, req.body || {});

  let eliminados = 0;
  let errores = 0;

  try {
    // Leer todos los metadatos de tareas
    const { data: evalData } = await supabase
      .from("evaluaciones")
      .select("especialidad_id, contenido_tareas");
    
    const pathsAEliminar = [];
    
    if (evalData) {
      evalData.forEach((item) => {
        const tareas = item.contenido_tareas || {};
        Object.entries(tareas).forEach(([ident, tarea]) => {
          if (tarea && tarea.storagePath) {
            pathsAEliminar.push(tarea.storagePath);
          }
        });
      });
    }

    // Eliminar archivos de Supabase Storage
    if (pathsAEliminar.length > 0) {
      const { error } = await supabase.storage
        .from('tareas-pdf')
        .remove(pathsAEliminar);
      
      if (error) {
        console.error('Error eliminando archivos de Storage:', error);
        errores = pathsAEliminar.length;
      } else {
        eliminados = pathsAEliminar.length;
      }
    }

    res.status(200).json({ ok: true, eliminados, errores });
  } catch (e) {
    console.error('Error en eliminación masiva:', e);
    res.status(500).json({ error: e.message });
  }
}

// ===== Restaurar tareas: asigna nota 100 a usuarios que hicieron el examen =====
async function handleRestaurarTareasPDF(req, res, repo) {
  await verifyAdminOrOwner(req, req.body || {});

  try {
    // Cargar especialidades que tienen tareas activas
    const { data: formsData } = await supabase
      .from("formularios")
      .select("id, data");

    const especialidadesConTarea = new Set();
    if (Array.isArray(formsData)) {
      formsData.forEach(f => {
        if (f.data?.tarea?.activa) especialidadesConTarea.add(f.id);
      });
    }

    const { data: evalData, error: evalErr } = await supabase
      .from("evaluaciones")
      .select("especialidad_id, contenido_tareas, contenido_resultados");

    if (evalErr) throw evalErr;
    if (!Array.isArray(evalData)) return res.status(200).json({ ok: true, restauradas: 0, errores: 0, mensaje: 'No hay evaluaciones' });

    let restauradas = 0;
    let errores = 0;
    const detalles = [];

    for (const ev of evalData) {
      const espId = ev.especialidad_id;

      // Saltar especialidades que no tienen tarea activa
      if (!especialidadesConTarea.has(espId)) {
        detalles.push(`${espId}: sin tarea activa, se omite`);
        continue;
      }

      const resultados = Array.isArray(ev.contenido_resultados) ? ev.contenido_resultados : [];
      const tareasActuales = ev.contenido_tareas && typeof ev.contenido_tareas === 'object' ? ev.contenido_tareas : {};

      if (resultados.length === 0) continue;

      let modificada = false;

      for (const r of resultados) {
        const email = String(r.correo || r.email || r.visitanteId || '').trim().toLowerCase();
        if (!email) continue;

        // Si ya tiene tarea registrada (pendiente o calificada), no tocarla
        const tareaExistente = tareasActuales[email];
        if (tareaExistente && typeof tareaExistente === 'object' && tareaExistente.estado) {
          continue;
        }

        const storagePath = `tareas/${espId}/${email}.pdf`;
        tareasActuales[email] = {
          url: '',
          nota: '100',
          fecha: new Date().toISOString(),
          estado: 'calificado',
          tamano: 0,
          rubrica: {
            '1': 'excelente',
            '2': 'excelente',
            '3': 'excelente',
            '4': 'excelente',
            '5': 'excelente',
            '6': 'excelente',
            '7': 'excelente'
          },
          storagePath,
          retroalimentacion: null,
          nombreArchivoOriginal: `${email}.pdf`,
        };
        modificada = true;
      }

      if (modificada) {
        await supabase
          .from("evaluaciones")
          .update({ contenido_tareas: tareasActuales })
          .eq("especialidad_id", espId);
        restauradas++;
        const total = Object.keys(tareasActuales).length;
        detalles.push(`${espId}: ${total} tareas en total`);
      }
    }

    res.status(200).json({
      ok: true,
      restauradas,
      errores,
      mensaje: restauradas > 0
        ? `Restauradas ${restauradas} especialidades con tarea activa. Usuarios con examen ahora tienen nota 100.`
        : 'No se encontraron usuarios con examen que necesiten restauración.',
      detalles
    });
  } catch (e) {
    console.error('Error restaurando tareas:', e);
    res.status(500).json({ error: e.message });
  }
}

async function handleEliminarTareasPDF(req, res, repo) {
  await verifyAdminOrOwner(req, req.body || {});

  const { ruta, ident, especialidadId } = req.body;

  const normalizedRuta = String(ruta || "").trim();
  const normalizedIdent = String(ident || "").trim();
  const normalizedEspecialidadId = String(especialidadId || "").trim();

  if (!normalizedRuta && (!normalizedIdent || !normalizedEspecialidadId)) {
    return res.status(400).json({
      error:
        "Se requiere ruta o combinación especialidadId+ident para eliminar la entrega",
    });
  }

  try {
    // Eliminar archivo de Supabase Storage (si se indicó ruta)
    if (normalizedRuta) {
      const { error: deleteError } = await supabase.storage
        .from('tareas-pdf')
        .remove([normalizedRuta]);

      if (deleteError) {
        return res.status(500).json({ error: deleteError.message || "Error al eliminar en Storage" });
      }
    }

    // Actualizar metadatos: marcar como devuelta para que el alumno vea
    // "Pendiente (tarea devuelta, enviar de nuevo)" y pueda reenviar.
    if (normalizedEspecialidadId && normalizedIdent) {
      const { data: evData } = await supabase
        .from("evaluaciones")
        .select("contenido_tareas")
        .eq("especialidad_id", normalizedEspecialidadId)
        .single();

      const tareas = evData?.contenido_tareas || {};
      const prevTask =
        tareas[normalizedIdent] && typeof tareas[normalizedIdent] === "object"
          ? tareas[normalizedIdent]
          : {};
      const inferredEmail =
        normalizeEmail(prevTask.email || "") ||
        (normalizedIdent.includes("@") ? normalizedIdent : "");

      tareas[normalizedIdent] = {
        ...prevTask,
        estado: "devuelta",
        nota: null,
        url: "",
        storagePath: "",
        fechaDevuelta: new Date().toISOString(),
        fecha: prevTask?.fecha || new Date().toISOString(),
        email: inferredEmail || prevTask.email || null,
      };

      await supabase
        .from("evaluaciones")
        .upsert({
          especialidad_id: normalizedEspecialidadId,
          contenido_tareas: tareas,
        });
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

async function handleObtenerEstadoUsuario(req, res) {
  const requester = await verifyAuthenticatedUser(req);
  const requesterEmail = normalizeEmail(requester?.email || "");
  const requesterUid = String(requester?.uid || "").trim();
  const canQueryAnyUser = isAdminEmail(requesterEmail);

  const requestedVisitanteId = String(req.body?.visitanteId || "").trim();
  const requestedEmail = normalizeEmail(req.body?.email || "");
  const visitanteId = canQueryAnyUser
    ? requestedVisitanteId
    : requesterUid;
  const email = canQueryAnyUser
    ? requestedEmail
    : requesterEmail;

  // 🔧 OPTIMIZACIÓN: Modo conteo solo (para evitar traer todos los formularios)
  const countOnly = req.body?.countOnly === true || req.query?.count_only === "true";

  // Leemos TODO de Supabase de un golpe (como hacia antes con GH)
  const { data: docs } = await supabase.from("formularios").select("id, data");
  const { data: asists } = await supabase
    .from("respuestas")
    .select("especialidad_id, contenido_respuestas");
  const { data: evals } = await supabase
    .from("evaluaciones")
    .select("especialidad_id, contenido_resultados, contenido_tareas");

  const resultado = [];
  let pendingCount = 0;

  (docs || []).forEach((doc) => {
    const id = doc.id;
    const form = doc.data;

    // Filtrar mis asistencias (Paso 1: Email o ID actual)
    const aData =
      asists?.find((x) => x.especialidad_id === id)?.contenido_respuestas || [];

    let misA = aData.filter(
      (r) =>
        (email && r.correo?.toLowerCase() === email.toLowerCase()) ||
        r.visitanteId === visitanteId,
    );

    // Recolectar todos los IDs de visitante asociados a este usuario en esta especialidad
    // Esto es CRÍTICO para enlazar respuestas antiguas que solo tienen visitanteId (sin correo)
    // con respuestas nuevas que sí tienen correo.
    const allUserIds = new Set([visitanteId]);
    misA.forEach((r) => {
      if (r.visitanteId) allUserIds.add(r.visitanteId);
    });

    // Paso 2: Re-escanear asistencias usando los IDs descubiertos
    // (Ej: Encontré Asistencia 1 por correo, la cual tiene ID 'A'. Ahora busco Asistencia 2 que solo tiene ID 'A')
    if (allUserIds.size > 0 && aData.length > 0) {
      const extraA = aData.filter(
        (r) =>
          !misA.includes(r) && // Evitar duplicados
          r.visitanteId &&
          allUserIds.has(r.visitanteId),
      );
      if (extraA.length > 0) {
        misA = [...misA, ...extraA];
        // Si aparecieron nuevos IDs en estas asistencias extra, agregarlos también (aunque raro)
        extraA.forEach((r) => {
          if (r.visitanteId) allUserIds.add(r.visitanteId);
        });
      }
    }

    if (misA.length === 0) return; // Si no participó de ninguna forma, skip

    // 🔧 OPTIMIZACIÓN: Si es modo conteo, solo contar tareas pendientes sin procesar full data
    if (countOnly) {
      const eData = evals?.find((x) => x.especialidad_id === id);
      const tData = eData?.contenido_tareas || {};
      
      // Buscar tarea
      let miTarea = null;
      if (email && tData[email]) {
        miTarea = tData[email];
      } else {
        for (const uid of allUserIds) {
          if (tData[uid]) {
            miTarea = tData[uid];
            break;
          }
        }
      }

      // Contar si la tarea está activa pero no entregada
      const tareaActiva = form.tarea && form.tarea.activa;
      if (tareaActiva) {
        const estadoTarea = String(miTarea?.estado || "").trim().toLowerCase();
        const yaEntregada = estadoTarea === "entregado" || estadoTarea === "calificado";
        if (!yaEntregada) {
          pendingCount += 1;
        }
      }
      return; // No agregar a resultado en modo conteo
    }

    const nombreParticipante =
      misA.find((a) => typeof a?.nombre === "string" && a.nombre.trim() !== "")
        ?.nombre?.trim() || null;

    // Filtrar mis exámenes (usando email O cualquiera de los IDs encontrados)
    const eData = evals?.find((x) => x.especialidad_id === id);
    const resData = eData?.contenido_resultados || [];

    // Filtrar todos los intentos de este usuario
    const misE = resData.filter(
      (r) =>
        (email &&
          r.correo?.trim().toLowerCase() === email.trim().toLowerCase()) ||
        allUserIds.has(r.visitanteId),
    );

    // Mejor nota lógica (si hay múltiples intentos, quedarse con el mejor)
    let bestExam = null;
    if (misE.length > 0) {
      // Ordenar por puntaje descendente para tomar el primero como el mejor
      misE.sort((a, b) => parseFloat(b.puntaje) - parseFloat(a.puntaje));
      bestExam = misE[0];
    }

    // Mi tarea
    const tData = eData?.contenido_tareas || {};
    let miTarea = null;

    // Buscar tarea por Email o por cualquiera de los IDs
    // Prioridad: Email -> IDs encontrados
    if (email && tData[email]) {
      miTarea = tData[email];
    } else {
      for (const uid of allUserIds) {
        if (tData[uid]) {
          miTarea = tData[uid];
          break;
        }
      }
      // Fallback: Si no encontré por ID directo, buscar si algun email coincide (casos raros)
      if (!miTarea && email) {
        // Ya buscamos tData[email] arriba, esto es redundante pero seguro
      }
    }

    resultado.push({
      id,
      titulo: form.titulo,
      creado: form.creado,
      nombreParticipante,
      asistencias: misA.map((a) => a.asistenciaNumero),
      tomaAsistencia: form.tomaAsistencia,
      configTarea: form.tarea,
      miTarea: miTarea,
      configExamen: form.tieneEvaluacion,
      miExamen: bestExam,
      fechaLimiteTarea: form?.tarea?.fechaFin || form?.fechaCierre || null,
      fechaCierre: form.fechaCierre || null,
      intentosPermitidos: form.intentos || 1,
      intentosUsados: misE.length,
    });
  });

  // 🔧 OPTIMIZACIÓN: Retornar solo el contador si se solicita
  if (countOnly) {
    return res.status(200).json({ pendientes: pendingCount });
  }

  res
    .status(200)
    .json(resultado.sort((a, b) => new Date(b.creado) - new Date(a.creado)));
}
