export default async function handler(req, res) {
    const { id } = req.query;
  
    if (!id) return res.status(400).json({ error: "ID no especificado" });
  
    const archivo = `evaluaciones/${id}/evaluacion.json`;
    const repo = "proyectoja/asistencia-especialidades";
  
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