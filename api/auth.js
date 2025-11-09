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
    const { action, data } = req.body;

    if (!action) {
      return res.status(400).json({ error: 'Acción no especificada' });
    }

    // 🔹 REGISTRO DE USUARIO
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

    // 🔹 VERIFICAR ESTADO DE USUARIO
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

    // 🔹 REENVIAR VERIFICACIÓN DE EMAIL
    else if (action === 'resendVerification') {
      const { email } = data;
      
      const verificationLink = await admin.auth().generateEmailVerificationLink(email);
      console.log('Nuevo link de verificación:', verificationLink);
      
      return res.status(200).json({ 
        success: true, 
        message: 'Email de verificación reenviado' 
      });
    }

    // 🔹 RECUPERAR CONTRASEÑA
    else if (action === 'resetPassword') {
      const { email } = data;
      
      const resetLink = await admin.auth().generatePasswordResetLink(email);
      console.log('Link de recuperación:', resetLink);
      
      return res.status(200).json({ 
        success: true, 
        message: 'Email de recuperación enviado' 
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
    }
    
    return res.status(400).json({ error: errorMessage });
  }
};