export default async function handler(req, res) {
  const { accion, id, carpeta } = req.query;
  
  // Determinar qué acción ejecutar basado en los parámetros
  switch (accion) {
    case 'guardar':
      return await guardarRespuesta(req, res);
    case 'guardarEvaluacion':
      return await guardarEvaluacion(req, res);
    case 'guardarFormulario':
      return await guardarFormulario(req, res);
    case 'guardarResultadoExamen':
      return await guardarResultadoExamen(req, res);
    case 'limpiarFormulariosVencidos':
      return await limpiarFormulariosVencidos(req, res);
    case 'listarFormularios':
      return await listarFormularios(req, res);
    case 'listarImagenes':
      return await listarImagenes(req, res);
    case 'obtenerEvaluacion':
      return await obtenerEvaluacion(req, res);
    case 'obtenerFormulario':
      return await obtenerFormulario(req, res);
    case 'subirImagen':
      return await subirImagen(req, res);
    case 'verRespuestas':
      return await verRespuestas(req, res);
    default:
      return res.status(400).json({ error: 'Acción no válida' });
  }
}

// ========== FUNCIONES ORIGINALES (sin cambios) ==========

async function guardarRespuesta(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Método no permitido');

  const { id, nombre, correo, edad, telefono, asociacion, visitanteId, asistenciaNumero } = req.body;
  const fecha = new Date().toISOString();
  
  // Para asistencias 2 y 3, no necesitamos todos los datos personales
  const nuevoRegistro = asistenciaNumero === 1 
    ? { nombre, correo, edad, telefono, asociacion, fecha, visitanteId, asistenciaNumero }
    : { fecha, visitanteId, asistenciaNumero, id };

  const archivo = `respuestas/${id}/respuestas.json`;
  const repo = "conquiguias/conquiguias";

  // Leer el archivo actual desde GitHub
  const respuesta = await fetch(`https://api.github.com/repos/${repo}/contents/${archivo}`, {
    headers: {
      Authorization: `token ${process.env.GITHUB_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });

  let registros = [];
  let sha = null;

  if (respuesta.ok) {
    const data = await respuesta.json();
    const decoded = Buffer.from(data.content, 'base64').toString();
    registros = JSON.parse(decoded);
    sha = data.sha;
  }

  // Verificar si ya existe una asistencia del mismo número para este usuario
  const asistenciaExistente = registros.find(r => 
    r.visitanteId === visitanteId && r.asistenciaNumero === asistenciaNumero
  );

  if (asistenciaExistente) {
    return res.status(409).send("❌ Esta asistencia ya fue registrada");
  }

  // Validar tiempos de asistencia
  if (asistenciaNumero > 1) {
    // Verificar que las asistencias anteriores estén completadas
    const asistenciasAnteriores = registros.filter(r => 
      r.visitanteId === visitanteId && r.asistenciaNumero < asistenciaNumero
    );
    
    if (asistenciasAnteriores.length < asistenciaNumero - 1) {
      return res.status(400).send(`❌ Debes completar la asistencia ${asistenciaNumero - 1} antes de registrar la ${asistenciaNumero}`);
    }
  }

  // Agregar el nuevo registro
  registros.push(nuevoRegistro);
  const contenidoCodificado = Buffer.from(JSON.stringify(registros, null, 2)).toString('base64');

  // Guardar el archivo actualizado en GitHub
  const guardar = await fetch(`https://api.github.com/repos/${repo}/contents/${archivo}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${process.env.GITHUB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: `Nueva respuesta en ${archivo}`,
      content: contenidoCodificado,
      branch: 'main',
      ...(sha && { sha })
    })
  });

  if (guardar.ok) {
    res.status(200).send("✅ Respuesta guardada correctamente.");
  } else {
    const error = await guardar.json();
    console.error(error);
    res.status(500).send("❌ Error al guardar: " + JSON.stringify(error));
  }
}


