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
    .eq("activo", true);
  if (error) throw error;
  const forms = {};
  data.forEach((f) => {
    forms[f.id] = {
      ...f.configuracion,
      id: f.id,
      titulo: f.titulo,
      departamento: f.departamento,
      fechaCierre: f.fecha_cierre,
      imagenEspecialidad: f.imagen_url,
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
  res.status(200).json({
    ...data.configuracion,
    id: data.id,
    titulo: data.titulo,
    departamento: data.departamento,
    fechaCierre: data.fecha_cierre,
    imagenEspecialidad: data.imagen_url,
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

  // Formatear para el frontend admin
  const asistencias = data
    .filter((r) => r.datos.tipo === "asistencia")
    .map((r) => r.datos);
  const examenes = data
    .filter((r) => r.datos.tipo === "examen")
    .reduce((acc, r) => {
      const uid = r.visitante_id;
      if (!acc[uid]) acc[uid] = [];
      acc[uid].push(r.datos);
      return acc;
    }, {});
  const tareas = data
    .filter((r) => r.datos.tipo === "tarea")
    .reduce((acc, r) => {
      acc[r.visitante_id] = r.datos;
      return acc;
    }, {});

  res.status(200).json({ asistencias, examenes, tareas });
}

// --- WRITE HANDLERS ---

async function handleGuardarAsistencia(req, res) {
  const { id, correo, visitanteId, asistenciaNumero, nombre } = req.body;
  const identificador = correo || visitanteId;

  // Guardar en tabla respuestas
  const { error } = await supabase.from("respuestas").insert({
    especialidad_id: id,
    visitante_id: identificador,
    datos: {
      tipo: "asistencia",
      asistenciaNumero,
      nombre,
      correo,
      fecha: new Date().toISOString(),
    },
  });
  if (error) throw error;
  res.status(200).json({ ok: true });
}

async function handleGuardarResultadoExamen(req, res) {
  const { id, visitanteId, respuestas, puntaje, email } = req.body;
  const { error } = await supabase.from("respuestas").insert({
    especialidad_id: id,
    visitante_id: email || visitanteId,
    datos: {
      tipo: "examen",
      respuestas,
      puntaje,
      fecha: new Date().toISOString(),
      correo: email,
    },
  });
  if (error) throw error;
  res.status(200).json({ ok: true, puntaje });
}

async function handleObtenerEstadoUsuario(req, res) {
  const { visitanteId, email } = req.body;
  const { data: especialidades } = await supabase
    .from("especialidades")
    .select("*")
    .eq("activo", true);
  const { data: participaciones } = await supabase
    .from("respuestas")
    .select("*")
    .or(`visitante_id.eq."${visitanteId}",visitante_id.eq."${email}"`);

  const result = especialidades.map((esp) => {
    const userParts = participaciones.filter(
      (p) => p.especialidad_id === esp.id,
    );
    const examen = userParts
      .filter((p) => p.datos.tipo === "examen")
      .sort((a, b) => b.datos.puntaje - a.datos.puntaje)[0];
    const tarea = userParts.find((p) => p.datos.tipo === "tarea");
    const asistencias = userParts
      .filter((p) => p.datos.tipo === "asistencia")
      .map((p) => p.datos.asistenciaNumero);

    return {
      id: esp.id,
      titulo: esp.titulo,
      creado: esp.created_at,
      miExamen: examen ? examen.datos : null,
      miTarea: tarea ? tarea.datos : null,
      asistencias: {
        1: asistencias.includes(1),
        2: asistencias.includes(2),
      },
      configTarea: esp.configuracion.tarea,
      configExamen: esp.configuracion.tieneEvaluacion,
    };
  });
  res.status(200).json(result);
}

// --- GITHUB FALLBACKS (Para imágenes y archivos) ---

async function handleListarImagenes(req, res, repo) {
  const { carpeta } = req.query;
  const r = await fetch(
    `https://api.github.com/repos/${repo}/contents/images/${carpeta}?ref=main`,
    {
      headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` },
    },
  );
  const data = await r.json();
  res
    .status(200)
    .json(
      Array.isArray(data)
        ? data.map((f) => ({ name: f.name, download_url: f.download_url }))
        : [],
    );
}

async function handleSubirTarea(req, res, repo) {
  // Implementar lógica de GitHub para el PDF y Supabase para el registro (Metadata)
  // Ya lo hicimos antes, lo consolidaré aquí.
  const { id, email, visitanteId, contenido, nombreArchivo } = req.body;
  const identificador = email || visitanteId;
  const path = `tareas_files/${id}/${identificador.replace(/[^a-z0-9]/gi, "_")}.pdf`;

  // 1. GitHub para el archivo
  await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
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
  });

  // 2. Supabase para el registro
  await supabase.from("respuestas").upsert(
    {
      especialidad_id: id,
      visitante_id: identificador,
      datos: {
        tipo: "tarea",
        estado: "entregado",
        fecha: new Date().toISOString(),
        url: `https://raw.githubusercontent.com/${repo}/main/${path}`,
        nombreArchivoOriginal: nombreArchivo,
      },
    },
    { onConflict: "especialidad_id,visitante_id" },
  );

  res.status(200).json({ ok: true });
}

// Stubs para el resto que aún no migramos a fondo pero que no deben romper el switch
async function handleListarEntregas(req, res) {
  res.status(200).json({});
}
async function handleActualizarEstadoAsistencia(req, res) {
  res.status(200).json({ ok: true });
}
async function handleEliminarFormulario(req, res) {
  const { id } = req.body;
  await supabase.from("especialidades").update({ activo: false }).eq("id", id);
  res.status(200).json({ ok: true });
}
async function handleListarArchivosPDF(req, res, repo) {
  res.status(200).json([]);
}
async function handleListarFormulariosPendientes(req, res) {
  res.status(200).json([]);
}
async function handleGuardarFormulario(req, res) {
  res.status(200).json({ ok: true });
}
async function handleGuardarEvaluacion(req, res) {
  res.status(200).json({ ok: true });
}
