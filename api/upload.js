// api/upload.js
const IMGUR_CLIENT_ID = process.env.IMGUR_CLIENT_ID;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  // Verificar que viene de nuestra aplicación (opcional pero recomendado)
  const origin = req.headers.origin;
  const allowedOrigins = [
    'https://conquiguias.vercel.app',
    'http://localhost:3000'
  ];

  if (!allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: 'Origen no permitido' });
  }

  try {
    const formData = new FormData();
    
    // Convertir el buffer a blob
    const blob = new Blob([req.body], { type: req.headers['content-type'] });
    formData.append('image', blob);

    const response = await fetch('https://api.imgur.com/3/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Client-ID ${IMGUR_CLIENT_ID}`,
      },
      body: formData
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.data?.error || 'Error en Imgur API');
    }

    const data = await response.json();
    
    res.status(200).json({ 
      success: true, 
      link: data.data.link,
      id: data.data.id,
      deletehash: data.data.deletehash // Para poder eliminar después
    });

  } catch (error) {
    console.error('Error en upload API:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al subir la imagen' 
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb' // Límite de 10MB para las imágenes
    }
  }
};