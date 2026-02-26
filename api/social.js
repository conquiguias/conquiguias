// api/social.js - VERSIÓN OPTIMIZADA SIN SUBIDA DE ARCHIVOS
const IMGUR_CLIENT_ID = process.env.IMGUR_CLIENT_ID;

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
      "kendall.torres.17@gmail.com"
      // Agrega más correos de administradores aquí
    ];

    res.status(200).json({
      success: true,
      admins: ADMIN_EMAILS,
    });
  } catch (error) {
    console.error("Error obteniendo administradores:", error);
    res.status(500).json({
      success: false,
      error: "Error al obtener lista de administradores",
    });
  }
}
