/**
 * netlify/functions/users.js
 *
 * Devuelve el progreso de todos los usuarios para el módulo de comparación.
 *
 * GET /.netlify/functions/users
 *
 * Respuesta:
 * {
 *   users: [
 *     {
 *       userId, displayName,
 *       percent, owned, duplicates, missing,
 *       stickers   ← objeto completo para comparar cartas
 *     },
 *     ...
 *   ]
 * }
 *
 * Variables de entorno requeridas: MONGO_URI, MONGO_DB, JWT_SECRET
 */

const jwt  = require('jsonwebtoken');
const { MongoClient } = require('mongodb');

// ─── MongoDB ──────────────────────────────────────────────────────────────────
let cachedClient = null;

async function getDb() {
  if (!cachedClient) {
    cachedClient = new MongoClient(process.env.MONGO_URI);
    await cachedClient.connect();
  }
  return cachedClient.db(process.env.MONGO_DB || 'panini');
}

// ─── CORS ──────────────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS'
};

// ─── Verificar JWT ─────────────────────────────────────────────────────────────
function verifyToken(event) {
  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) throw { status: 401, message: 'Token no proporcionado' };

  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw { status: 401, message: 'Token inválido o expirado' };
  }
}

// ─── Constantes del álbum (para calcular progreso server-side) ────────────────
const TOTAL_STICKERS = 980;   // 48 equipos × 20 + 20 especiales

function computeProgress(stickers = {}) {
  let owned = 0;
  let duplicates = 0;

  for (const key in stickers) {
    const s = stickers[key];
    if (s.owned > 0) owned++;
    duplicates += s.duplicates || 0;
  }

  return {
    owned,
    duplicates,
    missing:  TOTAL_STICKERS - owned,
    percent:  parseFloat(((owned / TOTAL_STICKERS) * 100).toFixed(2))
  };
}

// ─── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return json(405, { message: 'Método no permitido' });
  }

  // Requiere autenticación
  let decoded;
  try {
    decoded = verifyToken(event);
  } catch (err) {
    return json(err.status || 401, { message: err.message });
  }

  try {
    const db = await getDb();

    // Obtener todos los álbumes
    const albums = await db.collection('albums')
      .find({}, { projection: { userId: 1, stickers: 1 } })
      .toArray();

    // Obtener displayNames de la colección users
    const userIds = albums.map(a => a.userId);
    const usersInfo = await db.collection('users')
      .find(
        { _id: { $in: userIds.map(id => {
          try { return require('mongodb').ObjectId.createFromHexString(id); }
          catch { return id; }
        }) } },
        { projection: { displayName: 1, email: 1 } }
      )
      .toArray();

    // Indexar por userId string para lookup rápido
    const userMap = {};
    usersInfo.forEach(u => {
      userMap[u._id.toString()] = u.displayName || u.email?.split('@')[0] || 'Usuario';
    });

    // Armar respuesta
    const users = albums.map(a => {
      const progress = computeProgress(a.stickers);
      return {
        userId:      a.userId,
        displayName: userMap[a.userId] || 'Usuario',
        isCurrentUser: a.userId === decoded.userId,
        ...progress,
        stickers:    a.stickers || {}   // incluir stickers completos para comparación
      };
    });

    // Ordenar por progreso descendente
    users.sort((a, b) => b.percent - a.percent);

    return json(200, { users });

  } catch (err) {
    console.error('[users] Error:', err);
    return json(500, { message: 'Error interno del servidor' });
  }
};

// ─── Helper ────────────────────────────────────────────────────────────────────
function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}
