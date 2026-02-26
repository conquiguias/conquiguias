const { createClient } = require("@supabase/supabase-js");

// Configuración Supabase
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://kjrnhggwqinegenvrtnr.supabase.co";
const SUPABASE_KEY =
  process.env.SUPABASE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtqcm5oZ2d3cWluZWdlbnZydG5yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTY2MDQ0NCwiZXhwIjoyMDg1MjM2NDQ0fQ.bmJvB2NpiBonpKpgPh85fFIadOnEh9fG7hlzJZFQNGs";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Cache en memoria simple para Serverless (persiste mientras la instancia esté caliente)
const memoryCache = new Map();
const CACHE_TTL = 60 * 1000; // 1 minuto por defecto para datos dinámicos
const CACHE_TTL_STATIC = 5 * 60 * 1000; // 5 minutos para datos estáticos (imágenes, evaluaciones)

module.exports = async function handler(req, res) {
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
        case "eliminarImagen":
          await handleEliminarImagen(req, res, repo);
          break;
        case "eliminarTodasTareasPDF":
          await handleEliminarTodasTareasPDF(req, res, repo);
          break;
        case "eliminarTareasPDF":
          await handleEliminarTareasPDF(req, res, repo);
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
    res
      .status(500)
      .json({ error: "Error interno del servidor: " + error.message });
  }
};

// --- HANDLERS (Migrados a Supabase con la misma lógica) ---

async function handleListarFormularios(req, res) {
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
  const fechaCierre = new Date(form.fechaCierre);
  const ahora = new Date();
  const estado = ahora > fechaCierre ? "cerrado" : "abierto";

  // Devolvemos el JSON exacto que espera el frontend
  res.status(200).json({
    ...form,
    id, // Asegurar que el ID va
    estado,
    asistenciasActivas: form.asistenciasActivas || { 1: false, 2: false },
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
  const { id } = req.query;

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

  res.status(200).json({
    asistencias: respData?.contenido_respuestas || [],
    examenes: evalData?.contenido_resultados || [],
    tareas: evalData?.contenido_tareas || {},
  });
}

async function handleListarEntregas(req, res) {
  const { id } = req.query;
  const { data, error } = await supabase
    .from("evaluaciones")
    .select("contenido_tareas")
    .eq("especialidad_id", id)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  res.status(200).json(data?.contenido_tareas || {});
}

async function handleListarFormulariosPendientes(req, res) {
  const { data: evalData, error } = await supabase
    .from("evaluaciones")
    .select("especialidad_id, contenido_tareas");
  if (error) throw error;

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
            total++;
            if (t.estado === "calificado") {
                calificadas++;
            } else {
                // Asumimos que si no está calificado, está pendiente (entregado)
                count++;
            }
        }
      });
      
      if (count > 0) {
        pendientes.push({
          id: item.especialidad_id,
          titulo: titulos[item.especialidad_id] || item.especialidad_id,
          pendientes: count,
          calificadas: calificadas,
          total: total
        });
      }
    });
  }
  res.status(200).json(pendientes);
}

// --- HANDLERS POST (Lógica idéntica pero guardando en Supabase) ---

async function handleGuardarFormulario(req, res) {
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
    fechaCierre:
      fechaCierre || new Date(Date.now() + 70 * 60 * 1000).toISOString(),
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
      .json({ error: "❌ El nombre es obligatorio para la primera asistencia." });
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
  const { id, evaluation } = req.body;
  await supabase
    .from("evaluaciones")
    .upsert({ especialidad_id: id, contenido_evaluacion: evaluation });
  res
    .status(200)
    .json({ ok: true, message: "✅ Evaluación guardada correctamente." });
}

async function handleGuardarResultadoExamen(req, res) {
  const { id, visitanteId, respuestas, puntaje, email } = req.body;

  const { data: exData } = await supabase
    .from("evaluaciones")
    .select("contenido_resultados")
    .eq("especialidad_id", id)
    .single();
  let resultados = exData?.contenido_resultados || [];

  if (resultados.some((r) => r.visitanteId === visitanteId))
    return res.status(200).json({ ok: true }); // Ya existe

  resultados.push({
    visitanteId,
    respuestas,
    puntaje,
    fecha: new Date().toISOString(),
    correo: email || null,
  });

  await supabase
    .from("evaluaciones")
    .upsert({ especialidad_id: id, contenido_resultados: resultados });
  res
    .status(200)
    .json({ ok: true, message: "✅ Examen enviado correctamente.", puntaje });
}

async function handleActualizarEstadoAsistencia(req, res) {
  const { id, asistencia, activo, adminEmail } = req.body;
  if (adminEmail !== "kendall.torres.17@gmail.com")
    return res.status(403).json({ error: "No autorizado" });

  const { data: fData } = await supabase
    .from("formularios")
    .select("data")
    .eq("id", id)
    .single();
  if (!fData) return res.status(404).json({ error: "No encontrado" });

  const nuevoData = { ...fData.data };
  if (!nuevoData.asistenciasActivas)
    nuevoData.asistenciasActivas = { 1: false, 2: false };
  nuevoData.asistenciasActivas[asistencia] = activo;

  await supabase.from("formularios").update({ data: nuevoData }).eq("id", id);
  res
    .status(200)
    .json({ ok: true, asistenciasActivas: nuevoData.asistenciasActivas });
}

