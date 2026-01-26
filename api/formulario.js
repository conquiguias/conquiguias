// formulario.js - API unificada (V3.2: Validaciones Tarea)

export default async function handler(req, res) {
  const { action } = req.query;

  // Configuración común - Repositorio SOLO para datos (evita deploys en Vercel)
  const repo = "conquiguias/conquiguias-data";

  try {
    switch (action) {
      case "guardar":
        await handleGuardar(req, res, repo);
        break;

      case "guardarEvaluacion":
        await handleGuardarEvaluacion(req, res, repo);
        break;

      case "guardarFormulario":
        await handleGuardarFormulario(req, res, repo);
        break;

      case "guardarResultadoExamen":
        await handleGuardarResultadoExamen(req, res, repo);
        break;

      case "limpiarFormulariosVencidos":
        await handleLimpiarFormulariosVencidos(req, res, repo);
        break;

      case "listarFormularios":
        await handleListarFormularios(req, res, repo);
        break;

      case "listarImagenes":
        await handleListarImagenes(req, res, repo);
        break;

      case "obtenerEvaluacion":
        await handleObtenerEvaluacion(req, res, repo);
        break;

      case "obtenerFormulario":
        await handleObtenerFormulario(req, res, repo);
        break;

      case "subirImagen":
        await handleSubirImagen(req, res, repo);
        break;

      case "verRespuestas":
        await handleVerRespuestas(req, res, repo);
        break;

      case "actualizarEstadoAsistencia":
        await handleActualizarEstadoAsistencia(req, res, repo);
        break;

      case "eliminarFormulario":
        await handleEliminarFormulario(req, res, repo);
        break;

      case "subirTarea":
        await handleSubirTarea(req, res, repo);
        break;

      case "calificarTareas":
        await handleCalificarTareas(req, res, repo);
        break;

      case "eliminarTareasPDF":
        await handleEliminarTareasPDF(req, res, repo);
        break;

      case "obtenerEstadoUsuario":
        await handleObtenerEstadoUsuario(req, res, repo);
        break;

      case "eliminarImagen":
        await handleEliminarImagen(req, res, repo);
        break;

      case "listarEntregas":
        await handleListarEntregas(req, res, repo);
        break;

      default:
        res.status(400).json({ error: "Acción no válida" });
        break;
    }
  } catch (error) {
    console.error("Error en API formulario:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
}

// Helper para manejar concurrencia y reintentos en GitHub
async function updateGitHubJSON(repo, path, message, updateFn, retries = 7) {
  const BRANCH = "main"; // Usar rama 'main' del repositorio de datos

  for (let i = 0; i < retries; i++) {
    try {
      const resp = await fetch(
        `https://api.github.com/repos/${repo}/contents/${path}?ref=${BRANCH}`, // Leer de 'main'
        {
          headers: {
            Authorization: `token ${process.env.GITHUB_TOKEN}`,
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
          },
        },
      );

      let content = null;
      let sha = null;

      if (resp.ok) {
        const data = await resp.json();
        const decoded = Buffer.from(data.content, "base64").toString();
        content = JSON.parse(decoded);
        sha = data.sha;
      } else if (resp.status === 404) {
        // Inicializar vacío si no existe
        content = path.includes("formularios.json") ? {} : [];
      } else {
        throw new Error(`Error al leer archivo: ${resp.status}`);
      }

      const result = await updateFn(content);
      if (result === null) return { ok: true, skipped: true };

      const encoded = Buffer.from(JSON.stringify(result, null, 2)).toString(
        "base64",
      );

      const save = await fetch(
        `https://api.github.com/repos/${repo}/contents/${path}`,
        {
          method: "PUT",
          headers: {
            Authorization: `token ${process.env.GITHUB_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message,
            content: encoded,
            branch: BRANCH, // Guardar en 'main'
            ...(sha && { sha }),
          }),
        },
      );

      if (save.ok) return { ok: true };
      if (save.status === 409 || save.status === 422) {
        console.warn(
          `Conflicto/Error en ${path}, reintentando... (${i + 1}/${retries})`,
        );
        // Espera con jitter
        await new Promise((r) =>
          setTimeout(r, 500 * (i + 1) + Math.random() * 500),
        );
        continue;
      }

      const errText = await save.text();
      throw new Error(`Error al guardar (${save.status}): ${errText}`);
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise((r) =>
        setTimeout(r, 1000 * (i + 1) + Math.random() * 1000),
      );
    }
  }
  throw new Error("Se agotaron los reintentos para guardar en GitHub");
}

// Handler para actualizarEstadoAsistencias
async function handleActualizarEstadoAsistencia(req, res, repo) {
  if (req.method !== "POST") return res.status(405).send("Método no permitido");

  const { id, asistencia, activo, adminEmail } = req.body;

  if (adminEmail !== "kendall.torres.17@gmail.com") {
    return res.status(403).json({ error: "No autorizado" });
  }

  const archivoFormularios = `data/formularios.json`;
  let estadoFinalAsistencias = null;

  try {
    const result = await updateGitHubJSON(
      repo,
      archivoFormularios,
      `[skip vercel] Actualizar estado asistencia ${asistencia} a ${activo} en formulario ${id}`,
      async (formularios) => {
        if (!formularios[id]) {
          // Si no existe, no hacemos cambios, esto causará que result.ok sea false o se maneje abajo
          return null; // updateGitHubJSON manejará esto como skipped
        }

        if (!formularios[id].asistenciasActivas) {
          formularios[id].asistenciasActivas = { 1: false, 2: false };
        }

        formularios[id].asistenciasActivas[asistencia] = activo;

        // Capturamos el estado completo para devolverlo
        estadoFinalAsistencias = { ...formularios[id].asistenciasActivas };

        return formularios;
      },
    );

    if (result.ok && estadoFinalAsistencias) {
      res.status(200).json({
        ok: true,
        asistenciasActivas: estadoFinalAsistencias,
      });
    } else {
      res
        .status(404)
        .json({ error: "Formulario no encontrado o no se pudo actualizar" });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar estado" });
  }
}

// Handler para guardar.js
async function handleGuardar(req, res, repo) {
  console.log("Recibiendo petición guardar (v2 - recuperación)");
  if (req.method !== "POST") return res.status(405).send("Método no permitido");

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

  const nuevoRegistro =
    asistenciaNumero === 1
      ? {
          nombre,
          correo,
          edad: edad || "",
          telefono: telefono || "",
          asociacion: asociacion || "",
          fecha,
          visitanteId,
          asistenciaNumero,
        }
      : {
          correo: correo || "",
          fecha,
          visitanteId,
          asistenciaNumero,
          id,
        };

  // 1. Verificar si la asistencia está activa (Server-side check)
  try {
    const respForm = await fetch(
      `https://api.github.com/repos/${repo}/contents/data/formularios.json?ref=main`,
      {
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        },
      },
    );
    if (!respForm.ok)
      throw new Error("No se pudo verificar el estado del formulario");

    const dataF = await respForm.json();
    const contentF = Buffer.from(dataF.content, "base64").toString();
    const forms = JSON.parse(contentF);
    const activeState = forms[id]?.asistenciasActivas?.[asistenciaNumero];

    if (!activeState) {
      return res
        .status(403)
        .send("❌ La asistencia no está activa en este momento.");
    }
  } catch (e) {
    console.error("Error verificando estado activo:", e);
    return res.status(500).send("❌ Error verificando estado de asistencia.");
  }

  const archivo = `respuestas/${id}/respuestas.json`;

  // 2. Intentar guardar con reintentos para manejar concurrencia
  try {
    let visitantesReemplazados = new Set();
    const result = await updateGitHubJSON(
      repo,
      archivo,
      `[skip ci] Registro de asistencia ${asistenciaNumero}: ${correo}`,
      async (registros) => {
        let modificado = false;

        // Sincronizar IDs por correo si existe (para unificar sesiones)
        if (correo) {
          registros.forEach((r) => {
            if (
              r.correo &&
              r.correo.toLowerCase() === correo.toLowerCase() &&
              r.visitanteId !== visitanteId
            ) {
              visitantesReemplazados.add(r.visitanteId);
              r.visitanteId = visitanteId;
              modificado = true;
            }
          });
        }

        // Verificar si ya existe el registro (por ID y número)
        // Nota: Si hubo sincronización arriba, ahora coincidirá aquí
        const existePorId = registros.find(
          (r) =>
            r.visitanteId === visitanteId &&
            r.asistenciaNumero === asistenciaNumero,
        );

        if (existePorId) {
          return modificado ? registros : null; // Guardar si hubo cambios, sino ignorar
        }

        // Validar secuencia de asistencias
        if (asistenciaNumero > 1) {
          const tienePrevia = registros.some(
            (r) =>
              (r.visitanteId === visitanteId ||
                (correo &&
                  r.correo &&
                  r.correo.toLowerCase() === correo.toLowerCase())) &&
              r.asistenciaNumero < asistenciaNumero,
          );

          if (!tienePrevia) {
            throw new Error(
              `❌ Debes completar la asistencia ${asistenciaNumero - 1} antes de registrar la ${asistenciaNumero}`,
            );
          }
        }

        // Agregar nuevo registro
        registros.push(nuevoRegistro);
        return registros;
      },
    );

    // Si hubo reemplazo de ID, intentar actualizar también los resultados de exámenes
    if (visitantesReemplazados.size > 0) {
      try {
        const archivoResultados = `evaluaciones/${id}/resultados.json`;
        await updateGitHubJSON(
          repo,
          archivoResultados,
          `[skip ci] Sincronización de examen para ID actualizado: ${visitanteId}`,
          async (resultados) => {
            let resModificado = false;
            if (Array.isArray(resultados)) {
              resultados.forEach((r) => {
                if (visitantesReemplazados.has(r.visitanteId)) {
                  r.visitanteId = visitanteId;
                  // Opcional: Agregar correo si no lo tiene, para futuras referencias
                  if (!r.correo && correo) r.correo = correo;
                  resModificado = true;
                }
              });
            }
            return resModificado ? resultados : null;
          },
        ).catch(() => {
          // Ignorar error si no existe el archivo de resultados o falla
          // (Es un best-effort para recuperar notas)
          console.log("No se pudo sincronizar examenes o no existían.");
        });
      } catch (e) {
        // Ignorar
      }
    }

    if (result.ok) {
      // Devolver JSON para que el frontend actualice el localStorage
      return res.status(200).json({
        ok: true,
        message: "✅ Asistencia registrada correctamente.",
        correo: correo, // Importante para persistencia al recuperar
      });
    }
  } catch (err) {
    if (err.message.includes("❌"))
      return res.status(400).json({ error: err.message });
    console.error("Error en handleGuardar:", err);
    return res.status(500).json({ error: "❌ Error al procesar asistencia." });
  }
}

// Handler para guardarEvaluacion.js
async function handleGuardarEvaluacion(req, res, repo) {
  if (req.method !== "POST") return res.status(405).send("Método no permitido");

  const { id, evaluation } = req.body;

  const archivo = `evaluaciones/${id}/evaluacion.json`;

  try {
    const result = await updateGitHubJSON(
      repo,
      archivo,
      `[skip vercel] Evaluación creada/actualizada para formulario ${id}`,
      async () => {
        // En este caso, sobrescribimos siempre con la nueva evaluación
        // No necesitamos leer la anterior, así que ignoramos el argumento
        return evaluation;
      },
    );

    if (result.ok) {
      res
        .status(200)
        .json({ ok: true, message: "✅ Evaluación guardada correctamente." });
    }
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ error: err.message || "Error al guardar evaluación" });
  }
}

// Handler para guardarFormulario.js
async function handleGuardarFormulario(req, res, repo) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    console.log("Recibiendo solicitud para guardar formulario...");

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

    // Validaciones básicas
    if (!id || !titulo) {
      return res.status(400).json({ error: "ID y título son requeridos" });
    }

    const archivoFormularios = `data/formularios.json`;

    if (!process.env.GITHUB_TOKEN) {
      return res.status(500).json({ error: "Token de GitHub no configurado" });
    }

    // Guardar usando el sistema de reintentos
    const result = await updateGitHubJSON(
      repo,
      archivoFormularios,
      `[skip vercel] Formulario creado: ${id}`,
      async (data) => {
        if (data[id]) {
          throw new Error(`❌ El formulario con ID '${id}' ya existe.`);
        }

        data[id] = {
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
        return data;
      },
    );

    if (!result.ok) throw new Error("No se pudo guardar el formulario");

    // Si hay evaluación, guardarla también
    if (evaluation && evaluation.length > 0) {
      try {
        const archivoEvaluacion = `evaluaciones/${id}/evaluacion.json`;
        const contenidoEvaluacion = Buffer.from(
          JSON.stringify(evaluation, null, 2),
        ).toString("base64");

        const guardarEvaluacion = await fetch(
          `https://api.github.com/repos/${repo}/contents/${archivoEvaluacion}`,
          {
            method: "PUT",
            headers: {
              Authorization: `token ${process.env.GITHUB_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: `[skip vercel] Evaluación creada para formulario ${id}`,
              content: contenidoEvaluacion,
              branch: "data",
            }),
          },
        );

        if (!guardarEvaluacion.ok) {
          console.warn(
            "Formulario creado pero no se pudo guardar la evaluación",
          );
        }
      } catch (evalError) {
        console.warn("Error al guardar evaluación:", evalError);
      }
    }

    console.log("Formulario creado exitosamente:", id);
    res.status(200).json({
      ok: true,
      message: "Formulario creado exitosamente",
      id: id,
    });
  } catch (err) {
    console.error("Error general en guardarFormulario:", err);
    res
      .status(500)
      .json({ error: "Error interno del servidor: " + err.message });
  }
}

// Handler para guardarResultadoExamen.js
async function handleGuardarResultadoExamen(req, res, repo) {
  if (req.method !== "POST") return res.status(405).send("Método no permitido");

  const { id, visitanteId, respuestas, puntaje } = req.body;
  const fecha = new Date().toISOString();

  const archivo = `evaluaciones/${id}/resultados.json`;

  // Leer el archivo actual desde GitHub (ELIMINADO LECTURA REDUNDANTE)
  // const respuesta = await fetch... (Eliminado porque updateGitHubJSON se encarga)

  try {
    const result = await updateGitHubJSON(
      repo,
      archivo,
      `[skip vercel] Resultado de examen: ${visitanteId}`,
      async (resultados) => {
        const existente = resultados.find((r) => r.visitanteId === visitanteId);
        if (existente) return null; // Ya existe

        resultados.push({ visitanteId, respuestas, puntaje, fecha });
        return resultados;
      },
    );

    if (result.ok) {
      res.status(200).json({
        ok: true,
        message: "✅ Examen enviado correctamente.",
        puntaje: puntaje,
      });
    }
  } catch (e) {
    console.error(e);
    res.status(500).send("❌ Error al guardar resultado del examen.");
  }
}

// Handler para limpiarFormulariosVencidos.js
async function handleLimpiarFormulariosVencidos(req, res, repo) {
  const archivoFormularios = `data/formularios.json`;

  try {
    // Cargar formulario.json
    // Cargar formularios.json usando la rama data
    const respuesta = await fetch(
      `https://api.github.com/repos/${repo}/contents/${archivoFormularios}?ref=main`,
      {
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!respuesta.ok) throw new Error("No se pudo acceder a formularios.json");

    const datos = await respuesta.json();
    const contenido = JSON.parse(
      Buffer.from(datos.content, "base64").toString(),
    );
    const sha = datos.sha;

    const ahora = new Date();
    const formulariosVigentes = {};
    const formulariosVencidos = [];

    // Revisar cada formulario
    for (const [id, info] of Object.entries(contenido)) {
      const fechaCreado = new Date(info.creado || info.fechaCierre); // fallback
      const diferenciaDias = (ahora - fechaCreado) / (1000 * 60 * 60 * 24);

      if (diferenciaDias >= 90) {
        formulariosVencidos.push(id);
      } else {
        formulariosVigentes[id] = info;
      }
    }

    // Si no hay nada para borrar
    if (formulariosVencidos.length === 0) {
      return res
        .status(200)
        .json({ mensaje: "✅ No hay formularios vencidos" });
    }

    // Actualizar formularios.json sin los vencidos
    // Actualizar formularios.json sin los vencidos usando updateGitHubJSON
    const result = await updateGitHubJSON(
      repo,
      archivoFormularios,
      `[skip vercel] ⏳ Eliminar formularios vencidos (${formulariosVencidos.join(", ")})`,
      async (formularios) => {
        // Re-verificar vencimientos sobre la data más fresca
        const ahora = new Date();
        const vigentes = {};

        for (const [id, info] of Object.entries(formularios)) {
          const fechaCreado = new Date(info.creado || info.fechaCierre);
          const diferenciaDias = (ahora - fechaCreado) / (1000 * 60 * 60 * 24);

          if (diferenciaDias < 90) {
            vigentes[id] = info;
          }
        }
        return vigentes;
      },
    );

    if (!result.ok) throw new Error("No se pudo actualizar formularios.json");

    // Borrar archivos de respuestas vencidas
    for (const id of formulariosVencidos) {
      const ruta = `respuestas/${id}/respuestas.json`;

      const archivoRes = await fetch(
        `https://api.github.com/repos/${repo}/contents/${ruta}?ref=main`,
        {
          headers: {
            Authorization: `token ${process.env.GITHUB_TOKEN}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (archivoRes.ok) {
        const datosArchivo = await archivoRes.json();
        await fetch(`https://api.github.com/repos/${repo}/contents/${ruta}`, {
          method: "DELETE",
          headers: {
            Authorization: `token ${process.env.GITHUB_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: `[skip vercel] ⏳ Eliminar respuestas de formulario vencido ${id}`,
            sha: datosArchivo.sha,
            branch: "main",
          }),
        });
      }
    }

    res.status(200).json({
      mensaje: `🧹 Formularios vencidos eliminados: ${formulariosVencidos.join(", ")}`,
      total: formulariosVencidos.length,
    });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ error: "❌ Error al limpiar formularios vencidos." });
  }
}

// Handler para listarFormularios.js
async function handleListarFormularios(req, res, repo) {
  const archivo = `data/formularios.json`;

  try {
    const respuesta = await fetch(
      `https://api.github.com/repos/${repo}/contents/${archivo}?ref=main`,
      {
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!respuesta.ok) throw new Error("No se pudo acceder a formularios.json");

    const datos = await respuesta.json();
    const contenido = JSON.parse(
      Buffer.from(datos.content, "base64").toString(),
    );

    res.status(200).json(contenido);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "❌ Error al obtener los formularios." });
  }
}

// Handler para listarImagenes.js
async function handleListarImagenes(req, res, repo) {
  const { carpeta } = req.query;

  if (!carpeta || (carpeta !== "especialidades" && carpeta !== "firmas")) {
    return res.status(400).json({ error: "Carpeta no válida" });
  }

  const ruta = `images/${carpeta}`;

  try {
    const respuesta = await fetch(
      `https://api.github.com/repos/${repo}/contents/${ruta}?ref=main`,
      {
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    let imagenes = [];

    if (respuesta.ok) {
      const archivos = await respuesta.json();

      // Filtrar solo archivos de imagen
      imagenes = archivos
        .filter(
          (archivo) =>
            archivo.type === "file" &&
            /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(archivo.name),
        )
        .map((archivo) => ({
          nombre: archivo.name,
          url: archivo.download_url,
          ruta: archivo.path,
        }));
    } else if (respuesta.status !== 404) {
      throw new Error(`Error ${respuesta.status}: ${respuesta.statusText}`);
    }

    res.status(200).json(imagenes);
  } catch (err) {
    console.error("Error al listar imágenes:", err);
    res.status(500).json({ error: "Error al listar imágenes" });
  }
}

// Handler para obtenerEvaluacion.js
async function handleObtenerEvaluacion(req, res, repo) {
  const { id } = req.query;

  if (!id) return res.status(400).json({ error: "ID no especificado" });

  const archivo = `evaluaciones/${id}/evaluacion.json`;

  try {
    const respuesta = await fetch(
      `https://api.github.com/repos/${repo}/contents/${archivo}?ref=main`,
      {
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!respuesta.ok) {
      // Si no encuentra el archivo, retornar array vacío en lugar de error
      if (respuesta.status === 404) {
        return res.status(200).json([]);
      }
      throw new Error(`Error ${respuesta.status}: ${respuesta.statusText}`);
    }

    const data = await respuesta.json();

    // Verificar que el contenido existe
    if (!data.content) {
      return res.status(200).json([]);
    }

    const decoded = Buffer.from(data.content, "base64").toString();

    // Verificar que el contenido decodificado no esté vacío
    if (!decoded.trim()) {
      return res.status(200).json([]);
    }

    const evaluacion = JSON.parse(decoded);

    // Verificar que sea un array
    if (!Array.isArray(evaluacion)) {
      return res.status(200).json([]);
    }

    res.status(200).json(evaluacion);
  } catch (err) {
    console.error("Error al obtener evaluación:", err);

    // En caso de error, retornar array vacío en lugar de error 500
    res.status(200).json([]);
  }
}

// Handler para obtenerFormulario.js
async function handleObtenerFormulario(req, res, repo) {
  const { id } = req.query;

  if (!id) return res.status(400).json({ error: "ID no especificado" });

  const archivo = `data/formularios.json`;

  try {
    const respuesta = await fetch(
      `https://api.github.com/repos/${repo}/contents/${archivo}?ref=main`,
      {
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!respuesta.ok) {
      return res.status(404).json({ error: "Formulario no encontrado" });
    }

    const data = await respuesta.json();
    const contenido = JSON.parse(
      Buffer.from(data.content, "base64").toString(),
    );

    if (!contenido[id]) {
      return res.status(404).json({ error: "Formulario no encontrado" });
    }

    const formulario = contenido[id];
    const fechaCierre = new Date(formulario.fechaCierre);
    const ahora = new Date();
    const estado = ahora > fechaCierre ? "cerrado" : "abierto";

    res.status(200).json({
      ...formulario,
      estado,
      asistenciasActivas: formulario.asistenciasActivas || {
        1: false,
        2: false,
      },
      imagenEspecialidad: formulario.imagenEspecialidad || null,
      imagenFirma1: formulario.imagenFirma1 || null,
      imagenFirma2: formulario.imagenFirma2 || null,
      imagenFirma3: formulario.imagenFirma3 || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener formulario" });
  }
}

// Handler para subirImagen.js
async function handleSubirImagen(req, res, repo) {
  if (req.method !== "POST") return res.status(405).send("Método no permitido");

  const { carpeta, nombre, contenido } = req.body;

  if (!carpeta || !nombre || !contenido) {
    return res.status(400).json({ error: "Datos incompletos" });
  }

  // Sanitizar y codificar nombre de archivo para URL
  const safeName = nombre.replace(/[^a-zA-Z0-9._-]/g, "_");
  // O usar el nombre original pero URI encoded
  const path = `images/${encodeURIComponent(carpeta)}/${encodeURIComponent(nombre)}`;

  try {
    // 1. Verificar si existe para obtener SHA (para sobrescritura)
    const verificar = await fetch(
      `https://api.github.com/repos/${repo}/contents/${path}?ref=main&t=${Date.now()}`,
      {
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        },
      },
    );

    let sha = null;
    if (verificar.ok) {
      const data = await verificar.json();
      sha = data.sha;
    }

    // 2. Subir (Crear o Actualizar)
    const guardar = await fetch(
      `https://api.github.com/repos/${repo}/contents/${path}`,
      {
        method: "PUT",
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `[skip vercel] Subir imagen: ${nombre} en ${carpeta}`,
          content: contenido,
          branch: "main",
          ...(sha && { sha }), // Incluir SHA si existe para hacer update
        }),
      },
    );

    if (guardar.ok) {
      // Usar raw.githubusercontent para asegurar que se sirve desde main
      const urlImagen = `https://raw.githubusercontent.com/${repo}/main/${path}`;

      res.status(200).json({
        ok: true,
        message: "✅ Imagen subida correctamente",
        url: urlImagen,
      });
    } else {
      const error = await guardar.json();
      // Si el error es SHA needed y no lo teníamos (race condition?), intentar una vez más?
      // Por ahora devolvemos el error.
      throw new Error(error.message || "Error al guardar en GitHub");
    }
  } catch (err) {
    console.error("Error al subir imagen:", err);
    res
      .status(500)
      .json({ error: err.message || "Error interno al subir imagen" });
  }
}

// Handler para verRespuestas.js
async function handleVerRespuestas(req, res, repo) {
  const { id } = req.query;

  if (!id) return res.status(400).json({ error: "ID no especificado" });

  const archivo = `respuestas/${id}/respuestas.json`;

  try {
    const respuesta = await fetch(
      `https://api.github.com/repos/${repo}/contents/${archivo}?ref=main`,
      {
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          "Content-Type": "application/json",
        },
      },
    );

    let registros = [];
    if (respuesta.ok) {
      const data = await respuesta.json();
      const decoded = Buffer.from(data.content, "base64").toString();
      registros = JSON.parse(decoded);
    }

    // Obtener resultados de exámenes si existen
    let resultadosExamen = [];
    try {
      const resExamen = await fetch(
        `https://api.github.com/repos/${repo}/contents/evaluaciones/${id}/resultados.json?ref=main`,
        {
          headers: {
            Authorization: `token ${process.env.GITHUB_TOKEN}`,
            "Content-Type": "application/json",
          },
        },
      );

      if (resExamen.ok) {
        const dataExamen = await resExamen.json();
        const decodedExamen = Buffer.from(
          dataExamen.content,
          "base64",
        ).toString();
        resultadosExamen = JSON.parse(decodedExamen);
      }
    } catch (error) {
      console.log("No hay resultados de examen o error al cargarlos");
    }

    // Combinar datos de asistencia con resultados de examen
    const datosCombinados = {
      asistencias: registros,
      examenes: resultadosExamen,
    };

    res.status(200).json(datosCombinados);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener respuestas" });
  }
}

// Handler para eliminarFormulario
async function handleEliminarFormulario(req, res, repo) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Método no permitido" });

  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "ID requerido" });

  const archivoFormularios = `data/formularios.json`;

  try {
    // 1. Eliminar del índice (formularios.json)
    const result = await updateGitHubJSON(
      repo,
      archivoFormularios,
      `[skip vercel] Eliminar formulario ${id}`,
      async (formularios) => {
        if (!formularios[id]) return null; // No existe, nada que borrar

        // Copiar para no mutar directo si fuera referencia (aunque aquí se pasa objeto nuevo)
        const nuevos = { ...formularios };
        delete nuevos[id];
        return nuevos;
      },
    );

    if (!result.ok && !result.skipped)
      throw new Error("Error al actualizar índice de formularios");

    // 2. Eliminar archivos asociados (Best effort)
    const rutasBorrar = [
      `respuestas/${id}/respuestas.json`,
      `evaluaciones/${id}/evaluacion.json`,
      `evaluaciones/${id}/resultados.json`,
    ];

    // Intentar borrar también la carpeta (GitHub API no borra carpetas vacías automáticamente a menos que se borren todos los archivos)
    // Pero como borramos archivos específicos, si eran los únicos, la carpeta desaparece 'virtualmente'.

    for (const ruta of rutasBorrar) {
      try {
        const archivoRes = await fetch(
          `https://api.github.com/repos/${repo}/contents/${ruta}?ref=main`,
          {
            headers: {
              Authorization: `token ${process.env.GITHUB_TOKEN}`,
              "Content-Type": "application/json",
            },
          },
        );

        if (archivoRes.ok) {
          const datos = await archivoRes.json();
          await fetch(`https://api.github.com/repos/${repo}/contents/${ruta}`, {
            method: "DELETE",
            headers: {
              Authorization: `token ${process.env.GITHUB_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: `[skip vercel] Eliminar datos asociados a formulario ${id}`,
              sha: datos.sha,
              branch: "main",
            }),
          });
        }
      } catch (e) {
        console.warn(`No se pudo borrar ${ruta} (tal vez no existía):`, e);
      }
    }

    res
      .status(200)
      .json({ ok: true, message: "Formulario eliminado correctamente" });
  } catch (err) {
    console.error("Error al eliminar formulario:", err);
    res.status(500).json({ error: "Error interno al eliminar formulario" });
  }
}

// Handler para eliminarImagen
async function handleEliminarImagen(req, res, repo) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Método no permitido" });

  const { carpeta, nombre } = req.body;
  if (!carpeta || !nombre)
    return res.status(400).json({ error: "Carpeta y nombre requeridos" });

  // Validar carpeta para seguridad
  if (carpeta !== "especialidades" && carpeta !== "firmas") {
    return res.status(400).json({ error: "Carpeta inválida" });
  }

  const ruta = `images/${carpeta}/${nombre}`;

  try {
    // Obtener SHA del archivo
    const getRes = await fetch(
      `https://api.github.com/repos/${repo}/contents/${ruta}?ref=main&t=${Date.now()}`,
      {
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          "Cache-Control": "no-cache",
        },
      },
    );

    if (!getRes.ok) {
      if (getRes.status === 404)
        return res.status(404).json({ error: "Imagen no encontrada" });
      throw new Error("Error al buscar imagen");
    }

    const data = await getRes.json();

    // Eliminar archivo
    const delRes = await fetch(
      `https://api.github.com/repos/${repo}/contents/${ruta}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: `[skip vercel] Eliminar imagen ${nombre}`,
          sha: data.sha,
          branch: "main",
        }),
      },
    );

    if (delRes.ok) {
      res.status(200).json({ ok: true, message: "Imagen eliminada" });
    } else {
      const errText = await delRes.text();
      throw new Error(`Error GitHub: ${errText}`);
    }
  } catch (err) {
    console.error("Error al eliminar imagen:", err);
    res.status(500).json({ error: "Error al procesar eliminación" });
  }
}

// Handler para subirTarea (Alumno) - VERSIÓN ACTUALIZADA (Usa Email)
async function handleSubirTarea(req, res, repo) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Método no permitido" });

  // Ahora esperamos 'email' también
  const { id, visitanteId, email, contenido, nombreArchivo } = req.body;

  if (!id || !contenido)
    return res.status(400).json({ error: "Datos incompletos" });

  // Usar email como identificador principal si existe, sino fallback a visitanteId
  const identificador = email || visitanteId;

  if (!identificador) {
    return res.status(400).json({
      error: "Se requiere un correo electrónico o ID para subir la tarea.",
    });
  }

  if (contenido.length > 5242880)
    return res
      .status(400)
      .json({ error: "El archivo excede el límite de 5MB" });
  if (!nombreArchivo.toLowerCase().endsWith(".pdf"))
    return res.status(400).json({ error: "Solo se permiten archivos PDF" });

  // Sanitizar identificador para nombre de archivo (reemplazar caracteres inválidos)
  const idSanitizado = identificador.replace(/[^a-zA-Z0-9.@_-]/g, "_");
  const pathPDF = `tareas_files/${id}/${idSanitizado}.pdf`;
  const pathMeta = `evaluaciones/${id}/tareas.json`;

  try {
    // 1. Verificar existencia previa para el SHA (sobrescritura)
    const checkPDF = await fetch(
      `https://api.github.com/repos/${repo}/contents/${pathPDF}?ref=main`,
      { headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` } },
    );
    let shaPDF = null;
    if (checkPDF.ok) {
      const d = await checkPDF.json();
      shaPDF = d.sha;
    }

    // 2. Guardar PDF
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
          ...(shaPDF && { sha: shaPDF }),
        }),
      },
    );

    if (!savePDF.ok) throw new Error("Error al guardar archivo PDF");

    // 3. Actualizar metadatos en tareas.json usando el identificador (Email preferiblemente)
    await updateGitHubJSON(
      repo,
      pathMeta,
      `[skip vercel] Registro tarea: ${identificador}`,
      async (tareas) => {
        if (Array.isArray(tareas) || !tareas) tareas = {};

        tareas[identificador] = {
          estado: "entregado",
          fecha: new Date().toISOString(),
          // URL directa al archivo raw
          url: `https://raw.githubusercontent.com/${repo}/main/${pathPDF}`,
          nota: null,
          nombreArchivoOriginal: nombreArchivo, // Guardar nombre original por si acaso
        };
        return tareas;
      },
    );

    res.status(200).json({ ok: true, message: "Tarea enviada correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al subir tarea: " + err.message });
  }
}

// Handler para calificarTareas (Instructor)
async function handleCalificarTareas(req, res, repo) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Método no permitido" });

  const { id, tareas } = req.body;
  if (!id || !tareas) return res.status(400).json({ error: "Faltan datos" });

  const path = `evaluaciones/${id}/tareas.json`;

  try {
    // Sobrescribir el JSON de tareas con la versión actualizada (que incluye notas)
    await updateGitHubJSON(
      repo,
      path,
      `[skip vercel] Calificación tareas ${id}`,
      async () => tareas,
    );
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Error calificarTareas:", err);
    res.status(500).json({ error: err.message });
  }
}

// Handler para eliminarTareasPDF
async function handleEliminarTareasPDF(req, res, repo) {
  // Stub seguro por ahora
  return res
    .status(200)
    .json({ ok: true, message: "Funcionalidad en mantenimiento." });
}

// Handler para listarEntregas (Instructor)
async function handleListarEntregas(req, res, repo) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Método no permitido" });

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: "Falta el ID" });

  const pathMeta = `evaluaciones/${id}/tareas.json`;
  try {
    const resp = await fetch(
      `https://api.github.com/repos/${repo}/contents/${pathMeta}?ref=main`,
      { headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` } },
    );
    if (!resp.ok) return res.status(200).json({}); // Si no existe, devolver vacío

    const data = await resp.json();
    const tareas = JSON.parse(Buffer.from(data.content, "base64").toString());
    res.status(200).json(tareas);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Handler consolidado para el Dashboard del Usuario (Tareas y Exámenes)
async function handleObtenerEstadoUsuario(req, res, repo) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Método no permitido" });
  const { visitanteId, email } = req.body;
  const archivoForms = `data/formularios.json`;
  try {
    const rForms = await fetch(
      `https://api.github.com/repos/${repo}/contents/${archivoForms}?ref=main`,
      { headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` } },
    );
    if (!rForms.ok) return res.status(200).json([]);
    const dForms = await rForms.json();
    const formularios = JSON.parse(
      Buffer.from(dForms.content, "base64").toString(),
    );
    const resultadoFinal = [];

    for (const [id, form] of Object.entries(formularios)) {
      // 1. Asistencia: Buscar todas las asistencias del usuario (por ID o Email)
      let asistenciasUsuario = [];
      let allUserIds = new Set([visitanteId]); // IDs vinculados a este usuario

      try {
        const rAsist = await fetch(
          `https://api.github.com/repos/${repo}/contents/respuestas/${id}/respuestas.json?ref=main`,
          { headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` } },
        );
        if (rAsist.ok) {
          const dAsist = await rAsist.json();
          const todosReg = JSON.parse(
            Buffer.from(dAsist.content, "base64").toString(),
          );

          // Filtrar registros que pertenecen a este usuario
          const registrosPropios = todosReg.filter((r) => {
            const rEmail = r.correo ? r.correo.trim().toLowerCase() : null;
            const uEmail = email ? email.trim().toLowerCase() : null;

            if (rEmail && uEmail) return rEmail === uEmail;
            if (uEmail && !rEmail) return r.visitanteId === visitanteId;
            if (!uEmail) return r.visitanteId === visitanteId;
            return false;
          });

          // Recolectar IDs vinculados
          allUserIds.add(visitanteId);
          registrosPropios.forEach((r) => {
            if (r.visitanteId) allUserIds.add(r.visitanteId);
          });

          asistenciasUsuario = registrosPropios.map((r) => r.asistenciaNumero);
        }
      } catch (e) {}
      if (asistenciasUsuario.length === 0) continue; // Solo mostrar si ha participado

      // 2. Tarea: Buscar DIRECTAMENTE por email o cualquiera de los IDs vinculados
      let infoTarea = null;
      if (form.tarea && form.tarea.activa) {
        try {
          const rTarea = await fetch(
            `https://api.github.com/repos/${repo}/contents/evaluaciones/${id}/tareas.json?ref=main`,
            { headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` } },
          );
          if (rTarea.ok) {
            const dTarea = await rTarea.json();
            const todasTareas = JSON.parse(
              Buffer.from(dTarea.content, "base64").toString(),
            );

            // PRIORIDAD 1: Buscar por Email (Nueva estrategia)
            if (email && todasTareas[email]) {
              infoTarea = todasTareas[email];
            }
            // PRIORIDAD 2: Buscar por IDs vinculados (Retrocompatibilidad)
            else {
              for (const uid of allUserIds) {
                if (todasTareas[uid]) {
                  infoTarea = todasTareas[uid];
                  break;
                }
              }
            }
          }
        } catch (e) {}
      }

      // 3. Examen: Buscar en cualquiera de los IDs vinculados
      let infoExamen = null;
      if (form.tieneEvaluacion) {
        try {
          const rExamen = await fetch(
            `https://api.github.com/repos/${repo}/contents/evaluaciones/${id}/resultados.json?ref=main`,
            { headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` } },
          );
          if (rExamen.ok) {
            const dExamen = await rExamen.json();
            const todosExamenes = JSON.parse(
              Buffer.from(dExamen.content, "base64").toString(),
            );

            // Buscar examen por cualquiera de los IDs
            infoExamen =
              todosExamenes.find((e) => allUserIds.has(e.visitanteId)) || null;
          }
        } catch (e) {}
      }

      resultadoFinal.push({
        id,
        titulo: form.titulo,
        creado: form.creado,
        asistencias: asistenciasUsuario,
        configTarea: form.tarea,
        miTarea: infoTarea,
        configExamen: form.tieneEvaluacion,
        miExamen: infoExamen,
        fechaCierre: form.fechaCierre, // Agregar fecha de cierre
      });
    }
    res
      .status(200)
      .json(
        resultadoFinal.sort((a, b) => new Date(b.creado) - new Date(a.creado)),
      );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}
