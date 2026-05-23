/**
 * netlify/functions/album.js
 *
 * Carga y guarda el estado del álbum del usuario autenticado.
 *
 * GET  /.netlify/functions/album  → carga el álbum del usuario
 * PUT  /.netlify/functions/album  → guarda/actualiza el álbum
 *
 * Variables de entorno requeridas:
 *   MONGO_URI, MONGO_DB, JWT_SECRET
 */

const jwt  = require('jsonwebtoken');
const { MongoClient, ObjectId } = require('mongodb');

// ─── MongoDB (conexión reutilizable) ──────────────────────────────────────────
let cachedClient = null;

async function getDb() {
  if (!cachedClient) {
    cachedClient = new MongoClient(process.env.MONGO_URI);
    await cachedClient.connect();
  }
  return cachedClient.db(process.env.MONGO_DB || 'panini');
}

// ─── CORS ─────────────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS'
};

// ─── Verificar JWT ────────────────────────────────────────────────────────────
function verifyToken(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) throw { status: 401, message: 'Token no proporcionado' };

  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    throw { status: 401, message: 'Token inválido o expirado' };
  }
}

// ─── Handler principal ─────────────────────────────────────────────────────────
exports.handler = async (event) => {

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  // Autenticación
  let decoded;
  try {
    decoded = verifyToken(event);
  } catch (err) {
    return json(err.status || 401, { message: err.message });
  }

  try {
    const db = await getDb();
    const col = db.collection('albums');

    // ── GET: cargar álbum ──────────────────────────────────────────────────
    if (event.httpMethod === 'GET') {
      const doc = await col.findOne(
        { userId: decoded.userId },
        { projection: { _id: 0, userId: 0 } }  // no exponer campos internos
      );

      // Si no existe aún, devolver estado vacío (primera vez del usuario)
      return json(200, { album: doc || null });
    }

    // ── PUT: guardar álbum ─────────────────────────────────────────────────
    if (event.httpMethod === 'PUT') {
      let body;
      try {
        body = JSON.parse(event.body || '{}');
      } catch {
        return json(400, { message: 'Body inválido' });
      }

      const { album } = body;

      if (!album || typeof album !== 'object') {
        return json(400, { message: 'Datos del álbum inválidos' });
      }

      // Sanitizar: asegurarse de que no se sobreescriban campos de control
      const { stickers, transactions, settings, createdAt } = album;

      await col.updateOne(
        { userId: decoded.userId },
        {
          $set: {
            userId:       decoded.userId,
            stickers:     stickers     || {},
            transactions: transactions || [],
            settings:     settings     || {},
            createdAt:    createdAt    || Date.now(),
            updatedAt:    Date.now()
          }
        },
        { upsert: true }  // crea el documento si no existe
      );

      return json(200, { message: 'Álbum guardado correctamente' });
    }

    return json(405, { message: 'Método no permitido' });

  } catch (err) {
    console.error('[album] Error:', err);
    return json(500, { message: 'Error interno del servidor' });
  }
};

// ─── Helper ───────────────────────────────────────────────────────────────────
function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}
