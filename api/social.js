// api/social.js - VERSIÓN OPTIMIZADA SIN SUBIDA DE ARCHIVOS
import admin from "firebase-admin";

const IMGUR_CLIENT_ID = process.env.IMGUR_CLIENT_ID;
const OWNER_EMAIL = "kendall.torres.17@gmail.com";

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
    "GET,OPTIONS,PATCH,DELETE,POST,PUT"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version"
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
      case "save-instructor-assignments":
        await handleSaveInstructorAssignments(req, res);
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
      }
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
    // Lista de administradores - SEGURA en el backend
    const ADMIN_EMAILS = [
      OWNER_EMAIL,
      // Agrega más correos de administradores aquí
    ];

    const adminsUnicos = Array.from(
      new Set(ADMIN_EMAILS.map((email) => (email || "").trim().toLowerCase()))
    ).filter(Boolean);

    res.status(200).json({
      success: true,
      ownerEmail: OWNER_EMAIL,
      admins: adminsUnicos,
    });
  } catch (error) {
    console.error("Error obteniendo administradores:", error);
    res.status(500).json({
      success: false,
      error: "Error al obtener lista de administradores",
    });
  }
}

function normalizeEmail(value) {
  return (value || "").trim().toLowerCase();
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
    const configRef = admin.firestore().collection("configuracion").doc("rolesPermisos");
    const configSnap = await configRef.get();
    const data = configSnap.exists ? configSnap.data() || {} : {};

    res.status(200).json({
      success: true,
      ownerEmail: data.ownerEmail || OWNER_EMAIL,
      instructores: data.instructores || {},
    });
  } catch (error) {
    console.error("Error obteniendo asignaciones de instructores:", error);
    res.status(500).json({
      success: false,
      error: "Error al obtener asignaciones de instructores",
    });
  }
}

async function handleSaveInstructorAssignments(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const body = req.body || {};
    const instructoresSanitizados = sanitizeAssignments(body.instructores);

    const configRef = admin.firestore().collection("configuracion").doc("rolesPermisos");
    await configRef.set(
      {
        ownerEmail: OWNER_EMAIL,
        instructores: instructoresSanitizados,
        updatedAt: new Date().toISOString(),
        updatedBy: normalizeEmail(body.updatedBy || ""),
      },
      { merge: true }
    );

    res.status(200).json({
      success: true,
      ownerEmail: OWNER_EMAIL,
      instructores: instructoresSanitizados,
    });
  } catch (error) {
    console.error("Error guardando asignaciones de instructores:", error);
    res.status(500).json({
      success: false,
      error: "Error al guardar asignaciones de instructores",
    });
  }
}