async function guardarEvaluacion(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Método no permitido');

  const { id, evaluation } = req.body;

  const archivo = `evaluaciones/${id}/evaluacion.json`;
  const repo = "conquiguias/conquiguias";

  try {
    // Convertir evaluación a base64
    const contenidoCodificado = Buffer.from(JSON.stringify(evaluation, null, 2)).toString('base64');

    // Guardar en GitHub
    const guardar = await fetch(`https://api.github.com/repos/${repo}/contents/${archivo}`, {
      method: 'PUT',
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `Evaluación creada para formulario ${id}`,
        content: contenidoCodificado,
        branch: 'main'
      })
    });

    if (guardar.ok) {
      res.status(200).json({ ok: true, message: "✅ Evaluación guardada correctamente." });
    } else {
      const error = await guardar.json();
      res.status(500).json({ error: error.message || "Error al guardar evaluación" });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function guardarFormulario(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    console.log("Recibiendo solicitud para guardar formulario...");
    
    const { id, titulo, fechaCierre, evaluation, imagenEspecialidad, imagenFirma1, imagenFirma2, imagenFirma3 } = req.body;

    // Validaciones básicas
    if (!id || !titulo) {
      return res.status(400).json({ error: "ID y título son requeridos" });
    }

    const archivoFormularios = `data/formularios.json`;
    const repo = "conquiguias/conquiguias";

    if (!process.env.GITHUB_TOKEN) {
      return res.status(500).json({ error: "Token de GitHub no configurado" });
    }

    // Obtener archivo actual de formularios
    const resp = await fetch(`https://api.github.com/repos/${repo}/contents/${archivoFormularios}`, {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    let data = {};
    let sha = null;

    if (resp.ok) {
      const archivoJson = await resp.json();
      const contenido = Buffer.from(archivoJson.content, "base64").toString();
      data = JSON.parse(contenido);
      sha = archivoJson.sha;
    } else if (resp.status !== 404) {
      const errorText = await resp.text();
      console.error("Error al obtener formularios:", resp.status, errorText);
      return res.status(500).json({ error: "Error al acceder al repositorio de GitHub" });
    }

    // Validar si ya existe el ID
    if (data[id]) {
      return res.status(409).json({ error: `El formulario con ID '${id}' ya existe.` });
    }

    // Agregar nuevo formulario
    data[id] = {
      titulo,
      fechaCierre: fechaCierre || new Date(Date.now() + 70 * 60 * 1000).toISOString(),
      creado: new Date().toISOString(),
      tieneEvaluacion: !!(evaluation && evaluation.length > 0),
      imagenEspecialidad: imagenEspecialidad || null,
      imagenFirma1: imagenFirma1 || null,
      imagenFirma2: imagenFirma2 || null,
      imagenFirma3: imagenFirma3 || null
    };

    const nuevoContenido = Buffer.from(JSON.stringify(data, null, 2)).toString("base64");

    // Guardar formulario en GitHub
    const guardarFormulario = await fetch(`https://api.github.com/repos/${repo}/contents/${archivoFormularios}`, {
      method: "PUT",
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `Formulario creado: ${id}`,
        content: nuevoContenido,
        branch: "main",
        ...(sha && { sha }),
      }),
    });

    if (!guardarFormulario.ok) {
      const errorData = await guardarFormulario.text();
      console.error("Error al guardar formulario:", guardarFormulario.status, errorData);
      return res.status(500).json({ error: "Error al guardar en GitHub" });
    }

    // Si hay evaluación, guardarla también
    if (evaluation && evaluation.length > 0) {
      try {
        const archivoEvaluacion = `evaluaciones/${id}/evaluacion.json`;
        const contenidoEvaluacion = Buffer.from(JSON.stringify(evaluation, null, 2)).toString("base64");

        const guardarEvaluacion = await fetch(`https://api.github.com/repos/${repo}/contents/${archivoEvaluacion}`, {
          method: "PUT",
          headers: {
            Authorization: `token ${process.env.GITHUB_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: `Evaluación creada para formulario ${id}`,
            content: contenidoEvaluacion,
            branch: "main",
          }),
        });

        if (!guardarEvaluacion.ok) {
          console.warn("Formulario creado pero no se pudo guardar la evaluación");
        }
      } catch (evalError) {
        console.warn("Error al guardar evaluación:", evalError);
      }
    }

    console.log("Formulario creado exitosamente:", id);
    res.status(200).json({ 
      ok: true, 
      message: "Formulario creado exitosamente",
      id: id
    });

  } catch (err) {
    console.error("Error general en guardarFormulario:", err);
    res.status(500).json({ error: "Error interno del servidor: " + err.message });
  }
}

async function guardarResultadoExamen(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Método no permitido');

  const { id, visitanteId, respuestas, puntaje } = req.body;
  const fecha = new Date().toISOString();

  const archivo = `evaluaciones/${id}/resultados.json`;
  const repo = "conquiguias/conquiguias";

  // Leer el archivo actual desde GitHub
  const respuesta = await fetch(`https://api.github.com/repos/${repo}/contents/${archivo}`, {
    headers: {
      Authorization: `token ${process.env.GITHUB_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });

  let resultados = [];
  let sha = null;

  if (respuesta.ok) {
    const data = await respuesta.json();
    const decoded = Buffer.from(data.content, 'base64').toString();
    resultados = JSON.parse(decoded);
    sha = data.sha;
  }

  // Verificar si ya existe un resultado para este usuario
  const resultadoExistente = resultados.find(r => r.visitanteId === visitanteId);

  if (resultadoExistente) {
    return res.status(409).send("❌ Ya has realizado este examen.");
  }

  // Agregar el nuevo resultado
  const nuevoResultado = {
    visitanteId,
    respuestas,
    puntaje,
    fecha
  };

  resultados.push(nuevoResultado);
  const contenidoCodificado = Buffer.from(JSON.stringify(resultados, null, 2)).toString('base64');

  // Guardar el archivo actualizado en GitHub
  const guardar = await fetch(`https://api.github.com/repos/${repo}/contents/${archivo}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${process.env.GITHUB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: `Nuevo resultado de examen para ${id}`,
      content: contenidoCodificado,
      branch: 'main',
      ...(sha && { sha })
    })
  });

  if (guardar.ok) {
    res.status(200).json({ 
      ok: true, 
      message: "✅ Examen enviado correctamente.",
      puntaje: puntaje
    });
  } else {
    const error = await guardar.json();
    console.error(error);
    res.status(500).send("❌ Error al guardar resultado del examen.");
  }
}

async function limpiarFormulariosVencidos(req, res) {
  const repo = "conquiguias/conquiguias";
  const archivoFormularios = `data/formularios.json`;

  try {
    // Cargar formulario.json
    const respuesta = await fetch(`https://api.github.com/repos/${repo}/contents/${archivoFormularios}`, {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        "Content-Type": "application/json"
      }
    });

    if (!respuesta.ok) throw new Error("No se pudo acceder a formularios.json");

    const datos = await respuesta.json();
    const contenido = JSON.parse(Buffer.from(datos.content, 'base64').toString());
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
      return res.status(200).json({ mensaje: "✅ No hay formularios vencidos" });
    }

    // Actualizar formularios.json sin los vencidos
    const nuevoContenido = Buffer.from(JSON.stringify(formulariosVigentes, null, 2)).toString('base64');
    await fetch(`https://api.github.com/repos/${repo}/contents/${archivoFormularios}`, {
      method: "PUT",
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: `⏳ Eliminar formularios vencidos (${formulariosVencidos.join(", ")})`,
        content: nuevoContenido,
        sha,
        branch: "main"
      })
    });

    // Borrar archivos de respuestas vencidas
    for (const id of formulariosVencidos) {
      const ruta = `respuestas/${id}/respuestas.json`;

      const archivoRes = await fetch(`https://api.github.com/repos/${repo}/contents/${ruta}`, {
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          "Content-Type": "application/json"
        }
      });

      if (archivoRes.ok) {
        const datosArchivo = await archivoRes.json();
        await fetch(`https://api.github.com/repos/${repo}/contents/${ruta}`, {
          method: "DELETE",
          headers: {
            Authorization: `token ${process.env.GITHUB_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            message: `⏳ Eliminar respuestas de formulario vencido ${id}`,
            sha: datosArchivo.sha,
            branch: "main"
          })
        });
      }
    }

    res.status(200).json({
      mensaje: `🧹 Formularios vencidos eliminados: ${formulariosVencidos.join(", ")}`,
      total: formulariosVencidos.length
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "❌ Error al limpiar formularios vencidos." });
  }
}

async function listarFormularios(req, res) {
  const repo = "conquiguias/conquiguias";
  const archivo = `data/formularios.json`;

  try {
    const respuesta = await fetch(`https://api.github.com/repos/${repo}/contents/${archivo}`, {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        "Content-Type": "application/json"
      }
    });

    if (!respuesta.ok) throw new Error("No se pudo acceder a formularios.json");

    const datos = await respuesta.json();
    const contenido = JSON.parse(Buffer.from(datos.content, 'base64').toString());

    res.status(200).json(contenido);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "❌ Error al obtener los formularios." });
  }
}

