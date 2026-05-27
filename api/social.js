// api/social.js - VERSIÃ“N OPTIMIZADA SIN SUBIDA DE ARCHIVOS
import admin from "firebase-admin";
import { createClient } from "@supabase/supabase-js";

const IMGUR_CLIENT_ID = process.env.IMGUR_CLIENT_ID;

// ðŸ” Admin emails - ONLY from environment variables (NEVER hardcoded)
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

// ðŸ” Supabase credentials - ONLY from environment variables
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
const USER_NOTES_TABLE = "user_notes";
const USER_NOTES_TYPE = String(process.env.USER_NOTES_TYPE || "private").trim().toLowerCase() || "private";
const USER_NOTES_ALLOWED_TYPES = new Set(
  String(process.env.USER_NOTES_ALLOWED_TYPES || "private")
    .split(",")
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean),
);
const ADMIN_NOTES_MAX_HTML = 2_000_000;
const ADMIN_NOTES_MAX_FILE_NAME = 180;
const ADMIN_NOTES_MAX_TABS = 30;
const DELETE_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const DELETE_RATE_LIMIT_MAX_REQUESTS = 20;
const deleteRateLimitStore = new Map();
const SECURITY_RATE_LIMITS_COLLECTION = "security_rate_limits";

function resolveUserNotesType() {
  if (USER_NOTES_ALLOWED_TYPES.has(USER_NOTES_TYPE)) {
    return USER_NOTES_TYPE;
  }

  if (USER_NOTES_ALLOWED_TYPES.has("private")) {
    return "private";
  }

  return Array.from(USER_NOTES_ALLOWED_TYPES)[0] || "private";
}

function isUserNotesTypeConstraintError(errorLike) {
  const message = String(errorLike?.message || "").toLowerCase();
  return (
    message.includes("user_notes_note_type_check") ||
    (message.includes("note_type") && message.includes("check constraint"))
  );
}

function createUserNotesTypeConstraintError(errorLike, notesType) {
  const allowed = Array.from(USER_NOTES_ALLOWED_TYPES);
  const err = new Error(
    `Configuración inválida de note_type en user_notes. note_type actual: "${notesType}". Valores permitidos: ${allowed.join(", ")}.`,
  );
  err.statusCode = 500;
  return err;
}

// ðŸ” Add security headers to all API responses
function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Strict-Transport-Security", "max-age=31536000");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
}

function getRequesterIp(req) {
  const forwardedFor = String(req.headers["x-forwarded-for"] || "").trim();
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0] || "";
    return String(firstIp).trim();
  }
  return String(req.socket?.remoteAddress || "").trim();
}

function enforceDeleteRateLimit(identityKey) {
  const key = String(identityKey || "").trim();
  if (!key) {
    const error = new Error("No se pudo identificar la solicitud");
    error.statusCode = 429;
    throw error;
  }

  const now = Date.now();
  const existing = deleteRateLimitStore.get(key) || { count: 0, windowStart: now };
  const isExpired = now - existing.windowStart >= DELETE_RATE_LIMIT_WINDOW_MS;

  if (isExpired) {
    deleteRateLimitStore.set(key, { count: 1, windowStart: now });
    return;
  }

  if (existing.count >= DELETE_RATE_LIMIT_MAX_REQUESTS) {
    const error = new Error("Demasiadas solicitudes de eliminación. Intenta de nuevo en unos segundos");
    error.statusCode = 429;
    throw error;
  }

  existing.count += 1;
  deleteRateLimitStore.set(key, existing);
}

export default async function handler(req, res) {
  // ðŸ” Apply security headers to all responses
  setSecurityHeaders(res);
  
  // ðŸ” CORS - Restrict to explicit allowlist only
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
      case "delete-admin-note":
        await handleDeleteAdminNote(req, res);
        break;
      case "get-user-notes":
        await handleGetUserNotes(req, res);
        break;
      case "save-user-notes":
        await handleSaveUserNotes(req, res);
        break;
      case "delete-user-note":
        await handleDeleteUserNote(req, res);
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
      case "add-music":
        await handleAddMusic(req, res);
        break;
      case "create-music-playlist":
        await handleCreateMusicPlaylist(req, res);
        break;
      case "add-music-to-playlist":
        await handleAddMusicToPlaylist(req, res);
        break;
      case "add-music-list":
        await handleAddMusicList(req, res);
        break;
      case "delete-music":
        await handleDeleteMusic(req, res);
        break;
      case "edit-music":
        await handleEditMusic(req, res);
        break;
      case "get-musics":
        await handleGetMusics(req, res);
        break;
      case "get-music-playlists":
        await handleGetMusicPlaylists(req, res);
        break;
      case "get-music-playlist":
        await handleGetMusicPlaylist(req, res);
        break;
      case "cleanup-rate-limits":
        await handleCleanupRateLimits(req, res);
        break;
      case "delete-music-playlist":
        await handleDeleteMusicPlaylist(req, res);
        break;
            case "get-or-create-certificate-code":
        await handleGetOrCreateCertificateCode(req, res);
        break;
             case "search-certificate-by-code":
               await handleSearchCertificateByCode(req, res);
               break;
      default:
        res.status(400).json({ error: "AcciÃ³n no vÃ¡lida" });
    }
  } catch (error) {
    console.error("Error en social API:", error);
    res.status(500).json({
      success: false,
      error: error.message || "Error interno del servidor",
    });
  }
}

