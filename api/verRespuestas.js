let respuestas = []; // memoria, cada objeto: {id, visitanteId, nombre, correo, telefono, edad, asociacion, asistencias:[true,false,false], fecha}

export default function handler(req, res) {
  const { id } = req.query;
  const formRespuestas = respuestas.filter(r => r.id === id);
  res.json(formRespuestas);
}