async function listarImagenes(req, res) {
  const { carpeta } = req.query;

  if (!carpeta || (carpeta !== 'especialidades' && carpeta !== 'firmas')) {
    return res.status(400).json({ error: "Carpeta no válida" });
  }

  const repo = "conquiguias/conquiguias";
  const ruta = `images/${carpeta}`;

  try {
    const respuesta = await fetch(`https://api.github.com/repos/${repo}/contents/${ruta}`, {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    let imagenes = [];

    if (respuesta.ok) {
      const archivos = await respuesta.json();
      
      // Filtrar solo archivos de imagen
      imagenes = archivos
        .filter(archivo => 
          archivo.type === 'file' && 
          /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(archivo.name)
        )
        .map(archivo => ({
          nombre: archivo.name,
          url: archivo.download_url,
          ruta: archivo.path
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

async function obtenerEvaluacion(req, res) {
  const { id } = req.query;

  if (!id) return res.status(400).json({ error: "ID no especificado" });

  const archivo = `evaluaciones/${id}/evaluacion.json`;
  const repo = "conquiguias/conquiguias";

  try {
    const respuesta = await fetch(`https://api.github.com/repos/${repo}/contents/${archivo}`, {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

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
    
    const decoded = Buffer.from(data.content, 'base64').toString();
    
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

async function obtenerFormulario(req, res) {
  const { id } = req.query;

  if (!id) return res.status(400).json({ error: "ID no especificado" });

  const archivo = `data/formularios.json`;
  const repo = "conquiguias/conquiguias";

  try {
    const respuesta = await fetch(`https://api.github.com/repos/${repo}/contents/${archivo}`, {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (!respuesta.ok) {
      return res.status(404).json({ error: "Formulario no encontrado" });
    }

    const data = await respuesta.json();
    const contenido = JSON.parse(Buffer.from(data.content, 'base64').toString());

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
      imagenEspecialidad: formulario.imagenEspecialidad || null,
      imagenFirma1: formulario.imagenFirma1 || null,
      imagenFirma2: formulario.imagenFirma2 || null,
      imagenFirma3: formulario.imagenFirma3 || null
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener formulario" });
  }
}

async function subirImagen(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Método no permitido');

  const { carpeta, nombre, contenido, tipo } = req.body;

  if (!carpeta || !nombre || !contenido) {
    return res.status(400).json({ error: "Datos incompletos" });
  }

  const repo = "conquiguias/conquiguias";
  const archivo = `images/${carpeta}/${nombre}`;

  try {
    // Verificar si la imagen ya existe
    const verificar = await fetch(`https://api.github.com/repos/${repo}/contents/${archivo}`, {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (verificar.ok) {
      return res.status(409).json({ error: "❌ Ya existe una imagen con ese nombre" });
    }

    // Subir la imagen
    const guardar = await fetch(`https://api.github.com/repos/${repo}/contents/${archivo}`, {
      method: 'PUT',
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `Subir imagen: ${nombre} en ${carpeta}`,
        content: contenido,
        branch: 'main'
      })
    });

    if (guardar.ok) {
      res.status(200).json({ 
        ok: true, 
        message: "✅ Imagen subida correctamente",
        url: `https://conquiguias.vercel.app/images/${carpeta}/${nombre}`
      });
    } else {
      const error = await guardar.json();
      res.status(500).json({ error: error.message || "Error al subir imagen" });
    }
  } catch (err) {
    console.error("Error al subir imagen:", err);
    res.status(500).json({ error: "Error al subir imagen" });
  }
}

async function verRespuestas(req, res) {
  const { id } = req.query;

  if (!id) return res.status(400).json({ error: "ID no especificado" });

  const archivo = `respuestas/${id}/respuestas.json`;
  const repo = "conquiguias/conquiguias";

  try {
    const respuesta = await fetch(`https://api.github.com/repos/${repo}/contents/${archivo}`, {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    let registros = [];
    if (respuesta.ok) {
      const data = await respuesta.json();
      const decoded = Buffer.from(data.content, 'base64').toString();
      registros = JSON.parse(decoded);
    }

    // Obtener resultados de exámenes si existen
    let resultadosExamen = [];
    try {
      const resExamen = await fetch(`https://api.github.com/repos/${repo}/contents/evaluaciones/${id}/resultados.json`, {
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });

      if (resExamen.ok) {
        const dataExamen = await resExamen.json();
        const decodedExamen = Buffer.from(dataExamen.content, 'base64').toString();
        resultadosExamen = JSON.parse(decodedExamen);
      }
    } catch (error) {
      console.log('No hay resultados de examen o error al cargarlos');
    }

    // Combinar datos de asistencia con resultados de examen
    const datosCombinados = {
      asistencias: registros,
      examenes: resultadosExamen
    };

    res.status(200).json(datosCombinados);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener respuestas" });
  }
}