// Manejar eliminaciÃ³n de archivos
async function handleDelete(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "MÃ©todo no permitido" });
  }

  try {
    const body = req.body || {};
    const requester = await requireAuthenticated(req, body);
    const identityKey = requester.uid || requester.email || getRequesterIp(req) || "anonymous";
    enforceDeleteRateLimit(identityKey);

    const deletehash = String(body.deletehash || "").trim();

    if (!deletehash) {
      return res.status(400).json({ error: "Deletehash requerido" });
    }

    if (!/^[a-zA-Z0-9_-]{5,200}$/.test(deletehash)) {
      return res.status(400).json({ error: "Deletehash invÃ¡lido" });
    }

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

    return res.status(200).json({
      success: true,
      message: "Imagen eliminada correctamente",
    });
  } catch (error) {
    console.error("Error en delete:", error);
    return res.status(error.statusCode || 500).json({
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

// ===== CERTIFICATE CODE HANDLER =====
/**
 * Handle get-or-create certificate registration code
 * New behavior: one row per `nombre_especialidad` with a JSONB `usuarios` array
 * Each element in `usuarios` contains user metadata and a unique `codigo_9digitos`.
 */
async function handleGetOrCreateCertificateCode(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const requester = await requireAuthenticated(req);
    const userEmail = String(requester?.email || '').trim().toLowerCase();
    const userId = String(requester?.uid || '').trim();

    if (!userEmail || !userId) {
      return res.status(401).json({ success: false, error: 'Usuario no autenticado' });
    }

    const body = req.body || {};
    const nombreEspecialidad = String(body.nombreEspecialidad || '').trim();
    const nombreUsuario = String(body.nombreUsuario || '').trim();
    const nombreInstructor = String(body.nombreInstructor || '').trim();
    const fechaEspecialidad = body.fechaEspecialidad ? new Date(body.fechaEspecialidad) : new Date();
    const notaExamen = Number(body.notaExamen) || 0;
    const notaTarea = Number(body.notaTarea) || null;
    const calificaciones = body.calificaciones || {};

    if (!nombreEspecialidad || !nombreUsuario) {
      return res.status(400).json({ success: false, error: 'nombreEspecialidad y nombreUsuario son requeridos' });
    }

    // 1) Try to find an existing specialty row
    const { data: foundRows, error: findError } = await supabase
      .from('especialidades_registradas')
      .select('id, nombre_especialidad, fecha_especialidad, usuarios, created_at, updated_at')
      .eq('nombre_especialidad', nombreEspecialidad)
      .limit(1);

    if (findError) {
      throw new Error(`Error verificando especialidad: ${findError.message}`);
    }

    // Helper to build new user object
    const buildUserObject = (code) => ({
      nombre_usuario: nombreUsuario,
      correo_electronico: userEmail,
      nombre_instructor: nombreInstructor || null,
      codigo_9digitos: code,
      nota_examen: Number(notaExamen) || 0,
      nota_tarea: Number(notaTarea) || null,
      calificaciones: calificaciones || {},
      created_at: new Date().toISOString(),
    });

    // If specialty row exists
    if (Array.isArray(foundRows) && foundRows.length > 0) {
      const row = foundRows[0];

      // Normalize existing users array (support legacy single-row fields)
      const existingUsuarios = Array.isArray(row.usuarios) ? row.usuarios : [];

      // If legacy row stores nombre_usuario / correo_electronico at top level, include it in array for lookup
      if (!existingUsuarios.length && (row.nombre_usuario || row.correo_electronico)) {
        const legacyUser = {
          nombre_usuario: String(row.nombre_usuario || '').trim() || null,
          correo_electronico: String(row.correo_electronico || '').trim().toLowerCase() || null,
          nombre_instructor: String(row.nombre_instructor || '').trim() || null,
          codigo_9digitos: String(row.codigo_9digitos || '').trim() || null,
          nota_examen: Number(row.nota_examen) || 0,
          nota_tarea: row.nota_tarea == null ? null : Number(row.nota_tarea),
          calificaciones: row.calificaciones || {},
          created_at: row.created_at || new Date().toISOString(),
        };

        if (legacyUser.nombre_usuario || legacyUser.correo_electronico) {
          existingUsuarios.push(legacyUser);
        }
      }

      // 2) Check if user already present in usuarios array (by email or by name)
      const foundUser = existingUsuarios.find((u) => {
        const uEmail = String(u?.correo_electronico || '').trim().toLowerCase();
        const uName = String(u?.nombre_usuario || '').trim();
        return (uEmail && uEmail === userEmail) || (uName && uName === nombreUsuario);
      });

      if (foundUser) {
        // Return the existing code for this user
        return res.status(200).json({ success: true, codigo: String(foundUser.codigo_9digitos || ''), isNew: false, createdAt: foundUser.created_at || row.created_at || null });
      }

      // 3) User not found in this specialty row -> create a new user entry and append
      const newCode = await generateUnique9DigitCode();
      if (!newCode) throw new Error('No se pudo generar código único');

      const newUser = buildUserObject(newCode);
      const updatedUsuarios = existingUsuarios.concat([newUser]);

      // Update the row with the new usuarios array
      const { data: updateData, error: updateError } = await supabase
        .from('especialidades_registradas')
        .update({ usuarios: updatedUsuarios, updated_at: new Date().toISOString() })
        .eq('id', row.id)
        .select('id');

      if (updateError) {
        // Retry on duplicate/code collision
        if (String(updateError.message || '').toLowerCase().includes('duplicate') || String(updateError.message || '').toLowerCase().includes('unique')) {
          console.warn('Collision detected updating usuarios array, retrying...');
          return handleGetOrCreateCertificateCode(req, res);
        }
        throw new Error(`Error actualizando especialidad: ${updateError.message}`);
      }

      return res.status(201).json({ success: true, codigo: newCode, isNew: true });
    }

    // 4) No specialty row exists -> create a new row with usuarios array containing this user
    const newCode = await generateUnique9DigitCode();
    if (!newCode) throw new Error('No se pudo generar código único');

    const firstUser = buildUserObject(newCode);
    const insertPayload = {
      nombre_especialidad: nombreEspecialidad,
      fecha_especialidad: fechaEspecialidad.toISOString(),
      usuarios: [firstUser],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: inserted, error: insertErr } = await supabase
      .from('especialidades_registradas')
      .insert([insertPayload])
      .select('id, nombre_especialidad, usuarios, created_at');

    if (insertErr) {
      if (String(insertErr.message || '').toLowerCase().includes('duplicate') || String(insertErr.message || '').toLowerCase().includes('unique')) {
        console.warn('Collision detected on insert, retrying...');
        return handleGetOrCreateCertificateCode(req, res);
      }
      throw new Error(`Error creando especialidad: ${insertErr.message}`);
    }

    return res.status(201).json({ success: true, codigo: newCode, isNew: true });

  } catch (error) {
    console.error('Error en get-or-create-certificate-code:', error);
    return res.status(error.statusCode || 500).json({ success: false, error: error.message || 'Error procesando código de certificado' });
  }
}

// ===== Música: agregar música (solo propietario) =====
async function handleAddMusic(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const body = req.body || {};
    // Verificar que es el propietario
    await requireOwner(req, body);
    const requester = await requireAuthenticated(req, body);

    const music = body.music || {};
    const title = String(music.title || '').trim();
    const url = String(music.url || '').trim();
    const artist = music.artist ? String(music.artist).trim() : null;
    const album = music.album ? String(music.album).trim() : null;
    const year = Number.isFinite(Number(music.year)) ? Number(music.year) : null;
    const is_video = !!music.is_video;

    if (!title || !url) {
      return res.status(400).json({ success: false, error: 'title y url son obligatorios' });
    }

    const payload = {
      owner_id: String(requester.uid || requester.email || '').trim(),
      title,
      url,
      is_video,
      artist,
      album,
      year,
      metadata: music.metadata || {}
    };

    const { data, error } = await supabase.from('musics').insert(payload).select().limit(1).single();
    if (error) throw error;

    return res.status(200).json({ success: true, music: data });
  } catch (err) {
    console.error('handleAddMusic error:', err);
    return res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Error agregando música' });
  }
}

// ===== Música: crear playlist de usuario (máx 3) =====
async function handleCreateMusicPlaylist(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const body = req.body || {};
    const requester = await requireAuthenticated(req, body);
    const name = String(body.name || '').trim();
    if (!name) return res.status(400).json({ success: false, error: 'name es requerido' });

    const requesterEmail = normalizeEmail(requester?.email || '');
    const requesterUid = String(requester?.uid || '').trim();
    const isOwnerRequester = requesterEmail === normalizeEmail(OWNER_EMAIL);
    const isAdminRequester = getAdminEmails().includes(requesterEmail);

    let hasProAccess = isOwnerRequester || isAdminRequester;
    if (!hasProAccess && requesterUid) {
      const donationSnap = await admin
        .firestore()
        .collection('donaciones_paypal')
        .where('donorUserId', '==', requesterUid)
        .where('status', '==', 'approved')
        .limit(1)
        .get();

      hasProAccess = !donationSnap.empty;
    }

    // Contar playlists existentes
    const { data: existing, error: countErr } = await supabase.from('music_playlists').select('id').eq('owner_id', requester.uid).limit(100);
    if (countErr) throw countErr;
    if (!hasProAccess && Array.isArray(existing) && existing.length >= 3) {
      return res.status(400).json({ success: false, error: 'Límite de 3 playlists alcanzado' });
    }

    const { data, error } = await supabase.from('music_playlists').insert({ owner_id: requester.uid, name }).select().single();
    if (error) throw error;

    return res.status(200).json({ success: true, playlist: data });
  } catch (err) {
    console.error('handleCreateMusicPlaylist error:', err);
    return res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Error creando playlist' });
  }
}

