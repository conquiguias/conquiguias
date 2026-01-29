const { createClient } = require("@supabase/supabase-js");

// Configuración Supabase
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://kjrnhggwqinegenvrtnr.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "REPLACE_WITH_YOUR_ANON_KEY";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

module.exports = async function handler(req, res) {
  const { action } = req.query;
  const repo = "conquiguias/conquiguias-data";

  try {
    if (req.method === "GET") {
      switch (action) {
        case "listarFormularios":
          return await handleListarFormularios(req, res);
        case "obtenerFormulario":
          return await handleObtenerFormulario(req, res);
        case "obtenerEvaluacion":
          return await handleObtenerEvaluacion(req, res);
        case "verRespuestas":
          return await handleVerRespuestas(req, res);
        case "listarImagenes":
          return await handleListarImagenes(req, res, repo);
        case "listarEntregas":
          return await handleListarEntregas(req, res);
        case "listarArchivosPDF":
          return await handleListarArchivosPDF(req, res, repo);
        case "listarFormulariosPendientes":
          return await handleListarFormulariosPendientes(req, res);
        default:
          return res.status(400).json({ error: "Acción GET no válida" });
      }
    } else if (req.method === "POST") {
      switch (action) {
        case "guardar":
          return await handleGuardarAsistencia(req, res);
        case "guardarFormulario":
          return await handleGuardarFormulario(req, res);
        case "guardarEvaluacion":
          return await handleGuardarEvaluacion(req, res);
        case "guardarResultadoExamen":
          return await handleGuardarResultadoExamen(req, res);
        case "subirTarea":
          return await handleSubirTarea(req, res, repo);
        case "obtenerEstadoUsuario":
          return await handleObtenerEstadoUsuario(req, res);
        case "actualizarEstadoAsistencia":
          return await handleActualizarEstadoAsistencia(req, res);
        case "eliminarFormulario":
          return await handleEliminarFormulario(req, res);
        case "calificarTareas":
          return await handleCalificarTareas(req, res);
        default:
          return res.status(400).json({ error: "Acción POST no válida" });
      }
    }
  } catch (error) {
    console.error("Error API:", error);
    res.status(500).json({ error: error.message });
  }
};

// --- READ HANDLERS ---

async function handleListarFormularios(req, res) {
  const { data, error } = await supabase
    .from("especialidades")
    .select("*")
    .eq("activo", true)
    // .order("created_at", { ascending: false }); // REMOVE SORT to match legacy json natural order (oldest first usually) or undefined
    .order("created_at", { ascending: true }); // Legacy json grew by appending, so oldest first.

  if (error) throw error;

  const forms = {};
  data.forEach((f) => {
    // Reconstruct the exact object structure from legacy
    forms[f.id] = {
      ...f.configuracion, // tomaAsistencia, asistenciasActivas, tarea, tieneEvaluacion, firmas...
      id: f.id,
      titulo: f.titulo,
      fechaCierre: f.fecha_cierre,
      creado: f.created_at,
      imagenEspecialidad: f.imagen_url,
      // Ensure defaults if missing in configuracion (legacy fallback)
      asistenciasActivas: f.configuracion?.asistenciasActivas || {
        1: false,
        2: false,
      },
      tomaAsistencia:
        f.configuracion?.tomaAsistencia !== undefined
          ? f.configuracion.tomaAsistencia
          : false,
      // Ensure specific field mappings that might differ
      tieneEvaluacion: f.configuracion?.tieneEvaluacion || false,
    };
  });
  res.status(200).json(forms);
}

async function handleObtenerFormulario(req, res) {
  const { id } = req.query;
  const { data, error } = await supabase
    .from("especialidades")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;

  // Same reconstruction for consistency
  res.status(200).json({
    ...data.configuracion,
    id: data.id,
    titulo: data.titulo,
    fechaCierre: data.fecha_cierre,
    creado: data.created_at,
    imagenEspecialidad: data.imagen_url,
    asistenciasActivas: data.configuracion?.asistenciasActivas || {
      1: false,
      2: false,
    },
    tomaAsistencia:
      data.configuracion?.tomaAsistencia !== undefined
        ? data.configuracion.tomaAsistencia
        : false,
  });
}

