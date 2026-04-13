const admin = require("firebase-admin");
const crypto = require("crypto");

const OWNER_EMAIL = String(process.env.OWNER_EMAIL || "")
  .trim()
  .toLowerCase();
const ADMIN_EMAILS = Array.from(
  new Set(
    [
      OWNER_EMAIL,
      ...String(process.env.ADMIN_EMAILS || "")
        .split(",")
        .map((email) => String(email || "").trim().toLowerCase())
        .filter(Boolean),
    ].filter(Boolean),
  ),
);

const AUTH_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const authRateLimitStore = new Map();
const SECURITY_RATE_LIMITS_COLLECTION = "security_rate_limits";
const FIREBASE_WEB_API_KEY = String(
  process.env.FIREBASE_API_KEY || "AIzaSyB1YTwZM8wKlxZ8HhXb7EUse8YyLmcfeS8",
).trim();

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function getRequesterIp(req) {
  const forwardedFor = String(req?.headers?.["x-forwarded-for"] || "").trim();
  if (forwardedFor) {
    return String(forwardedFor.split(",")[0] || "").trim();
  }
  return String(req?.socket?.remoteAddress || "").trim();
}

function consumeRateLimit(key, limit, windowMs = AUTH_RATE_LIMIT_WINDOW_MS) {
  const safeKey = String(key || "").trim();
  if (!safeKey) return;

  const now = Date.now();
  const existing = authRateLimitStore.get(safeKey) || {
    count: 0,
    windowStart: now,
  };

  if (now - existing.windowStart >= windowMs) {
    authRateLimitStore.set(safeKey, { count: 1, windowStart: now });
    return;
  }

  if (existing.count >= limit) {
    const error = new Error("Demasiados intentos. Intenta más tarde");
    error.statusCode = 429;
    throw error;
  }

  existing.count += 1;
  authRateLimitStore.set(safeKey, existing);
}

function isValidEmailFormat(value) {
  const email = normalizeEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateStrongPassword(value) {
  const password = String(value || "");

  if (password.length < 6) {
    return {
      ok: false,
      message: "La contraseña debe tener al menos 6 caracteres",
    };
  }

  if (!/[A-Z]/.test(password)) {
    return {
      ok: false,
      message: "La contraseña debe incluir al menos una letra mayúscula",
    };
  }

  if (!/[a-z]/.test(password)) {
    return {
      ok: false,
      message: "La contraseña debe incluir al menos una letra minúscula",
    };
  }

  if (!/\d/.test(password)) {
    return {
      ok: false,
      message: "La contraseña debe incluir al menos un número",
    };
  }

  if (!/[^A-Za-z0-9]/.test(password)) {
    return {
      ok: false,
      message: "La contraseña debe incluir al menos un carácter especial",
    };
  }

  return { ok: true, message: "" };
}

async function sendFirebaseOobCode({ requestType, email, idToken }) {
  const safeRequestType = String(requestType || "").trim();
  if (!safeRequestType) {
    throw new Error("requestType requerido");
  }

  if (!FIREBASE_WEB_API_KEY) {
    throw new Error("FIREBASE_API_KEY no configurado");
  }

  const payload = {
    requestType: safeRequestType,
  };

  const safeEmail = normalizeEmail(email);
  const safeIdToken = String(idToken || "").trim();

  if (safeEmail) payload.email = safeEmail;
  if (safeIdToken) payload.idToken = safeIdToken;

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const responseText = await response.text().catch(() => "");
    throw new Error(`Firebase OOB error ${response.status}: ${responseText}`);
  }
}