// ===== Música: añadir música a playlist (propietario de playlist) =====
async function handleAddMusicToPlaylist(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const body = req.body || {};
    const requester = await requireAuthenticated(req, body);
    const playlistId = String(body.playlistId || body.playlist_id || '').trim();
    if (!playlistId) return res.status(400).json({ success: false, error: 'playlistId es requerido' });

    // Buscar playlist
    const { data: playlists, error: pErr } = await supabase.from('music_playlists').select('*').eq('id', playlistId).limit(1);
    if (pErr) throw pErr;
    if (!Array.isArray(playlists) || playlists.length === 0) return res.status(404).json({ success: false, error: 'Playlist no encontrada' });
    const playlist = playlists[0];

    // Validar propietario de la playlist
    if (String(playlist.owner_id || '') !== String(requester.uid || requester.email || '')) {
      return res.status(403).json({ success: false, error: 'No eres el propietario de la playlist' });
    }

    // Contar items actuales
    const { data: items, error: itemsErr } = await supabase.from('music_playlist_items').select('id').eq('playlist_id', playlistId).limit(1000);
    if (itemsErr) throw itemsErr;
    const currentCount = Array.isArray(items) ? items.length : 0;
    if (currentCount >= 20) {
      return res.status(400).json({ success: false, error: 'Playlist alcanza el máximo de 20 canciones' });
    }

    // Determinar música: puede venir como musicId o como objeto music
    let musicId = String(body.musicId || body.music_id || '').trim();
    if (!musicId) {
      const music = body.music || {};
      const title = String(music.title || '').trim();
      const url = String(music.url || '').trim();
      if (!title || !url) return res.status(400).json({ success: false, error: 'music.title y music.url son requeridos si no se pasa musicId' });

      const insertPayload = {
        owner_id: String(requester.uid || requester.email || '').trim(),
        title,
        url,
        is_video: !!music.is_video,
        artist: music.artist || null,
        album: music.album || null,
        year: Number.isFinite(Number(music.year)) ? Number(music.year) : null,
        metadata: music.metadata || {}
      };

      const { data: newMusic, error: insertErr } = await supabase.from('musics').insert(insertPayload).select().single();
      if (insertErr) throw insertErr;
      musicId = newMusic.id;
    } else {
      // verificar que la música exista
      const { data: found, error: fErr } = await supabase.from('musics').select('id').eq('id', musicId).limit(1);
      if (fErr) throw fErr;
      if (!Array.isArray(found) || found.length === 0) return res.status(404).json({ success: false, error: 'Música no encontrada' });
    }

    // Insertar en playlist
    const position = currentCount + 1;
    const { data: added, error: addErr } = await supabase.from('music_playlist_items').insert({ playlist_id: playlistId, music_id: musicId, position }).select().single();
    if (addErr) throw addErr;

    return res.status(200).json({ success: true, item: added });
  } catch (err) {
    console.error('handleAddMusicToPlaylist error:', err);
    return res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Error añadiendo música a playlist' });
  }
}

// ===== Música: subida en lote (solo propietario) =====
async function handleAddMusicList(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const body = req.body || {};
    await requireOwner(req, body);
    const requester = await requireAuthenticated(req, body);
    const list = Array.isArray(body.list) ? body.list : [];

    if (!list.length) {
      return res.status(400).json({ success: false, error: 'list debe contener elementos' });
    }

    const rows = list
      .map((item) => ({
        owner_id: String(requester.uid || requester.email || '').trim(),
        title: String(item?.title || '').trim(),
        url: String(item?.url || '').trim(),
        is_video: !!item?.is_video,
        artist: item?.artist ? String(item.artist).trim() : null,
        album: item?.album ? String(item.album).trim() : null,
        year: Number.isFinite(Number(item?.year)) ? Number(item.year) : null,
        metadata: item?.metadata || {}
      }))
      .filter((row) => row.title && row.url);

    if (!rows.length) {
      return res.status(400).json({ success: false, error: 'No hay elementos válidos para insertar' });
    }

    const { data, error } = await supabase.from('musics').insert(rows).select();
    if (error) throw error;

    return res.status(200).json({ success: true, inserted: Array.isArray(data) ? data.length : 0, musics: data || [] });
  } catch (err) {
    console.error('handleAddMusicList error:', err);
    return res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Error en subida de lista' });
  }
}

// ===== Música: eliminar pista =====
async function handleDeleteMusic(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const body = req.body || {};
    const requester = await requireAuthenticated(req, body);
    const musicId = String(body.musicId || body.music_id || '').trim();
    if (!musicId) return res.status(400).json({ success: false, error: 'musicId es requerido' });

    const { data: found, error: findErr } = await supabase
      .from('musics')
      .select('id, owner_id')
      .eq('id', musicId)
      .limit(1);

    if (findErr) throw findErr;
    if (!Array.isArray(found) || found.length === 0) {
      return res.status(404).json({ success: false, error: 'Música no encontrada' });
    }

    const music = found[0];
    const requesterId = String(requester.uid || requester.email || '').trim();
    if (String(music.owner_id || '') !== requesterId) {
      await requireOwner(req, body);
    }

    const { error: delErr } = await supabase
      .from('musics')
      .delete()
      .eq('id', musicId);

    if (delErr) throw delErr;

    return res.status(200).json({ success: true, deleted: true, musicId });
  } catch (err) {
    console.error('handleDeleteMusic error:', err);
    return res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Error eliminando música' });
  }
}

// ===== Música: editar pista =====
async function handleEditMusic(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const body = req.body || {};
    const requester = await requireAuthenticated(req, body);
    const musicId = String(body.musicId || body.music_id || '').trim();
    const musicPayload = body.music || {};
    if (!musicId) return res.status(400).json({ success: false, error: 'musicId es requerido' });

    const { data: found, error: findErr } = await supabase
      .from('musics')
      .select('id, owner_id')
      .eq('id', musicId)
      .limit(1);

    if (findErr) throw findErr;
    if (!Array.isArray(found) || found.length === 0) {
      return res.status(404).json({ success: false, error: 'Música no encontrada' });
    }

    const music = found[0];
    const requesterId = String(requester.uid || requester.email || '').trim();
    if (String(music.owner_id || '') !== requesterId) {
      await requireOwner(req, body);
    }

    // Validate/prepare allowed fields
    const allowed = ['title', 'url', 'artist', 'album', 'year', 'cover_url'];
    const update = {};
    allowed.forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(musicPayload, k)) {
        update[k] = musicPayload[k];
      }
    });

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, error: 'No hay campos para actualizar' });
    }

    const { data: updated, error: updErr } = await supabase
      .from('musics')
      .update(update)
      .eq('id', musicId)
      .select()
      .limit(1);

    if (updErr) throw updErr;

    return res.status(200).json({ success: true, music: Array.isArray(updated) ? updated[0] : updated });
  } catch (err) {
    console.error('handleEditMusic error:', err);
    return res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Error actualizando música' });
  }
}

// ===== Música: catálogo global =====
async function handleGetMusics(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const limitRaw = Number.parseInt(String(req.query?.limit || '200'), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, limitRaw)) : 200;

    const { data, error } = await supabase
      .from('musics')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return res.status(200).json({ success: true, musics: Array.isArray(data) ? data : [] });
  } catch (err) {
    console.error('handleGetMusics error:', err);
    return res.status(500).json({ success: false, error: err.message || 'Error obteniendo músicas' });
  }
}