async function handleObtenerEvaluacion(req, res) {
  const { id } = req.query;
  const { data, error } = await supabase
    .from("evaluaciones")
    .select("preguntas")
    .eq("especialidad_id", id)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  res.status(200).json(data ? data.preguntas : []);
}

async function handleVerRespuestas(req, res) {
  const { id } = req.query;
  const { data, error } = await supabase
    .from("respuestas")
    .select("*")
    .eq("especialidad_id", id);
  if (error) throw error;

  // Formatear para formulario.html (const { asistencias, examenes, tareas } = data)
  const asistencias = data
    .filter((r) => r.datos.tipo === "asistencia")
    .map((r) => ({ ...r.datos, visitanteId: r.visitante_id }));

  const examenes = data
    .filter((r) => r.datos.tipo === "examen")
    .map((r) => ({ ...r.datos, visitanteId: r.visitante_id }));

  const tareas = data
    .filter((r) => r.datos.tipo === "tarea")
    .reduce((acc, r) => {
      acc[r.visitante_id] = r.datos;
      return acc;
    }, {});

  res.status(200).json({ asistencias, examenes, tareas });
}

async function handleListarEntregas(req, res) {
  const { id } = req.query;
  const { data, error } = await supabase
    .from("respuestas")
    .select("*")
    .eq("especialidad_id", id)
    .eq("datos->>tipo", "tarea");

  if (error) throw error;

  const entregas = {};
  data.forEach((r) => {
    entregas[r.visitante_id] = {
      ...r.datos,
      visitanteId: r.visitante_id,
    };
  });
  res.status(200).json(entregas);
}

// --- WRITE HANDLERS ---

async function handleGuardarAsistencia(req, res) {
  const { id, correo, visitanteId, asistenciaNumero, nombre } = req.body;
  const identificador =
    correo && correo.trim() ? correo.trim().toLowerCase() : visitanteId;

  const { error } = await supabase.from("respuestas").upsert(
    {
      especialidad_id: id,
      visitante_id: identificador,
      datos: {
        tipo: "asistencia",
        asistenciaNumero,
        nombre,
        correo: correo ? correo.toLowerCase() : null,
        fecha: new Date().toISOString(),
      },
    },
    { onConflict: "especialidad_id,visitante_id,datos->>asistenciaNumero" },
  ); // Rough way to handle distinct assistances

  if (error) {
    // If upsert with complicated conflict fails, just insert
    const { error: insError } = await supabase.from("respuestas").insert({
      especialidad_id: id,
      visitante_id: identificador,
      datos: {
        tipo: "asistencia",
        asistenciaNumero,
        nombre,
        correo: correo ? correo.toLowerCase() : null,
        fecha: new Date().toISOString(),
      },
    });
    if (insError) throw insError;
  }
  res.status(200).json({ ok: true });
}

async function handleGuardarFormulario(req, res) {
  const {
    id,
    titulo,
    fechaCierre,
    evaluation,
    tomaAsistencia,
    tarea,
    imagenEspecialidad,
    imagenFirma1,
    imagenFirma2,
    imagenFirma3,
  } = req.body;

  const configuracion = {
    tomaAsistencia,
    tarea,
    imagenFirma1,
    imagenFirma2,
    imagenFirma3,
    tieneEvaluacion: !!evaluation,
    asistenciasActivas: { 1: false, 2: false },
  };

  const { error: espError } = await supabase.from("especialidades").insert({
    id,
    titulo,
    fecha_cierre: fechaCierre,
    imagen_url: imagenEspecialidad,
    configuracion,
  });
  if (espError) throw espError;

  if (evaluation) {
    const { error: evalError } = await supabase.from("evaluaciones").insert({
      especialidad_id: id,
      preguntas: evaluation,
    });
    if (evalError) throw evalError;
  }

  res.status(200).json({ ok: true });
}

