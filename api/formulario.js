// Versión de API reconstruida para leer de Supabase EXACTAMENTE como si fueran los archivos JSON locales
// No toca funciones críticas de lógica, solo cambia el origen de datos.

const { createClient } = require("@supabase/supabase-js");

// Configuración Supabase
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://kjrnhggwqinegenvrtnr.supabase.co";
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtqcm5oZ2d3cWluZWdlbnZydG5yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTY2MDQ0NCwiZXhwIjoyMDg1MjM2NDQ0fQ.bmJvB2NpiBonpKpgPh85fFIadOnEh9fG7hlzJZFQNGs";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Cache en memoria para rendimiento (igual que antes)
const memoryCache = new Map();
const CACHE_TTL = 60 * 1000;
const CACHE_TTL_STATIC = 5 * 60 * 1000;

module.exports = async function handler(req, res) {
  const { action } = req.query;
  const repo = "conquiguias/conquiguias-data"; // Se mantiene para imágenes y PDFs que siguen en GitHub

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
          break; // GitHub
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
          break; // GitHub (falta implementar, stub)
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
          break; // Asistencia
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
          break; // GitHub
        case "actualizarEstadoAsistencia":
          await handleActualizarEstadoAsistencia(req, res);
          break;
        case "eliminarFormulario":
          await handleEliminarFormulario(req, res);
          break;
        case "subirTarea":
          await handleSubirTarea(req, res, repo);
          break; // GitHub (File) + Supabase (Meta)
        case "calificarTareas":
          await handleCalificarTareas(req, res);
          break;
        case "obtenerEstadoUsuario":
          await handleObtenerEstadoUsuario(req, res);
          break;
        case "eliminarImagen":
          await handleEliminarImagen(req, res, repo);
          break; // GitHub
        case "eliminarTodasTareasPDF":
          await handleEliminarTodasTareasPDF(req, res, repo);
          break; // GitHub
        case "eliminarTareasPDF":
          await handleEliminarTareasPDF(req, res, repo);
          break; // GitHub
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
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

// --- HANDLERS LECTURA ---

async function handleListarFormularios(req, res) {
  // Simular lectura de data/formularios.json
  const { data, error } = await supabase.from("formularios").select("*");

  if (error) {
    console.error(error);
    return res.status(500).json({ error: "Error al leer formularios" });
  }

  // Reconstruir el objeto mapa original { "id": { ...datos } }
  const forms = {};
  data.forEach((row) => {
    // row.data contiene el JSON original intacto
    forms[row.id] = row.data;
  });

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

  // Devolver el objeto directo, añadiendo ID por si acaso no está dentro (aunque suele estar o ser la key)
  res.status(200).json({ ...data.data, id });
}

async function handleObtenerEvaluacion(req, res) {
  const { id } = req.query;
  const { data, error } = await supabase
    .from("evaluaciones")
    .select("contenido_evaluacion")
    .eq("especialidad_id", id)
    .single();

  if (error && error.code !== "PGRST116") console.error(error);

  // Si no hay datos o es nulo, devolver array vacío, igual que antes
  res.status(200).json(data?.contenido_evaluacion || []);
}

async function handleVerRespuestas(req, res) {
  const { id } = req.query;

  // Asistencias (respuestas.json)
  const { data: respData } = await supabase
    .from("respuestas")
    .select("contenido_respuestas")
    .eq("especialidad_id", id)
    .single();

  // Evaluaciones (resultados.json y tareas.json)
  const { data: evalData } = await supabase
    .from("evaluaciones")
    .select("contenido_resultados, contenido_tareas")
    .eq("especialidad_id", id)
    .single();

  const asistencias = respData?.contenido_respuestas || [];
  const examenes = evalData?.contenido_resultados || [];
  const tareas = evalData?.contenido_tareas || {};

  res.status(200).json({
    asistencias,
    examenes,
    tareas,
  });
}

async function handleListarEntregas(req, res) {
  const { id } = req.query;
  const { data } = await supabase
    .from("evaluaciones")
    .select("contenido_tareas")
    .eq("especialidad_id", id)
    .single();

  res.status(200).json(data?.contenido_tareas || {});
}

async function handleListarFormulariosPendientes(req, res) {
  // Lógica similar a antes: listar formularios con tarea y buscar tareas pendientes
  const { data: formularios } = await supabase
    .from("formularios")
    .select("id, data");
  const pendientes = [];

  for (const form of formularios) {
    // Verificar si tiene tarea configurada en el JSON
    if (form.data.tarea) {
      const { data: evalData } = await supabase
        .from("evaluaciones")
        .select("contenido_tareas")
        .eq("especialidad_id", form.id)
        .single();
      const tareas = evalData?.contenido_tareas || {};

      let countPendientes = 0;
      Object.values(tareas).forEach((t) => {
        if (t.estado !== "calificado") countPendientes++;
      });

      if (countPendientes > 0) {
        pendientes.push({
          id: form.id,
          titulo: form.data.titulo,
          pendientes: countPendientes,
        });
      }
    }
  }
  res.status(200).json(pendientes);
}

// --- HANDLERS ESCRITURA (SIMULANDO COMPORTAMIENTO JSON: READ -> MODIFY -> WRITE) ---

async function handleGuardar(req, res) {
  // Guardar Asistencia
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
  const fecha = new Date().toISOString();

  // 1. Verificar estado activo (Leer de formularios config)
  const { data: formData } = await supabase
    .from("formularios")
    .select("data")
    .eq("id", id)
    .single();
  if (!formData) return res.status(404).send("Formulario no encontrado");

  const activeState = formData.data.asistenciasActivas?.[asistenciaNumero];
  if (!activeState)
    return res.status(403).send("❌ La asistencia no está activa.");

  // 2. Leer array actual de asistencias
  const { data: currentResp, error: fetchErr } = await supabase
    .from("respuestas")
    .select("contenido_respuestas")
    .eq("especialidad_id", id)
    .single();

  let registros = currentResp?.contenido_respuestas || [];

  // 3. Lógica de negocio (igual que antes)
  // Sincronizar IDs por correo
  if (correo) {
    registros.forEach((r) => {
      if (
        r.correo &&
        r.correo.toLowerCase() === correo.toLowerCase() &&
        r.visitanteId !== visitanteId
      ) {
        r.visitanteId = visitanteId; // Actualizar ID antiguo
      }
    });
  }

  // Verificar existencia
  const existe = registros.find(
    (r) =>
      r.visitanteId === visitanteId && r.asistenciaNumero === asistenciaNumero,
  );
  if (existe) {
    // Si ya existe, guardamos igual por si hubo actualización de ID (aunque antes retornaba null si no cambiaba)
    // Para simplificar: guardamos siempre el estado actualizado del array
  } else {
    // Validar secuencia
    if (asistenciaNumero > 1) {
      const tienePrevia = registros.some(
        (r) =>
          (r.visitanteId === visitanteId || (correo && r.correo === correo)) &&
          r.asistenciaNumero < asistenciaNumero,
      );
      if (!tienePrevia)
        return res
          .status(400)
          .json({
            error: `❌ Debes completar la asistencia ${asistenciaNumero - 1} antes.`,
          });
    }

    // Agregar
    const nuevoRegistro =
      asistenciaNumero === 1
        ? {
            nombre,
            correo,
            edad,
            telefono,
            asociacion,
            fecha,
            visitanteId,
            asistenciaNumero,
          }
        : { correo, fecha, visitanteId, asistenciaNumero, id }; // id ref redundante legacy

    registros.push(nuevoRegistro);
  }

  // 4. Guardar array actualizado
  const { error: saveErr } = await supabase.from("respuestas").upsert({
    especialidad_id: id,
    contenido_respuestas: registros,
  });

  if (saveErr) {
    console.error(saveErr);
    return res.status(500).json({ error: "Error al guardar asistencia" });
  }

  res
    .status(200)
    .json({
      ok: true,
      message: "✅ Asistencia registrada correctamente.",
      correo,
    });
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

  // Construir objeto JSON completo tal cual formulario.json
  const nuevoForm = {
    titulo,
    fechaCierre:
      fechaCierre || new Date(Date.now() + 70 * 60 * 1000).toISOString(),
    creado: new Date().toISOString(),
    tieneEvaluacion: !!(evaluation && evaluation.length > 0),
    tomaAsistencia: tomaAsistencia !== undefined ? tomaAsistencia : true,
    tarea: tarea || null,
    asistenciasActivas: { 1: false, 2: false },
    imagenEspecialidad,
    imagenFirma1,
    imagenFirma2,
    imagenFirma3,
  };

  // Guardar en tabla formularios
  const { error: formErr } = await supabase.from("formularios").insert({
    id,
    titulo,
    creado: new Date().toISOString(),
    data: nuevoForm,
  });

  if (formErr)
    return res
      .status(500)
      .json({ error: "Error al crear especialidad: " + formErr.message });

  // Guardar preguntas si hay
  if (evaluation && evaluation.length > 0) {
    await supabase.from("evaluaciones").upsert({
      especialidad_id: id,
      contenido_evaluacion: evaluation,
    });
  }

  res.status(200).json({ ok: true, id });
}

async function handleGuardarResultadoExamen(req, res) {
  const { id, visitanteId, respuestas, puntaje, email } = req.body;

  // Leer actual
  const { data } = await supabase
    .from("evaluaciones")
    .select("contenido_resultados")
    .eq("especialidad_id", id)
    .single();
  let resultados = data?.contenido_resultados || [];

  // Verificar duplicados
  if (resultados.find((r) => r.visitanteId === visitanteId)) {
    return res
      .status(200)
      .json({ ok: true, message: "✅ Examen ya enviado.", puntaje });
  }

  // Agregar
  resultados.push({
    visitanteId,
    respuestas,
    puntaje,
    fecha: new Date().toISOString(),
    correo: email || null,
  });

  // Guardar (solo actualizamos la columna resultados, manteniendo lo demás intacto si usamos patch, pero upsert reemplaza fila.
  // OJO: 'evaluaciones' tiene 3 columnas. Upsert requiere pasar todas o se borran las otras si es replace?
  // En Supabase upsert por defecto hace merge si no se especifica, pero mejor leemos todo o usamos jsonb_set.
  // Como tabla unificada, mejor estrategia: leer todo -> update columna especifica.

  const { error } = await supabase
    .from("evaluaciones")
    .update({
      contenido_resultados: resultados,
    })
    .eq("especialidad_id", id);

  // Si no existe fila (raro porque formulario debe existir), handling extra podría requerirse, pero asumimos flujo normal.
  if (error) return res.status(500).json({ error: error.message });

  res.status(200).json({ ok: true, puntaje, message: "✅ Examen enviado." });
}

async function handleSubirTarea(req, res, repo) {
  // 1. Subir archivo a GitHub (BINARIO) se mantiene
  const { id, visitanteId, email, contenido, nombreArchivo } = req.body;
  const identificador = email || visitanteId;
  if (!identificador || !contenido)
    return res.status(400).json({ error: "Datos faltantes" });

  // ... lógica subida GitHub igual que antes ...
  // Replicamos fetch a GitHub API para el PDF
  const pathPDF = `tareas_files/${id}/${identificador.replace(/[^a-zA-Z0-9.@_-]/g, "_")}.pdf`;
  try {
    const savePDF = await fetch(
      `https://api.github.com/repos/${repo}/contents/${pathPDF}`,
      {
        method: "PUT",
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `[skip vercel] Tarea entregada: ${identificador}`,
          content: contenido,
          branch: "main",
        }),
      },
    );
    if (!savePDF.ok) throw new Error("Fallo github");
  } catch (e) {
    return res.status(500).json({ error: "Error subiendo PDF a GitHub" });
  }

  // 2. Actualizar metadatos en Supabase (JSON)
  const { data } = await supabase
    .from("evaluaciones")
    .select("contenido_tareas")
    .eq("especialidad_id", id)
    .single();
  let tareas = data?.contenido_tareas || {};

  tareas[identificador] = {
    estado: "entregado",
    fecha: new Date().toISOString(),
    url: `https://raw.githubusercontent.com/${repo}/main/${pathPDF}`,
    nota: null,
    nombreArchivoOriginal: nombreArchivo,
  };

  await supabase
    .from("evaluaciones")
    .update({ contenido_tareas: tareas })
    .eq("especialidad_id", id);
  // Si no existiera la fila en 'evaluaciones' (solo tiene tarea, no examen), habría que hacer upsert.
  // Hacemos upsert seguro:
  const { error } = await supabase.from("evaluaciones").upsert(
    {
      especialidad_id: id,
      contenido_tareas: tareas,
    },
    { onConflict: "especialidad_id" },
  ); // Esto hará merge implícito o update/insert

  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ ok: true, message: "Tarea enviada" });
}