// ===== Música: playlists del usuario autenticado + listas automáticas compartidas =====
async function handleGetMusicPlaylists(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const requester = await requireAuthenticated(req);
    const requesterId = String(requester?.uid || requester?.email || '').trim();
    if (!requesterId) {
      return res.status(401).json({ success: false, error: 'Usuario no autenticado' });
    }

    // 1) Obtener listas propias del usuario (privadas, excluyendo automáticas)
    const { data: userPlaylists, error: userErr } = await supabase
      .from('music_playlists')
      .select('id,name,owner_id,created_at,music_playlist_items(id,position,music_id)')
      .eq('owner_id', requesterId)
      .not('name', 'like', '__AUTO__%')
      .order('created_at', { ascending: false });

    if (userErr) throw userErr;

    // 2) Obtener listas automáticas compartidas (de cualquier propietario)
    const { data: autoPlaylists, error: autoErr } = await supabase
      .from('music_playlists')
      .select('id,name,owner_id,created_at,music_playlist_items(id,position,music_id)')
      .like('name', '__AUTO__%')
      .order('created_at', { ascending: false });

    if (autoErr) throw autoErr;

    // 3) Combinar y mapear
    const allData = [...(Array.isArray(autoPlaylists) ? autoPlaylists : []), ...(Array.isArray(userPlaylists) ? userPlaylists : [])];
    const playlists = allData.map((row) => ({
      id: row.id,
      name: row.name,
      owner_id: row.owner_id,
      created_at: row.created_at,
      songs_count: Array.isArray(row.music_playlist_items) ? row.music_playlist_items.length : 0,
      // NOTE: items include only minimal info (music_id). Full music details
      // will be loaded lazily via `get-music-playlist` endpoint when needed.
      items: Array.isArray(row.music_playlist_items)
        ? row.music_playlist_items
            .map((item) => ({
              id: item.id,
              position: item.position,
              music_id: item.music_id,
              music: null,
            }))
            .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
        : [],
    }));

    return res.status(200).json({ success: true, playlists });
  } catch (err) {
    console.error('handleGetMusicPlaylists error:', err);
    return res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Error obteniendo playlists' });
  }
}

async function handleGetMusicPlaylist(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Método no permitido' });
  try {
    const requester = await requireAuthenticated(req);
    const requesterId = String(requester?.uid || requester?.email || '').trim();
    if (!requesterId) return res.status(401).json({ success: false, error: 'Usuario no autenticado' });

    const playlistId = String(req.query?.playlistId || req.query?.playlist_id || '').trim();
    if (!playlistId) return res.status(400).json({ success: false, error: 'playlistId es requerido' });

    const { data: rows, error } = await supabase
      .from('music_playlists')
      .select('id,name,owner_id,created_at,music_playlist_items(id,position,music_id,musics(id,title,url,artist,album,is_video,metadata,owner_id,created_at))')
      .eq('id', playlistId)
      .limit(1);

    if (error) throw error;
    if (!Array.isArray(rows) || rows.length === 0) return res.status(404).json({ success: false, error: 'Playlist no encontrada' });
    const row = rows[0];
    const playlist = {
      id: row.id,
      name: row.name,
      owner_id: row.owner_id,
      created_at: row.created_at,
      songs_count: Array.isArray(row.music_playlist_items) ? row.music_playlist_items.length : 0,
      items: Array.isArray(row.music_playlist_items)
        ? row.music_playlist_items
            .map((item) => ({
              id: item.id,
              position: item.position,
              music_id: item.music_id,
              music: item.musics || null,
            }))
            .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
        : [],
    };

    return res.status(200).json({ success: true, playlist });
  } catch (err) {
    console.error('handleGetMusicPlaylist error:', err);
    return res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Error obteniendo playlist' });
  }
}

// ===== Música: eliminar playlist =====
async function handleDeleteMusicPlaylist(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const body = req.body || {};
    const requester = await requireAuthenticated(req, body);
    const playlistId = String(body.playlistId || body.playlist_id || '').trim();
    if (!playlistId) return res.status(400).json({ success: false, error: 'playlistId es requerido' });

    const { data: found, error: findErr } = await supabase
      .from('music_playlists')
      .select('id, owner_id')
      .eq('id', playlistId)
      .limit(1);

    if (findErr) throw findErr;
    if (!Array.isArray(found) || found.length === 0) {
      return res.status(404).json({ success: false, error: 'Playlist no encontrada' });
    }

    const playlist = found[0];
    const requesterId = String(requester.uid || requester.email || '').trim();
    if (String(playlist.owner_id || '') !== requesterId) {
      return res.status(403).json({ success: false, error: 'No eres el propietario de la playlist' });
    }

    const { error: delErr } = await supabase
      .from('music_playlists')
      .delete()
      .eq('id', playlistId);

    if (delErr) throw delErr;

    return res.status(200).json({ success: true, deleted: true, playlistId });
  } catch (err) {
    console.error('handleDeleteMusicPlaylist error:', err);
    return res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Error eliminando playlist' });
  }
}

/**
 * Generate a unique 9-digit random code that doesn't exist in database (including all usuarios arrays)
 */
async function generateUnique9DigitCode() {
  const maxAttempts = 20;

  // Helper: fetch all existing codes (top-level and inside usuarios arrays)
  async function fetchExistingCodesSet() {
    const codes = new Set();
    try {
      const { data: rows, error } = await supabase
        .from('especialidades_registradas')
        .select('usuarios');

      if (error) {
        console.error('Error fetching existing codes:', error);
        return codes;
      }

      for (const r of Array.isArray(rows) ? rows : []) {
        if (Array.isArray(r?.usuarios)) {
          for (const u of r.usuarios) {
            const c = String((u && (u.codigo_9digitos || u.codigo)) || '').trim();
            if (c) codes.add(c);
          }
        }
      }
    } catch (err) {
      console.error('Unexpected error fetching codes:', err);
    }

    return codes;
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const randomCode = String(Math.floor(Math.random() * 900000000) + 100000000);
    const existing = await fetchExistingCodesSet();
    if (!existing.has(randomCode)) return randomCode;
    // else continue and retry
  }

  console.error('Failed to generate unique code after', maxAttempts, 'attempts');
  return null;
}

  /**
   * Search certificate registration by 9-digit code
   */
  async function handleSearchCertificateByCode(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(405).json({ error: 'Método no permitido' });
    }

    try {
      const body = req.method === 'POST' ? (req.body || {}) : {};
      const query = req.method === 'GET' ? (req.query || {}) : {};
      const codigoSearching = String(body.codigo_9digitos || query.codigo_9digitos || '').trim();

      if (!codigoSearching || codigoSearching.length !== 9 || !/^\d+$/.test(codigoSearching)) {
        return res.status(400).json({
          success: false,
          error: 'Código debe ser un número de 9 dígitos'
        });
      }

      const { data: especialidades, error: queryError } = await supabase
        .from('especialidades_registradas')
        .select('id, nombre_especialidad, fecha_especialidad, usuarios, created_at');

      if (queryError) {
        throw new Error(`Error buscando especialidades: ${queryError.message}`);
      }

      let foundUser = null;
      let foundEspecialidad = null;

      for (const espec of Array.isArray(especialidades) ? especialidades : []) {
        if (!Array.isArray(espec.usuarios)) continue;

        const user = espec.usuarios.find(
          (u) => String(u?.codigo_9digitos || '').trim() === codigoSearching
        );

        if (user) {
          foundUser = user;
          foundEspecialidad = espec;
          break;
        }
      }

      if (!foundUser || !foundEspecialidad) {
        return res.status(404).json({
          success: false,
          error: 'No se encontró registro de especialidad con ese código'
        });
      }

      return res.status(200).json({
        success: true,
        specialty: {
          id: foundEspecialidad.id,
          nombre_especialidad: foundEspecialidad.nombre_especialidad,
          fecha_especialidad: foundEspecialidad.fecha_especialidad,
          created_at: foundEspecialidad.created_at,
        },
        user: foundUser
      });

    } catch (error) {
      console.error('Error en search-certificate-by-code:', error);
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || 'Error buscando certificado'
      });
    }
  }

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb", // Reducido porque ya no manejamos archivos grandes
    },
  },
};

