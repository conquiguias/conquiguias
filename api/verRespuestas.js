export default async function handler(req, res) {
    const { id } = req.query;
  
    if (!id) return res.status(400).json({ error: "ID no especificado" });
  
    const archivo = `respuestas/${id}/respuestas.json`;
    const repo = "proyectoja/asistencia-especialidades";
  
    try {
      const respuesta = await fetch(`https://api.github.com/repos/${repo}/contents/${archivo}`, {
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
  
      if (!respuesta.ok) return res.status(200).json([]); // No hay respuestas aún
  
      const data = await respuesta.json();
      const decoded = Buffer.from(data.content, 'base64').toString();
      const registros = JSON.parse(decoded);
  
      res.status(200).json(registros);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error al obtener respuestas" });
    }
  }
  