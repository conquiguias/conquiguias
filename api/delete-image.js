// api/delete-image.js
const IMGUR_CLIENT_ID = process.env.IMGUR_CLIENT_ID;

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { deletehash } = req.body;

  if (!deletehash) {
    return res.status(400).json({ error: 'Deletehash requerido' });
  }

  try {
    const response = await fetch(`https://api.imgur.com/3/image/${deletehash}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Client-ID ${IMGUR_CLIENT_ID}`,
      }
    });

    if (!response.ok) {
      throw new Error('Error al eliminar imagen de Imgur');
    }

    res.status(200).json({ 
      success: true, 
      message: 'Imagen eliminada correctamente' 
    });

  } catch (error) {
    console.error('Error en delete-image API:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Error al eliminar la imagen' 
    });
  }
}