// ðŸ”’ Endpoint para obtener lista de administradores
async function handleGetAdmins(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "MÃ©todo no permitido" });
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

function maskEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return "";
  const [localPart, domainPart = ""] = normalized.split("@");
  if (!localPart || !domainPart) return "***";

  const safeLocal =
    localPart.length <= 2
      ? `${localPart[0] || "*"}*`
      : `${localPart.slice(0, 2)}***${localPart.slice(-1)}`;

  const domainPieces = domainPart.split(".").filter(Boolean);
  const domainName = domainPieces[0] || "";
  const domainTld = domainPieces.slice(1).join(".");
  const safeDomainName = domainName
    ? `${domainName[0]}***${domainName.slice(-1)}`
    : "***";
  const safeDomain = domainTld ? `${safeDomainName}.${domainTld}` : safeDomainName;

  return `${safeLocal}@${safeDomain}`;
}

function buildTargetEmailResponse(email, { canExpose = false } = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized) return {};
  const masked = maskEmail(normalized);
  if (canExpose) {
    return {
      targetEmail: normalized,
      targetEmailMasked: masked,
    };
  }
  return {
    targetEmailMasked: masked,
  };
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
    const error = new Error("Token de autenticaciÃ³n requerido");
    error.statusCode = 401;
    throw error;
  }

  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(token);
  } catch (_error) {
    const error = new Error("Token de autenticaciÃ³n invÃ¡lido");
    error.statusCode = 401;
    throw error;
  }

  const requesterEmail = normalizeEmail(decodedToken?.email || "");
  if (!requesterEmail || requesterEmail !== normalizeEmail(OWNER_EMAIL)) {
    const error = new Error("Solo el propietario puede realizar esta acciÃ³n");
    error.statusCode = 403;
    throw error;
  }

  return requesterEmail;
}

async function requireAdminOrOwner(req, body = {}) {
  const token = getBearerToken(req) || String(body.idToken || "").trim();

  if (!token) {
    const error = new Error("Token de autenticaciÃ³n requerido");
    error.statusCode = 401;
    throw error;
  }

  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(token);
  } catch (_error) {
    const error = new Error("Token de autenticaciÃ³n invÃ¡lido");
    error.statusCode = 401;
    throw error;
  }

  const requesterEmail = normalizeEmail(decodedToken?.email || "");
  const admins = getAdminEmails();
  if (!requesterEmail || !admins.includes(requesterEmail)) {
    const error = new Error("No tienes permisos para realizar esta acciÃ³n");
    error.statusCode = 403;
    throw error;
  }

  return requesterEmail;
}

async function requireAuthenticated(req, body = {}) {
  const token = getBearerToken(req) || String(body.idToken || "").trim();

  if (!token) {
    const error = new Error("Token de autenticaciÃ³n requerido");
    error.statusCode = 401;
    throw error;
  }

  let decodedToken;
  try {
    decodedToken = await admin.auth().verifyIdToken(token);
  } catch (_error) {
    const error = new Error("Token de autenticaciÃ³n invÃ¡lido");
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

function sanitizeOwnInstructorAssignment(rawAssignment, requester) {
  if (!rawAssignment || typeof rawAssignment !== "object") return null;

  const assignmentEmail = normalizeEmail(rawAssignment.email || requester?.email || "");
  const assignmentUserId = String(rawAssignment.userId || requester?.uid || "").trim();
  const assignmentName = String(rawAssignment.name || assignmentEmail || "Instructor").trim();
  const especialidades = sanitizeSpecialties(rawAssignment.especialidades);

  return {
    userId: assignmentUserId,
    email: assignmentEmail,
    name: assignmentName,
    especialidades,
    updatedAt: rawAssignment.updatedAt || null,
  };
}

async function handleGetInstructorAssignments(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "MÃ©todo no permitido" });
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
    return res.status(405).json({ error: "MÃ©todo no permitido" });
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

    const safeAssignment = sanitizeOwnInstructorAssignment(assignment, requester);

    res.status(200).json({
      success: true,
      assignmentKey,
      assignment: safeAssignment,
    });
  } catch (error) {
    console.error("Error obteniendo asignaciÃ³n del instructor actual:", error);
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "Error al obtener asignaciÃ³n del instructor",
    });
  }
}

async function handleSaveInstructorAssignments(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "MÃ©todo no permitido" });
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
    return res.status(405).json({ error: "MÃ©todo no permitido" });
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
    return res.status(405).json({ error: "MÃ©todo no permitido" });
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
      message: "DonaciÃ³n guardada correctamente",
      subscriptionId,
    });
  } catch (error) {
    console.error("Error guardando donaciÃ³n PayPal:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "Error al guardar donaciÃ³n",
    });
  }
}

