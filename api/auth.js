const admin = require('firebase-admin');

// 🔐 Inicializar Firebase Admin
if (!admin.apps.length) {
  const serviceAccount = {
    type: "service_account",
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL
  };

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: "conquiguias-world-85ccd.firebasestorage.app"
  });
}

// 🔐 Lista de administradores
const ADMIN_EMAILS = process.env.ADMIN_EMAILS ? process.env.ADMIN_EMAILS.split(',') : ['admin@conquiguias.com'];

module.exports = async (req, res) => {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { action, data, token } = req.body;

    if (!action) {
      return res.status(400).json({ error: 'Acción no especificada' });
    }

    // 🔐 VERIFICAR AUTENTICACIÓN PARA ACCIONES PROTEGIDAS
    let user = null;
    if (token) {
      try {
        user = await admin.auth().verifyIdToken(token);
      } catch (error) {
        return res.status(401).json({ error: 'Token inválido o expirado' });
      }
    }

    // 🔹 REGISTRO DE USUARIO (existente - para index.html)
    if (action === 'register') {
      const { nombre, apellido, edad, sexo, pais, email, password, fotoBase64, fileName } = data;

      // Validaciones
      if (!nombre || !apellido || !email || !password) {
        return res.status(400).json({ error: 'Todos los campos son obligatorios' });
      }

      // Crear usuario en Auth
      const userRecord = await admin.auth().createUser({
        email: email,
        password: password,
        displayName: `${nombre} ${apellido}`,
        emailVerified: false
      });

      let fotoURL = null;

      // Subir foto si existe
      if (fotoBase64 && fileName) {
        const base64Data = fotoBase64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        
        const bucket = admin.storage().bucket();
        const file = bucket.file(`usuarios/${userRecord.uid}/${fileName}`);
        
        await file.save(buffer, {
          metadata: {
            contentType: `image/${fileName.split('.').pop()}`,
            metadata: { firebaseStorageDownloadTokens: userRecord.uid }
          }
        });

        fotoURL = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(file.name)}?alt=media&token=${userRecord.uid}`;

        // Actualizar perfil con foto
        await admin.auth().updateUser(userRecord.uid, {
          photoURL: fotoURL
        });
      }

      // Guardar datos en Firestore
      await admin.firestore().collection('usuarios').doc(userRecord.uid).set({
        nombre,
        apellido,
        edad,
        sexo,
        pais,
        email,
        fotoURL,
        emailVerificado: false,
        creado: admin.firestore.FieldValue.serverTimestamp()
      });

      // Enviar verificación de email
      const verificationLink = await admin.auth().generateEmailVerificationLink(email);
      
      // Aquí podrías integrar SendGrid o otro servicio de email
      console.log('Link de verificación:', verificationLink);

      return res.status(200).json({ 
        success: true, 
        message: 'Usuario registrado correctamente. Verifica tu email.',
        userId: userRecord.uid 
      });
    }

    // 🔹 VERIFICAR ESTADO DE USUARIO (existente)
    else if (action === 'checkAuth') {
      const { uid } = data;
      
      const user = await admin.auth().getUser(uid);
      const userDoc = await admin.firestore().collection('usuarios').doc(uid).get();
      
      return res.status(200).json({
        authenticated: true,
        user: {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          emailVerified: user.emailVerified,
          ...userDoc.data()
        }
      });
    }

    // 🔹 REENVIAR VERIFICACIÓN DE EMAIL (existente)
    else if (action === 'resendVerification') {
      const { email } = data;
      
      const verificationLink = await admin.auth().generateEmailVerificationLink(email);
      console.log('Nuevo link de verificación:', verificationLink);
      
      return res.status(200).json({ 
        success: true, 
        message: 'Email de verificación reenviado' 
      });
    }

    // 🔹 RECUPERAR CONTRASEÑA (existente)
    else if (action === 'resetPassword') {
      const { email } = data;
      
      const resetLink = await admin.auth().generatePasswordResetLink(email);
      console.log('Link de recuperación:', resetLink);
      
      return res.status(200).json({ 
        success: true, 
        message: 'Email de recuperación enviado' 
      });
    }

    // 🔹 NUEVAS ACCIONES PARA EL PANEL
    
    // 🔹 OBTENER PERFIL DE USUARIO
    else if (action === 'getProfile') {
      if (!user) return res.status(401).json({ error: 'No autenticado' });

      const userRecord = await admin.auth().getUser(user.uid);
      const userDoc = await admin.firestore().collection('usuarios').doc(user.uid).get();
      
      if (!userDoc.exists) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
      }

      return res.status(200).json({
        success: true,
        user: {
          uid: user.uid,
          email: userRecord.email,
          displayName: userRecord.displayName,
          photoURL: userRecord.photoURL,
          emailVerified: userRecord.emailVerified,
          ...userDoc.data()
        }
      });
    }

    // 🔹 ACTUALIZAR PERFIL
    else if (action === 'updateProfile') {
      if (!user) return res.status(401).json({ error: 'No autenticado' });

      const { nombre, apellido, edad, sexo, pais, fotoBase64, fileName } = data;

      let fotoURL = null;

      // Subir nueva foto si existe
      if (fotoBase64 && fileName) {
        const base64Data = fotoBase64.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        
        const bucket = admin.storage().bucket();
        const file = bucket.file(`usuarios/${user.uid}/${fileName}`);
        
        await file.save(buffer, {
          metadata: {
            contentType: `image/${fileName.split('.').pop()}`,
            metadata: { firebaseStorageDownloadTokens: user.uid }
          }
        });

        fotoURL = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(file.name)}?alt=media&token=${user.uid}`;

        // Actualizar foto en Auth
        await admin.auth().updateUser(user.uid, {
          photoURL: fotoURL,
          displayName: `${nombre} ${apellido}`
        });
      }

      // Actualizar datos en Firestore
      await admin.firestore().collection('usuarios').doc(user.uid).update({
        nombre,
        apellido,
        edad,
        sexo,
        pais,
        ...(fotoURL && { fotoURL }),
        actualizado: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.status(200).json({ 
        success: true, 
        message: 'Perfil actualizado correctamente' 
      });
    }

    // 🔹 OBTENER LISTA DE ADMINS
    else if (action === 'getAdmins') {
      return res.status(200).json({
        success: true,
        admins: ADMIN_EMAILS
      });
    }

    // 🔹 VERIFICAR ACCESO A ESPECIALIDADES
    else if (action === 'checkEspecialidadesAccess') {
      if (!user) return res.status(401).json({ error: 'No autenticado' });

      const userDoc = await admin.firestore().collection('usuarios').doc(user.uid).get();
      const userData = userDoc.data();
      
      const tieneAcceso = ADMIN_EMAILS.includes(userData.email);
      
      return res.status(200).json({
        success: true,
        tieneAcceso,
        esAdmin: ADMIN_EMAILS.includes(userData.email)
      });
    }

    // 🔹 OBTENER CERTIFICACIONES
    else if (action === 'getCertificaciones') {
      if (!user) return res.status(401).json({ error: 'No autenticado' });

      try {
        // Obtener el email del usuario
        const userRecord = await admin.auth().getUser(user.uid);
        const userEmail = userRecord.email;

        // Aquí integrarías con tu sistema de formularios existente
        // Por ahora retornamos datos de ejemplo
        const certificaciones = await obtenerCertificacionesUsuario(userEmail);
        
        return res.status(200).json({ 
          success: true, 
          certificaciones 
        });

      } catch (error) {
        console.error('Error obteniendo certificaciones:', error);
        return res.status(200).json({ 
          success: true, 
          certificaciones: [] 
        });
      }
    }

    // 🔹 OBTENER DATOS ADMIN
    else if (action === 'getAdminData') {
      if (!user) return res.status(401).json({ error: 'No autenticado' });

      const userDoc = await admin.firestore().collection('usuarios').doc(user.uid).get();
      const userData = userDoc.data();
      
      if (!ADMIN_EMAILS.includes(userData.email)) {
        return res.status(403).json({ error: 'Acceso denegado' });
      }

      // Obtener estadísticas
      const postsSnapshot = await admin.firestore().collection('posts').get();
      let pendingCount = 0;
      let approvedCount = 0;
      let rejectedCount = 0;

      postsSnapshot.forEach(doc => {
        const post = doc.data();
        switch (post.status) {
          case 'pending': pendingCount++; break;
          case 'approved': approvedCount++; break;
          case 'rejected': rejectedCount++; break;
          default: approvedCount++;
        }
      });

      // Obtener publicaciones pendientes
      const pendingPostsQuery = admin.firestore()
        .collection('posts')
        .where('status', '==', 'pending')
        .orderBy('timestamp', 'asc');

      const pendingSnapshot = await pendingPostsQuery.get();
      const pendingPosts = pendingSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

      return res.status(200).json({
        success: true,
        stats: { pendingCount, approvedCount, rejectedCount },
        pendingPosts,
        adminEmails: ADMIN_EMAILS
      });
    }

    // 🔹 APROBAR/RECHAZAR PUBLICACIÓN
    else if (action === 'moderatePost') {
      if (!user) return res.status(401).json({ error: 'No autenticado' });

      const { postId, action: moderationAction, reason } = data;

      // Verificar que es admin
      const userDoc = await admin.firestore().collection('usuarios').doc(user.uid).get();
      const userData = userDoc.data();
      
      if (!ADMIN_EMAILS.includes(userData.email)) {
        return res.status(403).json({ error: 'Acceso denegado' });
      }

      const postRef = admin.firestore().collection('posts').doc(postId);
      
      if (moderationAction === 'approve') {
        await postRef.update({
          status: 'approved',
          moderatedBy: user.uid,
          moderatedAt: new Date().toISOString()
        });
      } else if (moderationAction === 'reject') {
        await postRef.update({
          status: 'rejected', 
          moderatedBy: user.uid,
          moderatedAt: new Date().toISOString(),
          moderationReason: reason
        });
      }

      return res.status(200).json({ 
        success: true, 
        message: `Publicación ${moderationAction === 'approve' ? 'aprobada' : 'rechazada'}` 
      });
    }

    else {
      return res.status(400).json({ error: 'Acción no válida' });
    }

  } catch (error) {
    console.error('Error en API auth:', error);
    
    let errorMessage = 'Error interno del servidor';
    if (error.code === 'auth/email-already-exists') {
      errorMessage = 'Este correo electrónico ya está registrado';
    } else if (error.code === 'auth/invalid-email') {
      errorMessage = 'El formato del correo electrónico no es válido';
    } else if (error.code === 'auth/weak-password') {
      errorMessage = 'La contraseña debe tener al menos 6 caracteres';
    } else if (error.code === 'auth/user-not-found') {
      errorMessage = 'Usuario no encontrado';
    } else if (error.code === 'auth/invalid-id-token') {
      errorMessage = 'Token de autenticación inválido';
    }
    
    return res.status(400).json({ error: errorMessage });
  }
};

// 🔹 FUNCIÓN AUXILIAR PARA OBTENER CERTIFICACIONES
async function obtenerCertificacionesUsuario(userEmail) {
  // Esta función se integraría con tu sistema de formularios
  // Por ahora retornamos datos de ejemplo
  return [
    {
      id: '1',
      titulo: 'Especialidad en Cocina',
      fecha: new Date().toISOString(),
      asistenciasCompletadas: 3,
      examenRealizado: true,
      calificacion: 85,
      estado: 'Completado'
    },
    {
      id: '2', 
      titulo: 'Especialidad en Primeros Auxilios',
      fecha: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      asistenciasCompletadas: 2,
      examenRealizado: false,
      calificacion: null,
      estado: 'En progreso'
    }
  ];
}