function timingSafeStringCompare(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  const maxLen = Math.max(a.length, b.length, 1);
  const pa = Buffer.alloc(maxLen);
  const pb = Buffer.alloc(maxLen);
  a.copy(pa);
  b.copy(pb);
  const sameBytes = crypto.timingSafeEqual(pa, pb);
  return sameBytes && a.length === b.length;
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
  const ttlWindowMs = Math.max(1000, Number(windowMs) || AUTH_RATE_LIMIT_WINDOW_MS);
  const now = Date.now();

  const db = admin.firestore();
  const docId = getRateLimitDocId(safeScope, safeKey);
  const docRef = db.collection(SECURITY_RATE_LIMITS_COLLECTION).doc(docId);

  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(docRef);
    const data = snap.exists ? snap.data() || {} : {};

    const previousWindowStart = Number(data.windowStartMs || 0);
    const previousCount = Number(data.count || 0);
    const stillInWindow = previousWindowStart > 0 && now - previousWindowStart < ttlWindowMs;

    let nextCount = stillInWindow ? previousCount + 1 : 1;
    let nextWindowStart = stillInWindow ? previousWindowStart : now;

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

function getBearerToken(req) {
  const authHeader =
    req?.headers?.authorization || req?.headers?.Authorization || "";
  if (typeof authHeader !== "string") return "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function verifyAuthUser(req, data = {}) {
  const idToken = String(data?.idToken || "").trim() || getBearerToken(req);
  if (!idToken) {
    const error = new Error("Token de autenticación requerido");
    error.statusCode = 401;
    throw error;
  }

  try {
    return await admin.auth().verifyIdToken(idToken);
  } catch (_error) {
    const error = new Error("Token de autenticación inválido");
    error.statusCode = 401;
    throw error;
  }
}

function isAdminOrOwnerEmail(email) {
  const normalized = normalizeEmail(email);
  return !!normalized && ADMIN_EMAILS.includes(normalized);
}

function resolveAdminSessionSecret() {
  return String(
    process.env.ADMIN_SESSION_SECRET ||
      process.env.FIREBASE_PRIVATE_KEY ||
      process.env.FIREBASE_PRIVATE_KEY_ID ||
      "",
  ).trim();
}

function toBase64Url(input) {
  return Buffer.from(String(input), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
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

function createAdminSessionToken(email) {
  const secret = resolveAdminSessionSecret();
  if (!secret) return "";

  const payload = {
    email: normalizeEmail(email),
    exp: Date.now() + 60 * 60 * 1000,
    ver: 1,
  };
  const payloadJson = JSON.stringify(payload);
  const payloadEncoded = toBase64Url(payloadJson);
  const signature = signAdminSessionPayload(payloadJson, secret);
  return `${payloadEncoded}.${signature}`;
}

// 🔐 Inicializar Firebase Admin
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

function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function incrementDailyAnalytics(fieldName, amount = 1) {
  const safeField = String(fieldName || "").trim();
  if (!safeField) return;

  const dateKey = getDateKey(new Date());
  await admin
    .firestore()
    .collection("analytics_daily")
    .doc(dateKey)
    .set(
      {
        dateKey,
        [safeField]: admin.firestore.FieldValue.increment(Number(amount) || 1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

module.exports = async (req, res) => {
  // 🔐 Add security headers to all responses
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Strict-Transport-Security", "max-age=31536000");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  
  // 🔐 CORS: Solo permitir orígenes explícitamente autorizados
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
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,OPTIONS,PATCH,DELETE,POST,PUT",
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization",
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const { action, data } = req.body;

    if (!action) {
      return res.status(400).json({ error: "Acción no especificada" });
    }

    // 🔹 REGISTRO DE USUARIO
    if (action === "register") {
      const {
        nombre,
        apellido,
        edad,
        sexo,
        pais,
        email,
        password,
        fotoBase64,
        fileName,
      } = data;

      const normalizedEmail = normalizeEmail(email);
      const requesterIp = getRequesterIp(req) || "unknown";

      await consumePersistentRateLimit("register_ip", requesterIp, 10, 10 * 60 * 1000);
      await consumePersistentRateLimit("register_email", normalizedEmail || "unknown", 4, 30 * 60 * 1000);

      // Validaciones
      if (!nombre || !apellido || !email || !password) {
        return res
          .status(400)
          .json({ error: "Todos los campos son obligatorios" });
      }

      if (!isValidEmailFormat(normalizedEmail)) {
        return res.status(400).json({ error: "El formato del correo electrónico no es válido" });
      }

      const passwordValidation = validateStrongPassword(password);
      if (!passwordValidation.ok) {
        return res.status(400).json({ error: passwordValidation.message });
      }

      // Crear usuario en Auth
      const userRecord = await admin.auth().createUser({
        email: normalizedEmail,
        password: password,
        displayName: `${nombre} ${apellido}`,
        emailVerified: false,
      });

      let fotoURL = null;

      // Subir foto si existe
      if (fotoBase64 && fileName) {
        const base64Data = fotoBase64.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");

        const bucket = admin.storage().bucket();
        const file = bucket.file(`usuarios/${userRecord.uid}/${fileName}`);

        await file.save(buffer, {
          metadata: {
            contentType: `image/${fileName.split(".").pop()}`,
            metadata: { firebaseStorageDownloadTokens: userRecord.uid },
          },
        });

        fotoURL = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(file.name)}?alt=media&token=${userRecord.uid}`;

        // Actualizar perfil con foto
        await admin.auth().updateUser(userRecord.uid, {
          photoURL: fotoURL,
        });
      }

      // Guardar datos en Firestore
      await admin.firestore().collection("usuarios").doc(userRecord.uid).set({
        nombre,
        apellido,
        edad,
        sexo,
        pais,
        email: normalizedEmail,
        fotoURL,
        emailVerificado: false,
        creado: admin.firestore.FieldValue.serverTimestamp(),
      });

      await incrementDailyAnalytics("newRegistrations", 1);

      return res.status(200).json({
        success: true,
        message: "Usuario registrado correctamente. Debe verificar su correo para continuar.",
        userId: userRecord.uid,
      });
    }

    // 🔹 VERIFICAR ESTADO DE USUARIO
    else if (action === "checkAuth") {
      const { uid } = data || {};
      const decodedToken = await verifyAuthUser(req, data || {});
      const requesterUid = String(decodedToken?.uid || "").trim();
      const requesterEmail = normalizeEmail(decodedToken?.email || "");
      const targetUid = String(uid || requesterUid).trim();

      if (!targetUid) {
        return res.status(400).json({ error: "UID no válido" });
      }

      const canInspectOthers = isAdminOrOwnerEmail(requesterEmail);
      if (!canInspectOthers && targetUid !== requesterUid) {
        return res.status(403).json({ error: "No autorizado" });
      }

      const user = await admin.auth().getUser(targetUid);
      const userDoc = await admin
        .firestore()
        .collection("usuarios")
        .doc(targetUid)
        .get();

      return res.status(200).json({
        authenticated: true,
        user: {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          emailVerified: user.emailVerified,
          ...userDoc.data(),
        },
      });
    }

    // 🔹 REENVIAR VERIFICACIÓN DE EMAIL
    else if (action === "resendVerification") {
      const { email, idToken } = data || {};

      const normalizedEmail = normalizeEmail(email);
      const requesterIp = getRequesterIp(req) || "unknown";
      consumeRateLimit(`resendVerification:ip:${requesterIp}`, 12);
      consumeRateLimit(`resendVerification:email:${normalizedEmail || "unknown"}`, 4);

      if (!isValidEmailFormat(normalizedEmail)) {
        return res.status(200).json({
          success: true,
          message: "Si el correo existe, se enviará un enlace de verificación",
        });
      }

      try {
        const safeIdToken = String(idToken || "").trim();
        if (safeIdToken) {
          await sendFirebaseOobCode({
            requestType: "VERIFY_EMAIL",
            idToken: safeIdToken,
          });
        }
      } catch (_error) {
        // Respuesta uniforme para evitar enumeración de cuentas
      }

      return res.status(200).json({
        success: true,
        message: "Si el correo existe, se enviará un enlace de verificación",
      });
    }

    // 🔹 RECUPERAR CONTRASEÑA
    else if (action === "resetPassword") {
      const { email } = data;

      const normalizedEmail = normalizeEmail(email);
      const requesterIp = getRequesterIp(req) || "unknown";
      consumeRateLimit(`resetPassword:ip:${requesterIp}`, 12);
      consumeRateLimit(`resetPassword:email:${normalizedEmail || "unknown"}`, 4);

      if (!isValidEmailFormat(normalizedEmail)) {
        return res.status(200).json({
          success: true,
          message: "Si el correo existe, se enviará un enlace de recuperación",
        });
      }

      try {
        await sendFirebaseOobCode({
          requestType: "PASSWORD_RESET",
          email: normalizedEmail,
        });
      } catch (_error) {
        // Respuesta uniforme para evitar enumeración de cuentas
      }

      return res.status(200).json({
        success: true,
        message: "Si el correo existe, se enviará un enlace de recuperación",
      });
    }

    // 🔹 CREAR/ACTUALIZAR PERFIL SOCIAL (GOOGLE)
    else if (action === "upsertSocialUser") {
      const { idToken } = data || {};

      if (!idToken) {
        return res.status(400).json({ error: "Token de autenticación requerido" });
      }

      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const uid = decodedToken.uid;
      const user = await admin.auth().getUser(uid);

      const displayName = (user.displayName || "").trim();
      const nameParts = displayName ? displayName.split(/\s+/) : [];
      const nombreSugerido =
        nameParts.length > 0
          ? nameParts.shift()
          : user.email
            ? user.email.split("@")[0]
            : "Usuario";
      const apellidoSugerido = nameParts.join(" ");

      const userRef = admin.firestore().collection("usuarios").doc(uid);
      const userDoc = await userRef.get();
      const existingData = userDoc.exists ? userDoc.data() || {} : {};

      const baseData = {
        email: user.email || "",
        emailVerificado: !!user.emailVerified,
        fotoURL: user.photoURL || null,
        proveedor: decodedToken.firebase?.sign_in_provider || "google.com",
        actualizado: admin.firestore.FieldValue.serverTimestamp(),
      };

      const profileData = {
        nombre: existingData.nombre || nombreSugerido,
        apellido: existingData.apellido || apellidoSugerido,
      };

      if (!userDoc.exists) {
        await userRef.set({
          ...baseData,
          ...profileData,
          edad: null,
          sexo: "",
          pais: "",
          creado: admin.firestore.FieldValue.serverTimestamp(),
        });
        await incrementDailyAnalytics("newRegistrations", 1);
      } else {
        await userRef.set(
          {
            ...baseData,
            ...profileData,
          },
          { merge: true },
        );
      }

      return res.status(200).json({
        success: true,
        message: "Perfil social sincronizado correctamente",
        userId: uid,
        isNewUser: !userDoc.exists,
      });
    }

    // 🔹 CONFIGURAR / CAMBIAR CONTRASEÑA DEL USUARIO AUTENTICADO
    else if (action === "setUserPassword") {
      const { idToken, newPassword } = data || {};

      if (!idToken || !newPassword) {
        return res
          .status(400)
          .json({ error: "Token y nueva contraseña son obligatorios" });
      }

      const passwordValidation = validateStrongPassword(newPassword);
      if (!passwordValidation.ok) {
        return res.status(400).json({ error: passwordValidation.message });
      }

      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const uid = decodedToken.uid;

      await admin.auth().updateUser(uid, {
        password: String(newPassword),
      });

      await admin
        .firestore()
        .collection("usuarios")
        .doc(uid)
        .set(
          {
            passwordConfigurada: true,
            actualizado: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );

      return res.status(200).json({
        success: true,
        message: "Contraseña actualizada correctamente",
      });
    }

    // 🔹 ELIMINAR CUENTA ACTUAL
    else if (action === "deleteCurrentUser") {
      const { idToken } = data || {};

      if (!idToken) {
        return res
          .status(400)
          .json({ error: "Token de autenticación requerido" });
      }

      const decodedToken = await admin.auth().verifyIdToken(idToken);
      const uid = decodedToken.uid;

      const userRecord = await admin.auth().getUser(uid);

      await admin.firestore().collection("usuarios").doc(uid).delete().catch(() => {
        // Si no existe el documento, continuar
      });

      try {
        const bucket = admin.storage().bucket();
        await bucket.deleteFiles({ prefix: `usuarios/${uid}/` });
      } catch (_storageError) {
        // Continuar aunque no se pueda limpiar Storage
      }

      await admin.auth().deleteUser(uid);

      return res.status(200).json({
        success: true,
        message: `Cuenta eliminada correctamente (${userRecord.email || uid})`,
      });
    }

    // 🔹 VERIFICAR CONTRASEÑA ADMIN (Simulada/Hardcoded por solicitud)
    else if (action === "verifyAdminPassword") {
      const { email, password } = data || {};
      const normalizedEmail = normalizeEmail(email);
      const serverAdminPass = String(process.env.ADMIN_PASSWORD || "");
      const requesterIp = getRequesterIp(req) || "unknown";

      consumeRateLimit(`verifyAdminPassword:ip:${requesterIp}`, 15);
      consumeRateLimit(`verifyAdminPassword:email:${normalizedEmail || "unknown"}`, 6);

      if (!serverAdminPass) {
        return res.status(503).json({ error: "ADMIN_PASSWORD no configurado" });
      }

      const isAllowedAdmin = isAdminOrOwnerEmail(normalizedEmail);
      if (!isAllowedAdmin) {
        return res.status(403).json({ error: "Correo no autorizado" });
      }

      if (timingSafeStringCompare(String(password || ""), serverAdminPass)) {
        const adminSessionToken = createAdminSessionToken(normalizedEmail);
        return res.status(200).json({ success: true, adminSessionToken });
      } else {
        return res.status(401).json({ error: "Contraseña incorrecta" });
      }
    }

    // 🔹 OBTENER CONFIGURACIÓN DE FIREBASE
    else if (action === "get-config") {
      const config = {
        apiKey:
          process.env.FIREBASE_API_KEY ||
          "AIzaSyB1YTwZM8wKlxZ8HhXb7EUse8YyLmcfeS8",
        authDomain:
          process.env.FIREBASE_AUTH_DOMAIN ||
          "conquiguias-world-85ccd.firebaseapp.com",
        projectId: process.env.FIREBASE_PROJECT_ID || "conquiguias-world-85ccd",
        storageBucket:
          process.env.FIREBASE_STORAGE_BUCKET ||
          "conquiguias-world-85ccd.firebasestorage.app",
        messagingSenderId:
          process.env.FIREBASE_MESSAGING_SENDER_ID || "785222651205",
        appId:
          process.env.FIREBASE_APP_ID ||
          "1:785222651205:web:0486c50e9d8af6bf9b022c",
        vapidKey:
          process.env.FIREBASE_WEB_PUSH_VAPID_KEY ||
          process.env.FIREBASE_VAPID_KEY ||
          "",
      };
      return res.status(200).json(config);
    } else {
      return res.status(400).json({ error: "Acción no válida" });
    }
  } catch (error) {
    console.error("Error en API auth:", error);

    const statusCode = Number(error?.statusCode) || 400;

    let errorMessage = "Error interno del servidor";
    if (error.code === "auth/email-already-exists") {
      errorMessage = "Este correo electrónico ya está registrado";
    } else if (error.code === "auth/invalid-email") {
      errorMessage = "El formato del correo electrónico no es válido";
    } else if (error.code === "auth/weak-password") {
      errorMessage = "La contraseña debe tener al menos 6 caracteres";
    }

    return res.status(statusCode).json({ error: error.message || errorMessage });
  }
};