async function handleGetPaypalDonations(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "MÃ©todo no permitido" });
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
    let canExposeDonorEmail = false;
    if (type === "user") {
      // Usuario puede ver solo sus donaciones
      query = query.where("donorUserId", "==", userId).limit(safeLimit);
      canExposeDonorEmail = false;
    } else {
      // Solo admin/owner puede ver todas
      await requireAdminOrOwner(req);
      query = query.orderBy("approvedAt", "desc").limit(safeLimit);
      canExposeDonorEmail = true;
    }

    const snapshot = await query.get();

    let donations = snapshot.docs.map((docSnap) => {
      const data = docSnap.data() || {};
      const donorEmail = normalizeEmail(data.donorEmail || "");
      return {
        id: docSnap.id,
        subscriptionId: String(data.subscriptionId || docSnap.id || "").trim(),
        planId: String(data.planId || "").trim(),
        provider: String(data.provider || "paypal").trim(),
        intent: String(data.intent || "subscription").trim(),
        status: String(data.status || "approved").trim(),
        donorUserId: String(data.donorUserId || "").trim(),
        ...(canExposeDonorEmail ? { donorEmail } : {}),
        donorEmailMasked: maskEmail(donorEmail),
        donorName: String(data.donorName || "").trim(),
        isGuestSession: !!data.isGuestSession,
        approvedAt: String(data.approvedAt || "").trim(),
        updatedAt: data.updatedAt || null,
      };
    });

    // Si es el usuario filtrando sus donaciones, ordenar en cliente (para evitar Ã­ndice compuesto)
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
  const fileNameRaw = String(input?.fileName || "Sin tí­tulo").trim();
  const fileName = fileNameRaw.slice(0, ADMIN_NOTES_MAX_FILE_NAME) || "Sin título";
  const zoomValue = Number.parseInt(String(input?.zoom ?? "100"), 10);
  const zoom = Number.isFinite(zoomValue) ? Math.min(300, Math.max(50, zoomValue)) : 100;
  const wrap = input?.wrap !== false;
  
  if (html.length > ADMIN_NOTES_MAX_HTML) {
    const error = new Error("El contenido de notas excede el tamaño permitido");
    error.statusCode = 413;
    throw error;
  }

  const tabsInput = Array.isArray(input?.tabs) ? input.tabs.slice(0, ADMIN_NOTES_MAX_TABS) : [];
  const tabs = tabsInput
    .map((tab, index) => {
      const tabHtml = String(tab?.html || "");
      const tabTitleRaw = String(tab?.title || `Sin título ${index + 1}`).trim();
      const tabTitle = tabTitleRaw.slice(0, ADMIN_NOTES_MAX_FILE_NAME) || `Sin título ${index + 1}`;
      const tabIdRaw = String(tab?.id || `tab_${index + 1}`).trim();
      const tabId = tabIdRaw.slice(0, 120) || `tab_${index + 1}`;
      const tabZoomValue = Number.parseInt(String(tab?.zoom ?? "100"), 10);
      const tabZoom = Number.isFinite(tabZoomValue)
        ? Math.min(300, Math.max(50, tabZoomValue))
        : 100;
      const tabWrap = tab?.wrap !== false;

      return {
        id: tabId,
        title: tabTitle,
        html: tabHtml,
        zoom: tabZoom,
        wrap: tabWrap,
      };
    })
    .filter((tab) => !!tab.id);

  const tabsOrder = Array.from(new Set(
    (Array.isArray(input?.tabsOrder) ? input.tabsOrder : [])
      .map((item) => String(item || "").trim().slice(0, 120))
      .filter(Boolean),
  )).slice(0, ADMIN_NOTES_MAX_TABS);

  if (!tabsOrder.length && tabs.length) {
    tabsOrder.push(...tabs.map((tab) => tab.id));
  }

  const tabsHtmlLength = tabs.reduce((sum, tab) => sum + String(tab?.html || "").length, 0);
  if (tabsHtmlLength > ADMIN_NOTES_MAX_HTML) {
    const error = new Error("El contenido total de pestañas excede el tamaño permitido");
    error.statusCode = 413;
    throw error;
  }

  const activeDocIdRaw = String(input?.activeDocId || "").trim();
  const activeDocId = activeDocIdRaw.slice(0, 120);
  const saveOnlyActive = input?.saveOnlyActive === true;

  return { html, fileName, zoom, wrap, tabs, tabsOrder, activeDocId, saveOnlyActive };
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

    const { data: rows, error } = await supabase
      .from(ADMIN_NOTES_TABLE)
      .select("id, html, file_name, zoom, wrap, tab_order, updated_at, updated_by")
      .order("tab_order", { ascending: true })
      .order("updated_at", { ascending: false });

    if (error) {
      throw new Error(`No se pudieron cargar notas admin desde Supabase: ${error.message}`);
    }

    const normalizedRows = Array.isArray(rows) ? rows : [];
    const perTabRows = normalizedRows.filter((row) => String(row?.id || "").trim());

    if (perTabRows.length > 0) {
      const tabs = perTabRows
        .slice(0, ADMIN_NOTES_MAX_TABS)
        .map((row) => ({
          id: String(row.id || "").trim(),
          title: String(row.file_name || "Sin título"),
          html: String(row.html || ""),
          zoom: Number(row.zoom) || 100,
          wrap: row.wrap !== false,
        }))
        .filter((tab) => !!tab.id);

      const first = tabs[0] || null;

      return res.status(200).json({
        success: true,
        notes: {
          html: String(first?.html || ""),
          fileName: String(first?.title || "Sin título"),
          zoom: Number(first?.zoom) || 100,
          wrap: first?.wrap !== false,
          tabs,
          activeDocId: first?.id || "",
          updatedAt: perTabRows[0]?.updated_at || null,
          updatedBy: perTabRows[0]?.updated_by || null,
        },
      });
    }

    return res.status(200).json({
      success: true,
      notes: {
        html: "",
        fileName: "Sin título",
        zoom: 100,
        wrap: true,
        tabs: [],
        activeDocId: "",
        updatedAt: null,
        updatedBy: null,
      },
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

    let finalTabs = payload.tabs.length ? [...payload.tabs] : [];
    const finalOrder = payload.tabsOrder.length ? [...payload.tabsOrder] : finalTabs.map((tab) => tab.id);
    let activeTab = finalTabs.find((tab) => tab.id === (payload.activeDocId || "")) || finalTabs[0] || null;

    if (payload.saveOnlyActive) {
      const activeIncomingTab = payload.tabs.find((tab) => tab.id === (payload.activeDocId || "")) || payload.tabs[0] || null;
      if (!activeIncomingTab) {
        const err = new Error("No se recibiÃ³ la pestaña activa para guardar");
        err.statusCode = 400;
        throw err;
      }

      const activeTabOrder = Math.max(0, finalOrder.indexOf(activeIncomingTab.id));

      const { data, error } = await supabase
        .from(ADMIN_NOTES_TABLE)
        .upsert({
          id: activeIncomingTab.id,
          html: activeIncomingTab.html,
          file_name: activeIncomingTab.title,
          zoom: activeIncomingTab.zoom,
          wrap: activeIncomingTab.wrap,
          tab_order: activeTabOrder,
          updated_at: new Date().toISOString(),
          updated_by: actorEmail,
        }, { onConflict: "id" })
        .select("id, html, file_name, zoom, wrap, tab_order, updated_at, updated_by")
        .single();

      if (error) {
        throw new Error(`No se pudo guardar la pestaña activa: ${error.message}`);
      }

      finalTabs = [activeIncomingTab];
      activeTab = activeIncomingTab;

      const remainingOrderIds = finalOrder.filter((id) => id !== activeIncomingTab.id);
      if (remainingOrderIds.length) {
        const orderUpdates = remainingOrderIds.map((tabId, index) =>
          supabase
            .from(ADMIN_NOTES_TABLE)
            .update({ tab_order: index + 1 })
            .eq("id", tabId),
        );

        const orderResults = await Promise.all(orderUpdates);
        const orderError = orderResults.find((result) => !!result?.error)?.error;
        if (orderError) {
          throw new Error(`No se pudo actualizar el orden de pestañas: ${orderError.message}`);
        }
      }

      return res.status(200).json({
        success: true,
        notes: {
          html: String(data?.html || activeIncomingTab.html || ""),
          fileName: String(data?.file_name || activeIncomingTab.title || "Sin título"),
          zoom: Number(data?.zoom) || activeIncomingTab.zoom || 100,
          wrap: data?.wrap !== false,
          tabs: finalTabs,
          activeDocId: activeIncomingTab.id,
          updatedAt: data?.updated_at || null,
          updatedBy: data?.updated_by || actorEmail,
        },
      });
    }

    const batchTabs = finalTabs.slice(0, ADMIN_NOTES_MAX_TABS);
    if (!batchTabs.length) {
      const err = new Error("No se recibieron pestañas para guardar");
      err.statusCode = 400;
      throw err;
    }

    const batchPayload = batchTabs.map((tab, index) => {
      const mappedOrder = finalOrder.indexOf(tab.id);
      return {
        id: tab.id,
        html: tab.html,
        file_name: tab.title,
        zoom: tab.zoom,
        wrap: tab.wrap,
        tab_order: mappedOrder >= 0 ? mappedOrder : index,
        updated_at: new Date().toISOString(),
        updated_by: actorEmail,
      };
    });

    const { error } = await supabase
      .from(ADMIN_NOTES_TABLE)
      .upsert(batchPayload, { onConflict: "id" });

    if (error) {
      throw new Error(`No se pudieron guardar pestañas de notas admin: ${error.message}`);
    }

    activeTab = batchTabs.find((tab) => tab.id === (payload.activeDocId || "")) || batchTabs[0] || null;

    return res.status(200).json({
      success: true,
      notes: {
        html: String(activeTab?.html || ""),
        fileName: String(activeTab?.title || "Sin título"),
        zoom: Number(activeTab?.zoom) || 100,
        wrap: activeTab?.wrap !== false,
        tabs: batchTabs,
        activeDocId: payload.activeDocId || activeTab?.id || "",
        updatedAt: new Date().toISOString(),
        updatedBy: actorEmail,
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

async function handleDeleteAdminNote(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "MÃ©todo no permitido" });
  }

  try {
    const body = req.body || {};
    const actorEmail = await requireAdminOrOwner(req, body);
    const tabId = String(body?.tabId || "").trim().slice(0, 120);

    if (!tabId) {
      return res.status(400).json({
        success: false,
        error: "tabId es requerido",
      });
    }

    const { error } = await supabase
      .from(ADMIN_NOTES_TABLE)
      .delete()
      .eq("id", tabId);

    if (error) {
      throw new Error(`No se pudo eliminar la nota en la nube: ${error.message}`);
    }

    return res.status(200).json({
      success: true,
      tabId,
      deletedBy: actorEmail,
    });
  } catch (error) {
    console.error("Error eliminando nota admin:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "No se pudo eliminar la nota",
    });
  }
}

async function handleGetUserNotes(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const requester = await requireAuthenticated(req);
    const userId = String(requester?.uid || "").trim();

    if (!userId) {
      return res.status(401).json({ success: false, error: "Usuario no autenticado" });
    }

    const { data: rows, error } = await supabase
      .from(USER_NOTES_TABLE)
      .select("id, html, title, zoom, wrap, tab_order, updated_at, updated_by")
      .eq("user_id", userId)
      .eq("note_type", USER_NOTES_TYPE)
      .order("tab_order", { ascending: true })
      .order("updated_at", { ascending: false });

    if (error) {
      throw new Error(`No se pudieron cargar notas de usuario desde Supabase: ${error.message}`);
    }

    const normalizedRows = Array.isArray(rows) ? rows : [];
    const tabs = normalizedRows
      .slice(0, ADMIN_NOTES_MAX_TABS)
      .map((row) => ({
        id: String(row.id || "").trim(),
        title: String(row.title || "Sin título"),
        html: String(row.html || ""),
        zoom: Number(row.zoom) || 100,
        wrap: row.wrap !== false,
      }))
      .filter((tab) => !!tab.id);

    const first = tabs[0] || null;

    return res.status(200).json({
      success: true,
      notes: {
        html: String(first?.html || ""),
        fileName: String(first?.title || "Sin título"),
        zoom: Number(first?.zoom) || 100,
        wrap: first?.wrap !== false,
        tabs,
        activeDocId: first?.id || "",
        updatedAt: normalizedRows[0]?.updated_at || null,
        updatedBy: normalizedRows[0]?.updated_by || null,
      },
    });
  } catch (error) {
    console.error("Error obteniendo notas de usuario:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "No se pudieron obtener las notas de usuario",
    });
  }
}