async function handleGuardarResultadoExamen(req, res) {
  const { id, visitanteId, respuestas, puntaje, email } = req.body;
  const identificador =
    email && email.trim() ? email.trim().toLowerCase() : visitanteId;

  const { error } = await supabase.from("respuestas").upsert(
    {
      especialidad_id: id,
      visitante_id: identificador,
      datos: {
        tipo: "examen",
        respuestas,
        puntaje,
        fecha: new Date().toISOString(),
        correo: email ? email.toLowerCase() : null,
      },
    },
    { onConflict: "especialidad_id,visitante_id,datos->>tipo" },
  );

  if (error) throw error;
  res.status(200).json({ ok: true, puntaje });
}

async function handleObtenerEstadoUsuario(req, res) {
  const { visitanteId, email } = req.body;
  const vId = visitanteId;
  const uEmail = email ? email.toLowerCase().trim() : null;

  // 1. Obtener especialidades activas (o en las que haya participado)
  const { data: especialidades } = await supabase
    .from("especialidades")
    .select("*")
    .eq("activo", true);

  // 2. Obtener TODAS las participaciones del usuario
  let queryParticipaciones = supabase.from("respuestas").select("*");
  if (uEmail) {
    queryParticipaciones = queryParticipaciones.or(
      `visitante_id.eq."${vId}",visitante_id.eq."${uEmail}"`,
    );
  } else {
    queryParticipaciones = queryParticipaciones.eq("visitante_id", vId);
  }
  const { data: participaciones } = await queryParticipaciones;

  const result = especialidades.map((esp) => {
    const userParts = participaciones.filter(
      (p) => p.especialidad_id === esp.id,
    );

    const examen = userParts
      .filter((p) => p.datos.tipo === "examen")
      .sort((a, b) => b.datos.puntaje - a.datos.puntaje)[0];

    const tarea = userParts.find((p) => p.datos.tipo === "tarea");

    const asistenciasNums = userParts
      .filter((p) => p.datos.tipo === "asistencia")
      .map((p) => p.datos.asistenciaNumero);

    // CRITICAL FIX: Legacy frontend expects Object {1: bool, 2: bool}, NOT Array
    const asistenciasMap = {
      1: asistenciasNums.includes(1),
      2: asistenciasNums.includes(2),
    };

    return {
      id: esp.id,
      titulo: esp.titulo,
      creado: esp.created_at,
      fechaCierre: esp.fecha_cierre,
      tomaAsistencia: esp.configuracion?.tomaAsistencia,
      miExamen: examen ? examen.datos : null,
      miTarea: tarea ? tarea.datos : null,
      asistencias: asistenciasMap, // RESTORED STRUCTURE
      configTarea: esp.configuracion?.tarea,
      configExamen: esp.configuracion?.tieneEvaluacion,
    };
  });
  res.status(200).json(result);
}

async function handleActualizarEstadoAsistencia(req, res) {
  const { id, asistencia, activo } = req.body;

  // Obtener config actual
  const { data } = await supabase
    .from("especialidades")
    .select("configuracion")
    .eq("id", id)
    .single();
  const config = data.configuracion || {};
  if (!config.asistenciasActivas)
    config.asistenciasActivas = { 1: false, 2: false };
  config.asistenciasActivas[asistencia] = activo;

  const { error } = await supabase
    .from("especialidades")
    .update({ configuracion: config })
    .eq("id", id);
  if (error) throw error;

  res
    .status(200)
    .json({ ok: true, asistenciasActivas: config.asistenciasActivas });
}

