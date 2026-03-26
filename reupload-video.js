import admin from "firebase-admin";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

// Configurar Firebase
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
};

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: "conquiguias-world-85ccd.firebasestorage.app",
  });
}

const IMGUR_CLIENT_ID = process.env.IMGUR_CLIENT_ID;
const postId = "ROzIk27GyDgYxjdYkLzL";

async function main() {
  try {
    console.log(`[INFO] Re-subiendo video para post: ${postId}`);

    // 1. Obtener datos del post
    const db = admin.firestore();
    const postDoc = await db.collection("posts").doc(postId).get();

    if (!postDoc.exists) {
      throw new Error(`❌ Post no encontrado`);
    }

    const postData = postDoc.data();
    const currentMediaUrl = postData.mediaUrl;
    const oldDeletehash = postData.imgurData?.deletehash;

    console.log(`📍 URL actual: ${currentMediaUrl}`);
    console.log(`🔑 Deletehash: ${oldDeletehash}`);

    // 2. Descargar video
    console.log("[INFO] Descargando video...");
    
    let videoBuffer;
    let lastError;
    
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        console.log(`   Intento ${attempt}/5...`);
        const videoResponse = await fetch(currentMediaUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        if (!videoResponse.ok) {
          lastError = new Error(`HTTP ${videoResponse.status}`);
          if (attempt < 5) {
            const wait = attempt * 3000;
            console.log(`   ⏳ Esperando ${wait/1000}s antes de reintentar...`);
            await new Promise(r => setTimeout(r, wait));
            continue;
          }
          throw lastError;
        }
        
        videoBuffer = await videoResponse.buffer();
        console.log(`✓ Video descargado: ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);
        break;
      } catch (error) {
        lastError = error;
        if (attempt === 5) throw error;
      }
    }

    // 3. Re-subir como privado
    console.log("[INFO] Re-subiendo como privado...");
    
    const FormData = (await import("form-data")).default;
    const formData = new FormData();
    formData.append("image", videoBuffer, { filename: "video.mp4" });
    formData.append("privacy", "hidden");

    const imgurResponse = await fetch("https://api.imgur.com/3/upload", {
      method: "POST",
      headers: {
        Authorization: `Client-ID ${IMGUR_CLIENT_ID}`,
        ...formData.getHeaders(),
      },
      body: formData,
    });

    if (!imgurResponse.ok) {
      const err = await imgurResponse.json();
      throw new Error(err.data?.error || `Imgur error ${imgurResponse.status}`);
    }

    const imgurData = await imgurResponse.json();
    const newMediaUrl = imgurData.data.link;
    const newDeletehash = imgurData.data.deletehash;
    const newId = imgurData.data.id;

    console.log(`✓ Video subido: ${newMediaUrl}`);

    // 4. Actualizar Firestore
    console.log("[INFO] Actualizando base de datos...");
    await db.collection("posts").doc(postId).update({
      mediaUrl: newMediaUrl,
      imgurData: {
        id: newId,
        deletehash: newDeletehash,
      },
    });
    console.log("✓ Base de datos actualizada");

    // 5. Eliminar anterior
    if (oldDeletehash) {
      console.log("[INFO] Eliminando video anterior...");
      try {
        await fetch(`https://api.imgur.com/3/image/${oldDeletehash}`, {
          method: "DELETE",
          headers: { Authorization: `Client-ID ${IMGUR_CLIENT_ID}` },
        });
        console.log("✓ Video anterior eliminado");
      } catch (e) {
        console.log("⚠ No se eliminó anterior (OK)");
      }
    }

    console.log("\n✅ ¡COMPLETADO!\n");
    console.log(`📍 Nueva URL: ${newMediaUrl}`);
    console.log(`🔒 Estado: PRIVADO en Imgur`);
    console.log(`\nPuedes verificar en:\nhttps://conquiguias.xyz/share/${postId}\n`);

    process.exit(0);
  } catch (error) {
    console.error("\n❌ ERROR:", error.message, "\n");
    process.exit(1);
  }
}

main();
