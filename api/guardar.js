import { json } from 'micro';

let respuestas = []; // usar el mismo array que en verRespuestas.js

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end("Method not allowed");
  
  const datos = await json(req);
  const { id, visitanteId, numeroAsistencia, nombre, correo, telefono, edad, asociacion } = datos;

  // Buscar registro del usuario
  let registro = respuestas.find(r => r.id === id && r.visitanteId === visitanteId);
  const ahora = new Date();

  // Obtener fechas del formulario
  const form = await fetch(`https://tu-dominio.vercel.app/api/obtenerFormulario?id=${id}`).then(r=>r.json());
  const fechaInicio = new Date(form.fechaInicio);
  const DURACION_ASISTENCIAS = [30,30,10]; // minutos
  let acumulado=0;
  const fechas = DURACION_ASISTENCIAS.map(min=>{
    acumulado+=min;
    return new Date(fechaInicio.getTime()+acumulado*60000);
  });

  // Validar si el tiempo permitido de la asistencia ya pasó
  if(ahora>fechas[numeroAsistencia-1]){
    return res.status(400).json({ error: "Tiempo de asistencia expirado" });
  }

  if(!registro){
    // Primera vez
    if(numeroAsistencia!==1) return res.status(400).json({ error:"Debe registrar la primera asistencia primero"});
    registro = {id, visitanteId, nombre, correo, telefono, edad, asociacion, asistencias:[false,false,false], fecha:ahora.toISOString()};
    respuestas.push(registro);
  }

  if(registro.asistencias[numeroAsistencia-1]) return res.status(400).json({ error:"Asistencia ya registrada" });

  registro.asistencias[numeroAsistencia-1] = true;
  res.json({ ok:true });
}
