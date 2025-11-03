// api/guardarAsistencia.js
export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  
    const { id, nombre, correo, edad, telefono, asociacion, accion } = req.body;
    // accion: "primera" | "segunda" | "tercera"
    if (!id || !telefono) return res.status(400).json({ error: "Falta id o teléfono" });
  
    const repo = "proyectoja/asistencia-especialidades";
    const archivoFormularios = `data/formularios.json`;
    const rutaRespuestas = `respuestas/${id}/respuestas.json`;
  
    try {
      // 1) Obtener metadata del formulario (para calcular ventanas) desde GitHub
      const respForm = await fetch(`https://api.github.com/repos/${repo}/contents/${archivoFormularios}`, {
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          "Content-Type": "application/json"
        }
      });
  
      if (!respForm.ok) {
        console.error("No pude leer formularios.json");
        return res.status(500).json({ error: "Error al leer formularios" });
      }
  
      const datosForm = await respForm.json();
      const contenidoForm = JSON.parse(Buffer.from(datosForm.content, "base64").toString());
      const formInfo = contenidoForm[id];
  
      if (!formInfo) return res.status(404).json({ error: "Formulario no encontrado" });
  
      // calculamos las ventanas relativas a formInfo.creado
      const creado = new Date(formInfo.creado || formInfo.fechaCierre || new Date().toISOString());
      const t1_inicio = creado.getTime();
      const t1_fin = t1_inicio + 30 * 60 * 1000; // 30 min primero
      const t2_inicio = t1_fin;
      const t2_fin = t2_inicio + 30 * 60 * 1000; // 30 min segundo
      const t3_inicio = t2_fin;
      const t3_fin = t3_inicio + 10 * 60 * 1000; // 10 min tercero
  
      const ahora = Date.now();
  
      let ventanaActiva = null;
      if (ahora >= t1_inicio && ahora <= t1_fin) ventanaActiva = "primera";
      else if (ahora > t2_inicio && ahora <= t2_fin) ventanaActiva = "segunda";
      else if (ahora > t3_inicio && ahora <= t3_fin) ventanaActiva = "tercera";
  
      // 2) Leer respuestas actuales (si existen)
      const resp = await fetch(`https://api.github.com/repos/${repo}/contents/${rutaRespuestas}`, {
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          "Content-Type": "application/json"
        }
      });
  
      let registros = [];
      let sha = null;
      if (resp.ok) {
        const data = await resp.json();
        registros = JSON.parse(Buffer.from(data.content, "base64").toString());
        sha = data.sha;
      } else {
        // no existe archivo aún: registros = []
        registros = [];
      }
  
      // 3) Buscar usuario por teléfono (único identificador)
      const idx = registros.findIndex(r => r.telefono === telefono);
      const usuarioExistente = idx !== -1 ? registros[idx] : null;
  
      // Si no hay ventana activa (fuera de horarios) -> error
      if (!ventanaActiva) {
        return res.status(400).json({ error: "No hay una ventana de asistencia activa ahora." , ventanas: {
          primera: { inicio: new Date(t1_inicio).toISOString(), fin: new Date(t1_fin).toISOString() },
          segunda: { inicio: new Date(t2_inicio).toISOString(), fin: new Date(t2_fin).toISOString() },
          tercera: { inicio: new Date(t3_inicio).toISOString(), fin: new Date(t3_fin).toISOString() }
        }});
      }
  
      const marcarFecha = new Date().toISOString();
  
      // Lógica por ventana
      if (ventanaActiva === "primera") {
        // Solo se permite crear registro nuevo en primera ventana.
        if (usuarioExistente) {
          return res.status(409).json({ error: "Usuario ya registrado (primera asistencia ya hecha)." });
        }
        // Crear nuevo registro con estructura de asistencias
        const nuevo = {
          nombre: nombre || "",
          correo: correo || "",
          edad: edad || "",
          telefono,
          asociacion: asociacion || "",
          fecha: marcarFecha,
          asistencias: {
            "1": { asistio: "Sí", fecha: marcarFecha },
            "2": { asistio: "No", fecha: null },
            "3": { asistio: "No", fecha: null }
          },
          // examen se calculará a la hora de mostrar
        };
        registros.push(nuevo);
        // Guardar en GitHub
      } else {
        // ventanas segunda o tercera: solo pueden marcar usuarios existentes
        if (!usuarioExistente) {
          return res.status(404).json({ error: "Usuario no registrado en primera asistencia; no puede marcar esta asistencia." });
        }
  
        // update dependiendo de la ventanaActiva
        const r = usuarioExistente;
  
        if (ventanaActiva === "segunda") {
          if (r.asistencias && r.asistencias["2"] && r.asistencias["2"].asistio === "Sí") {
            return res.status(409).json({ error: "Segunda asistencia ya registrada." });
          }
          // marcar segunda
          r.asistencias = r.asistencias || {};
          r.asistencias["2"] = { asistio: "Sí", fecha: marcarFecha };
          // si por alguna razón "1" no existe, lo dejamos como "No"
          if (!r.asistencias["1"]) r.asistencias["1"] = { asistio: "No", fecha: null };
        } else if (ventanaActiva === "tercera") {
          if (r.asistencias && r.asistencias["3"] && r.asistencias["3"].asistio === "Sí") {
            return res.status(409).json({ error: "Tercera asistencia ya registrada." });
          }
          // Solo permitir tercera si ya tiene primera y segunda como Sí
          const t1 = r.asistencias && r.asistencias["1"] && r.asistencias["1"].asistio === "Sí";
          const t2 = r.asistencias && r.asistencias["2"] && r.asistencias["2"].asistio === "Sí";
          if (!t1 || !t2) {
            return res.status(403).json({ error: "No cumple requisitos para tercera asistencia (debe haber asistido 1 y 2)." });
          }
          r.asistencias["3"] = { asistio: "Sí", fecha: marcarFecha };
        }
  
        // actualizar el arreglo registros
        registros[idx] = r;
      }
  
      // 4) Guardar el archivo actualizado en GitHub
      const contenidoCodificado = Buffer.from(JSON.stringify(registros, null, 2)).toString("base64");
      const guardar = await fetch(`https://api.github.com/repos/${repo}/contents/${rutaRespuestas}`, {
        method: "PUT",
        headers: {
          Authorization: `token ${process.env.GITHUB_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: `Actualizar asistencias para ${telefono} en ${id}`,
          content: contenidoCodificado,
          branch: "main",
          ...(sha && { sha })
        })
      });
  
      if (!guardar.ok) {
        const errObj = await guardar.json();
        console.error("Error guardando respuestas:", errObj);
        return res.status(500).json({ error: "Error al guardar respuestas." });
      }
  
      // 5) Devolver el registro actualizado
      const actualizado = registros.find(r => r.telefono === telefono);
      // determinar si puede hacer examen: necesita tener 3 asistencias 'Sí'
      const puedeExamen = actualizado.asistencias && Object.values(actualizado.asistencias).every(a => a && a.asistio === "Sí");
  
      res.status(200).json({ ok: true, registro: actualizado, puedeExamen });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error interno del servidor" });
    }
  }
  