async function handleCalificarTareas(req, res) {
  const { id, tareas } = req.body;
  // Actualizamos solo la columna contenido_tareas, manteniendo lo demas
  await supabase
    .from("evaluaciones")
    .upsert({ especialidad_id: id, contenido_tareas: tareas });
  res.status(200).json({ ok: true });
}

async function handleEliminarFormulario(req, res) {
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
  const r = await fetch(
    `https://api.github.com/repos/${repo}/git/trees/main?recursive=1`,
    { headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` } },
  ).then((x) => x.json());
  const pdfs = (r.tree || [])
    .filter(
      (n) => n.path.startsWith("tareas_files/") && n.path.endsWith(".pdf"),
    )
    .map((n) => ({
      nombre: n.path.split("/").pop(),
      ruta: n.path,
      url: `https://raw.githubusercontent.com/${repo}/main/${n.path}`,
      tamano: n.size || 0,
    }));
  res.status(200).json(pdfs);
}

// Este handler es crucial: Sube al GitHub (blob) PERO guarda metadatos en SUPABASE
async function handleSubirTarea(req, res, repo) {
  const { id, visitanteId, email, contenido, nombreArchivo } = req.body;
  const ident = email || visitanteId;

  // 1. Subir PDF a GitHub
  const path = `tareas_files/${id}/${ident.replace(/[^a-zA-Z0-9.@_-]/g, "_")}.pdf`;
  await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: "PUT",
    headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` },
    body: JSON.stringify({
      message: `Tarea: ${ident}`,
      content: contenido,
      branch: "main",
    }),
  });

  // 2. Actualizar JSON de tareas en Supabase
  const { data: evData } = await supabase
    .from("evaluaciones")
    .select("contenido_tareas")
    .eq("especialidad_id", id)
    .single();
  const tareas = evData?.contenido_tareas || {};

  tareas[ident] = {
    estado: "entregado",
    fecha: new Date().toISOString(),
    url: `https://raw.githubusercontent.com/${repo}/main/${path}`,
    nota: null,
    nombreArchivoOriginal: nombreArchivo,
  };

  await supabase
    .from("evaluaciones")
    .upsert({ especialidad_id: id, contenido_tareas: tareas });
  res.status(200).json({ ok: true, message: "Tarea enviada correctamente" });
}

async function handleEliminarTodasTareasPDF(req, res, repo) {
  const r = await fetch(
    `https://api.github.com/repos/${repo}/git/trees/main?recursive=1`,
    { headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` } },
  ).then((x) => x.json());

  const files = (r.tree || []).filter(
    (n) => n.path.startsWith("tareas_files/") && n.type === "blob",
  );

  let eliminados = 0;
  let errores = 0;

  // PROCESAMIENTO SECUENCIAL (CRÍTICO PARA EVITAR CONFLICTOS DE GIT)
  // GitHub no permite múltiples commits simultáneos sobre la misma rama (409 Conflict)
  for (const f of files) {
    try {
      const delResp = await fetch(
        `https://api.github.com/repos/${repo}/contents/${f.path}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `token ${process.env.GITHUB_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: "Limpieza",
            sha: f.sha,
            branch: "main",
          }),
        },
      );

      if (delResp.ok) {
        eliminados++;
      } else {
        console.error(`Error API GitHub al borrar ${f.path}:`, delResp.status);
        errores++;
      }
    } catch (e) {
      console.error(`Excepción borrando ${f.path}`, e);
      errores++;
    }
  }

  res.status(200).json({ ok: true, eliminados, errores });
}

async function handleEliminarTareasPDF(req, res, repo) {
  // Stub seguro
  res.status(200).json({ ok: true });
}

async function handleObtenerEstadoUsuario(req, res) {
  const { visitanteId, email } = req.body;

  // Leemos TODO de Supabase de un golpe (como hacia antes con GH)
  const { data: docs } = await supabase.from("formularios").select("id, data");
  const { data: asists } = await supabase
    .from("respuestas")
    .select("especialidad_id, contenido_respuestas");
  const { data: evals } = await supabase
    .from("evaluaciones")
    .select("especialidad_id, contenido_resultados, contenido_tareas");

  const resultado = [];

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
      asistencias: misA.map((a) => a.asistenciaNumero),
      tomaAsistencia: form.tomaAsistencia,
      configTarea: form.tarea,
      miTarea: miTarea,
      configExamen: form.tieneEvaluacion,
      miExamen: bestExam,
      fechaCierre: form.fechaCierre,
    });
  });

  res
    .status(200)
    .json(resultado.sort((a, b) => new Date(b.creado) - new Date(a.creado)));
}
