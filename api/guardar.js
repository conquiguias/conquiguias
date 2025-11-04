export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Método no permitido');

  const { id, nombre, correo, edad, telefono, asociacion, visitanteId, asistenciaNumero } = req.body;
  const fecha = new Date().toISOString();
  
  // Para asistencias 2 y 3, no necesitamos todos los datos personales
  const nuevoRegistro = asistenciaNumero === 1 
    ? { nombre, correo, edad, telefono, asociacion, fecha, visitanteId, asistenciaNumero }
    : { fecha, visitanteId, asistenciaNumero, id };

  const archivo = `respuestas/${id}/respuestas.json`;
  const repo = "proyectoja/asistencia-especialidades";

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