let formularios = [
  {
    id: "especialidad1",
    titulo: "Especialidad Conquistadores",
    fechaInicio: new Date().toISOString(), // fecha de inicio
    fechaCierre: new Date(Date.now() + 3600 * 1000).toISOString() // 1 hora de disponibilidad
  }
];

export default function handler(req, res) {
  const { id } = req.query;
  const form = formularios.find(f => f.id === id);
  if (!form) return res.status(404).json({ error: "Formulario no encontrado" });
  res.json(form);
}