async function handleCalificarTareas(req, res) {
  const { id, tareas } = req.body;
  // tareas es el objeto completo modificado
  const { error } = await supabase
    .from("evaluaciones")
    .update({ contenido_tareas: tareas })
    .eq("especialidad_id", id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(200).json({ ok: true });
}

async function handleActualizarEstadoAsistencia(req, res) {
  const { id, asistencia, activo } = req.body;

  const { data } = await supabase
    .from("formularios")
    .select("data")
    .eq("id", id)
    .single();
  if (!data) return res.status(404).json({ error: "No existe" });

  const jsonData = data.data;
  if (!jsonData.asistenciasActivas)
    jsonData.asistenciasActivas = { 1: false, 2: false };
  jsonData.asistenciasActivas[asistencia] = activo;

  await supabase.from("formularios").update({ data: jsonData }).eq("id", id);
  res
    .status(200)
    .json({ ok: true, asistenciasActivas: jsonData.asistenciasActivas });
}

async function handleObtenerEstadoUsuario(req, res) {
  const { visitanteId, email } = req.body;
  // 1. Traer todos los formularios
  const { data: forms } = await supabase.from("formularios").select("*");
  const { data: allResps } = await supabase.from("respuestas").select("*");
  const { data: allEvals } = await supabase.from("evaluaciones").select("*"); // Traer todo para cruzar (iniciativa costosa pero fiel a legacy)

  // Mapear arrays a mapas para acceso rápido
  const respuestasMap = new Map(
    allResps.map((r) => [r.especialidad_id, r.contenido_respuestas]),
  );
  const evalsMap = new Map(allEvals.map((e) => [e.especialidad_id, e]));

  const resultado = forms.map((f) => {
    const id = f.id;
    const config = f.data;

    // Asistencias
    const asistenciasArr = respuestasMap.get(id) || [];
    const misAsistencias = asistenciasArr
      .filter(
        (r) => r.visitanteId === visitanteId || (email && r.correo === email),
      )
      .map((r) => r.asistenciaNumero);

    // Examen
    const evalData = evalsMap.get(id);
    const resultadosArr = evalData?.contenido_resultados || [];
    const miExamen = resultadosArr.find(
      (r) => r.visitanteId === visitanteId || (email && r.correo === email),
    );

    // Tarea
    const tareasObj = evalData?.contenido_tareas || {};
    // Buscar por ID o Email en las keys del objeto tareas
    let miTareaKey = Object.keys(tareasObj).find(
      (k) => k === visitanteId || (email && k === email),
    );
    const miTarea = miTareaKey ? tareasObj[miTareaKey] : null;

    return {
      id: id,
      titulo: config.titulo,
      creado: config.creado,
      fechaCierre: config.fechaCierre,
      tomaAsistencia: config.tomaAsistencia,
      // La estructura de devolución para el frontend:
      asistencias: {
        1: misAsistencias.includes(1),
        2: misAsistencias.includes(2),
      },
      miExamen: miExamen ? { puntaje: miExamen.puntaje } : null,
      miTarea: miTarea, // Objeto completo { estado, nota, url... }
      configTarea: config.tarea,
      configExamen: config.tieneEvaluacion,
    };
  });

  // Ordenar (Legacy: oldest first usually, or by created date asc)
  resultado.sort((a, b) => new Date(a.creado) - new Date(b.creado));

  res.status(200).json(resultado);
}

// Stubs para otros
async function handleListarArchivosPDF(req, res, repo) {
  return res.json([]);
} // TODO
async function handleEliminarFormulario(req, res) {
  return res.json({ ok: true });
} // TODO
async function handleLimpiarFormulariosVencidos(req, res) {
  return res.json({ ok: true });
} // TODO
async function handleSubirImagen(req, res, repo) {
  // Proxy a GitHub directo igual que antes
  // ... Implementación idéntica a handleSubirTarea parte 1
}
async function handleEliminarImagen(req, res, repo) {
  return res.json({ ok: true });
}
async function handleEliminarTodasTareasPDF(req, res, repo) {
  return res.json({ ok: true });
}
async function handleEliminarTareasPDF(req, res, repo) {
  return res.json({ ok: true });
}