async function handleSaveUserNotes(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const body = req.body || {};
    const requester = await requireAuthenticated(req, body);
    const userId = String(requester?.uid || "").trim();
    const userNotesType = resolveUserNotesType();
    const payload = sanitizeAdminNotesPayload(body);

    if (!userId) {
      return res.status(401).json({ success: false, error: "Usuario no autenticado" });
    }

    let finalTabs = payload.tabs.length ? [...payload.tabs] : [];
    const finalOrder = payload.tabsOrder.length ? [...payload.tabsOrder] : finalTabs.map((tab) => tab.id);
    let activeTab = finalTabs.find((tab) => tab.id === (payload.activeDocId || "")) || finalTabs[0] || null;

    if (payload.saveOnlyActive) {
      const activeIncomingTab = payload.tabs.find((tab) => tab.id === (payload.activeDocId || "")) || payload.tabs[0] || null;
      if (!activeIncomingTab) {
        const err = new Error("No se recibió la pestaña activa para guardar");
        err.statusCode = 400;
        throw err;
      }

      const activeTabOrder = Math.max(0, finalOrder.indexOf(activeIncomingTab.id));

      const { data, error } = await supabase
        .from(USER_NOTES_TABLE)
        .upsert({
          id: activeIncomingTab.id,
          user_id: userId,
          note_type: userNotesType,
          title: activeIncomingTab.title,
          html: activeIncomingTab.html,
          zoom: activeIncomingTab.zoom,
          wrap: activeIncomingTab.wrap,
          tab_order: activeTabOrder,
          updated_at: new Date().toISOString(),
          updated_by: requester?.email || userId,
        }, { onConflict: "id" })
        .select("id, html, title, zoom, wrap, tab_order, updated_at, updated_by")
        .single();

      if (error) {
        if (isUserNotesTypeConstraintError(error)) {
          throw createUserNotesTypeConstraintError(error, userNotesType);
        }
        throw new Error(`No se pudo guardar la pestaña activa: ${error.message}`);
      }

      finalTabs = [activeIncomingTab];
      activeTab = activeIncomingTab;

      const remainingOrderIds = finalOrder.filter((id) => id !== activeIncomingTab.id);
      if (remainingOrderIds.length) {
        const orderUpdates = remainingOrderIds.map((tabId, index) =>
          supabase
            .from(USER_NOTES_TABLE)
            .update({ tab_order: index + 1 })
            .eq("id", tabId)
            .eq("user_id", userId)
            .eq("note_type", userNotesType),
        );

        const orderResults = await Promise.all(orderUpdates);
        const orderError = orderResults.find((result) => !!result?.error)?.error;
        if (orderError) {
          throw new Error(`No se pudo actualizar el orden de pestañas: ${orderError.message}`);
        }
      }

      return res.status(200).json({
        success: true,
        notes: {
          html: String(data?.html || activeIncomingTab.html || ""),
          fileName: String(data?.title || activeIncomingTab.title || "Sin título"),
          zoom: Number(data?.zoom) || activeIncomingTab.zoom || 100,
          wrap: data?.wrap !== false,
          tabs: finalTabs,
          activeDocId: activeIncomingTab.id,
          updatedAt: data?.updated_at || null,
          updatedBy: data?.updated_by || (requester?.email || userId),
        },
      });
    }

    const batchTabs = finalTabs.slice(0, ADMIN_NOTES_MAX_TABS);
    if (!batchTabs.length) {
      const err = new Error("No se recibieron pestañas para guardar");
      err.statusCode = 400;
      throw err;
    }

    const batchPayload = batchTabs.map((tab, index) => {
      const mappedOrder = finalOrder.indexOf(tab.id);
      return {
        id: tab.id,
        user_id: userId,
        note_type: userNotesType,
        title: tab.title,
        html: tab.html,
        zoom: tab.zoom,
        wrap: tab.wrap,
        tab_order: mappedOrder >= 0 ? mappedOrder : index,
        updated_at: new Date().toISOString(),
        updated_by: requester?.email || userId,
      };
    });

    const { error } = await supabase
      .from(USER_NOTES_TABLE)
      .upsert(batchPayload, { onConflict: "id" });

    if (error) {
      if (isUserNotesTypeConstraintError(error)) {
        throw createUserNotesTypeConstraintError(error, userNotesType);
      }
      throw new Error(`No se pudieron guardar pestañas de notas de usuario: ${error.message}`);
    }

    activeTab = batchTabs.find((tab) => tab.id === (payload.activeDocId || "")) || batchTabs[0] || null;

    return res.status(200).json({
      success: true,
      notes: {
        html: String(activeTab?.html || ""),
        fileName: String(activeTab?.title || "Sin título"),
        zoom: Number(activeTab?.zoom) || 100,
        wrap: activeTab?.wrap !== false,
        tabs: batchTabs,
        activeDocId: payload.activeDocId || activeTab?.id || "",
        updatedAt: new Date().toISOString(),
        updatedBy: requester?.email || userId,
      },
    });
  } catch (error) {
    console.error("Error guardando notas de usuario:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "No se pudieron guardar las notas de usuario",
    });
  }
}

