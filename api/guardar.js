export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  const { id, nombre, correo, telefono, edad, asociacion, visitanteId, numeroAsistencia } = req.body;

  if (!id || !visitanteId) return res.status(400).json({ error: "Faltan datos requeridos" });

  const repo = "proyectoja/asistencia-especialidades";
  const archivo = `respuestas/${id}/respuestas.json`;

  try {
    // Leer archivo existente desde GitHub
    const respuesta = await fetch(`https://api.github.com/repos/${repo}/contents/${archivo}`, {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    let registros = [];
    let sha;
    if (respuesta.ok) {
      const data = await respuesta.json();
      const decoded = Buffer.from(data.content, "base64").toString();
      registros = JSON.parse(decoded);
      sha = data.sha;
    }

    // Buscar si ya existe el visitante
    let registro = registros.find(r => r.visitanteId === visitanteId);

    if (!registro) {
      // Nuevo registro
      registro = {
        visitanteId,
        nombre,
        correo,
        telefono,
        edad,
        asociacion,
        asistencias: [false, false, false],
        fecha: new Date().toISOString(),
      };
      registros.push(registro);
    }

    // Registrar asistencia según el número
    const num = parseInt(numeroAsistencia) - 1;
    if (num >= 0 && num <= 2) registro.asistencias[num] = true;
    registro.fecha = new Date().toISOString();

    const contenidoBase64 = Buffer.from(JSON.stringify(registros, null, 2)).toString("base64");

    // Guardar en GitHub
    await fetch(`https://api.github.com/repos/${repo}/contents/${archivo}`, {
      method: "PUT",
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: `Registro asistencia #${numeroAsistencia} - ${visitanteId}`,
        content: contenidoBase64,
        sha,
      }),
    });

    res.status(200).json({ success: true, registro });
  } catch (err) {
    console.error("Error al guardar:", err);
    res.status(500).json({ error: "Error al guardar la asistencia." });
  }
}
