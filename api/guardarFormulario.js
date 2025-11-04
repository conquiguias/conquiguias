export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Método no permitido");

  const { id, titulo, fechaCierre, evaluation } = req.body;

  const archivoFormularios = `data/formularios.json`;
  const repo = "proyectoja/asistencia-especialidades";

  try {
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
    }

    // ✅ Validar si ya existe el ID
    if (data[id]) {
      return res.status(409).json({ error: `El formulario con ID '${id}' ya existe.` });
    }

    // ✅ Agregar nuevo formulario
    data[id] = {
      titulo,
      fechaCierre,
      creado: new Date().toISOString(),
      tieneEvaluacion: !!evaluation
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
      const error = await guardarFormulario.json();
      return res.status(500).json({ error: error.message || "Error al guardar formulario" });
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
          // No fallamos aquí, solo registramos el warning
        }
      } catch (evalError) {
        console.warn("Error al guardar evaluación:", evalError);
        // No fallamos el proceso principal por un error en la evaluación
      }
    }

    res.status(200).json({ ok: true, message: "Formulario creado exitosamente" });

  } catch (err) {
    console.error("Error general:", err);
    res.status(500).json({ error: err.message || "Error interno del servidor" });
  }
}