async function handleDeleteUserNote(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "MÃ©todo no permitido" });
  }

  try {
    const body = req.body || {};
    const requester = await requireAuthenticated(req, body);
    const userId = String(requester?.uid || "").trim();
    const tabId = String(body?.tabId || "").trim().slice(0, 120);

    if (!userId) {
      return res.status(401).json({ success: false, error: "Usuario no autenticado" });
    }

    if (!tabId) {
      return res.status(400).json({
        success: false,
        error: "tabId es requerido",
      });
    }

    const { error } = await supabase
      .from(USER_NOTES_TABLE)
      .delete()
      .eq("id", tabId)
      .eq("user_id", userId)
      .eq("note_type", USER_NOTES_TYPE);

    if (error) {
      throw new Error(`No se pudo eliminar la nota en la nube: ${error.message}`);
    }

    return res.status(200).json({
      success: true,
      tabId,
      deletedBy: requester?.email || userId,
    });
  } catch (error) {
    console.error("Error eliminando nota de usuario:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "No se pudo eliminar la nota",
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

async function resolveMaintenanceJobAccess(req) {
  if (isCronSecretAuthorized(req)) {
    return { mode: "cron", actor: "vercel-cron" };
  }

  const actor = await requireAdminOrOwner(req);
  return { mode: "admin", actor };
}

async function handleCleanupRateLimits(req, res) {
  if (!["GET", "POST"].includes(req.method || "")) {
    return res.status(405).json({ error: "MÃ©todo no permitido" });
  }

  try {
    const access = await resolveMaintenanceJobAccess(req);
    const payload = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const requestedBatchSize = Number.parseInt(String(payload?.batchSize || payload?.limit || "500"), 10);
    const requestedBatches = Number.parseInt(String(payload?.maxBatches || "4"), 10);

    const batchSize = Number.isFinite(requestedBatchSize)
      ? Math.max(1, Math.min(requestedBatchSize, 1000))
      : 500;
    const maxBatches = Number.isFinite(requestedBatches)
      ? Math.max(1, Math.min(requestedBatches, 20))
      : 4;

    const db = admin.firestore();
    const now = Date.now();
    let deleted = 0;
    let batches = 0;

    for (let index = 0; index < maxBatches; index += 1) {
      const expiredSnap = await db
        .collection(SECURITY_RATE_LIMITS_COLLECTION)
        .where("expiresAtMs", "<=", now)
        .limit(batchSize)
        .get();

      if (expiredSnap.empty) break;

      const writer = db.bulkWriter();
      expiredSnap.docs.forEach((docSnap) => {
        writer.delete(docSnap.ref);
      });
      await writer.close();

      deleted += expiredSnap.size;
      batches += 1;

      if (expiredSnap.size < batchSize) break;
    }

    return res.status(200).json({
      success: true,
      mode: access.mode,
      actor: access.actor,
      deleted,
      batches,
      batchSize,
      maxBatches,
      collection: SECURITY_RATE_LIMITS_COLLECTION,
      checkedAtMs: now,
    });
  } catch (error) {
    console.error("Error limpiando rate limits expirados:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "No se pudieron limpiar los rate limits expirados",
    });
  }
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
    return res.status(405).json({ error: "MÃ©todo no permitido" });
  }

  try {
    const body = req.body || {};
    const requester = await requireAuthenticated(req, body);
    const token = String(body.token || "").trim();

    if (!token || token.length < 20) {
      return res.status(400).json({ success: false, error: "Token invÃ¡lido" });
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
    console.error("Error guardando token de notificaciÃ³n:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "No se pudo guardar el token",
    });
  }
}

async function handleDisableNotificationToken(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "MÃ©todo no permitido" });
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
    console.error("Error desactivando token de notificaciÃ³n:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "No se pudo desactivar el token",
    });
  }
}

async function handleSendTaskReminders(req, res) {
  if (!["GET", "POST"].includes(req.method || "")) {
    return res.status(405).json({ error: "MÃ©todo no permitido" });
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
          title: `â° Tarea por vencer: ${reminder.title}`,
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
    return res.status(405).json({ error: "MÃ©todo no permitido" });
  }

  try {
    const body = req.body || {};
    const requester = await requireAuthenticated(req, body);
    const db = admin.firestore();

    const rawTargetEmail = normalizeEmail(body.targetEmail || requester.email || "");
    if (!rawTargetEmail) {
      return res.status(400).json({ success: false, error: "No se encontrÃ³ correo destino" });
    }

    const isSelfTarget = rawTargetEmail === requester.email;
    if (!isSelfTarget) {
      await requireAdminOrOwner(req, body);
    }
    const requesterIsAdmin = getAdminEmails().includes(requester.email);
    const canExposeTargetEmail = requesterIsAdmin;

    const title = String(body.title || "ðŸ”” NotificaciÃ³n de prueba").trim().slice(0, 120);
    const message = String(
      body.message || "Push de prueba enviado correctamente desde Conquiguias World."
    ).trim().slice(0, 300);
    const targetUrl = String(body.url || "/panel").trim() || "/panel";

    const tokenDocs = await getActiveTokenDocsForEmails(db, [rawTargetEmail]);
    if (!tokenDocs.length) {
      return res.status(200).json({
        success: true,
        sent: 0,
        ...buildTargetEmailResponse(rawTargetEmail, { canExpose: canExposeTargetEmail }),
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
      ...buildTargetEmailResponse(rawTargetEmail, { canExpose: canExposeTargetEmail }),
      sent: result.successCount,
      failed: result.failureCount,
      invalidTokensDisabled: invalidDocIds.length,
    });
  } catch (error) {
    console.error("Error enviando notificaciÃ³n de prueba:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "No se pudo enviar notificaciÃ³n de prueba",
    });
  }
}

async function handleNotifyPostApproved(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "MÃ©todo no permitido" });
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
      return res.status(404).json({ success: false, error: "PublicaciÃ³n no encontrada" });
    }

    const postData = postSnap.data() || {};
    const status = String(postData.status || "").trim().toLowerCase();
    if (status !== "approved") {
      return res.status(200).json({
        success: true,
        sent: 0,
        postId,
        message: "La publicaciÃ³n aÃºn no estÃ¡ aprobada",
      });
    }

    const targetEmail = normalizeEmail(postData.userEmail || "");
    if (!targetEmail) {
      return res.status(200).json({
        success: true,
        sent: 0,
        postId,
        message: "La publicaciÃ³n no tiene correo de autor",
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
    const title = "âœ… Tu publicaciÃ³n fue aprobada";
    const bodyMessage = authorName
      ? `${authorName}, tu publicaciÃ³n ya estÃ¡ visible para todos.`
      : "Tu publicaciÃ³n ya estÃ¡ visible para todos.";

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
      targetEmailMasked: maskEmail(targetEmail),
      sent: result.successCount,
      failed: result.failureCount,
      invalidTokensDisabled: invalidDocIds.length,
    });
  } catch (error) {
    console.error("Error enviando notificaciÃ³n de aprobaciÃ³n:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || "No se pudo enviar notificaciÃ³n de aprobaciÃ³n",
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
      description: existing.description || "ðŸ”´ TransmisiÃ³n en vivo",
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
    return res.status(405).json({ error: "MÃ©todo no permitido" });
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

  const publicOwnerProfile = {
    name: String(ownerProfile?.name || "Admin").trim() || "Admin",
    photo: String(ownerProfile?.photo || "").trim(),
  };

  return res.status(200).json({
    live,
    ownerProfile: publicOwnerProfile,
    livePostId: LIVE_POST_ID,
  });
}