async function handleSubirTarea(req, res, repo) {
  const { id, email, visitanteId, contenido, nombreArchivo } = req.body;
  const identificador =
    email && email.trim() ? email.trim().toLowerCase() : visitanteId;
  const path = `tareas_files/${id}/${identificador.replace(/[^a-z0-9]/gi, "_")}.pdf`;

  // Subir a GitHub
  const ghRes = await fetch(
    `https://api.github.com/repos/${repo}/contents/${path}`,
    {
      method: "PUT",
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `Tarea: ${identificador}`,
        content: contenido,
        branch: "main",
      }),
    },
  );

  if (!ghRes.ok) {
    const err = await ghRes.json();
    throw new Error("Error GitHub: " + (err.message || "Unknown"));
  }

  // Registrar en Supabase
  const { error } = await supabase.from("respuestas").upsert(
    {
      especialidad_id: id,
      visitante_id: identificador,
      datos: {
        tipo: "tarea",
        estado: "entregado",
        fecha: new Date().toISOString(),
        url: `https://raw.githubusercontent.com/${repo}/main/${path}`,
        nombreArchivoOriginal: nombreArchivo,
        email: email ? email.toLowerCase() : null,
      },
    },
    { onConflict: "especialidad_id,visitante_id,datos->>tipo" },
  );

  if (error) throw error;
  res.status(200).json({ ok: true });
}

async function handleCalificarTareas(req, res) {
  const { id, tareas } = req.body; // tareas is an object { uid: { nota, estado, ... } }

  const entries = Object.entries(tareas);
  for (const [uid, tareaData] of entries) {
    if (tareaData.estado === "calificado") {
      const { error } = await supabase
        .from("respuestas")
        .update({
          datos: tareaData,
        })
        .eq("especialidad_id", id)
        .eq("visitante_id", uid)
        .eq("datos->>tipo", "tarea");
      if (error) console.error("Error calfying:", error);
    }
  }
  res.status(200).json({ ok: true });
}

async function handleListarFormulariosPendientes(req, res) {
  // Retorna formularios con tareas activas y conteo de pendientes
  const { data: formularios } = await supabase
    .from("especialidades")
    .select("*")
    .eq("activo", true);
  const { data: entregas } = await supabase
    .from("respuestas")
    .select("*")
    .eq("datos->>tipo", "tarea");

  const result = formularios
    .filter((f) => f.configuracion?.tarea?.activa)
    .map((esp) => {
      const p = entregas.filter((r) => r.especialidad_id === esp.id);
      return {
        id: esp.id,
        titulo: esp.titulo,
        pendientes: p.filter((r) => r.datos.estado === "entregado").length,
        calificadas: p.filter((r) => r.datos.estado === "calificado").length,
        total: p.length,
      };
    });

  res.status(200).json(result);
}

async function handleListarArchivosPDF(req, res, repo) {
  const r = await fetch(
    `https://api.github.com/repos/${repo}/contents/tareas_files?ref=main`,
    {
      headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` },
    },
  );
  if (!r.ok) return res.status(200).json([]);

  const root = await r.json();
  const files = [];

  // Recursive listing would be better, but for now just top level folders
  for (const item of root) {
    if (item.type === "dir") {
      const sub = await fetch(item.url, {
        headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` },
      });
      if (sub.ok) {
        const subFiles = await sub.json();
        subFiles.forEach((f) => {
          if (f.name.endsWith(".pdf")) {
            files.push({
              nombre: f.name,
              ruta: f.path,
              tamano: f.size,
              url: f.download_url,
            });
          }
        });
      }
    }
  }
  res.status(200).json(files);
}

async function handleEliminarFormulario(req, res) {
  const { id } = req.body;
  await supabase.from("especialidades").update({ activo: false }).eq("id", id);
  res.status(200).json({ ok: true });
}

async function handleListarImagenes(req, res, repo) {
  const { carpeta } = req.query;
  const r = await fetch(
    `https://api.github.com/repos/${repo}/contents/images/${carpeta}?ref=main`,
    {
      headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` },
    },
  );
  if (!r.ok) return res.status(200).json([]);
  const data = await r.json();
  res
    .status(200)
    .json(
      Array.isArray(data)
        ? data.map((f) => ({ nombre: f.name, url: f.download_url }))
        : [],
    );
}
