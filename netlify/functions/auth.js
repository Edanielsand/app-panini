/**
 * netlify/functions/auth.js
 *
 * Maneja la autenticación de usuarios.
 * Endpoint: POST /.netlify/functions/auth
 *
 * Body esperado: { action: 'login', email, password }
 *
 * Respuesta exitosa:
 *   { token: "<JWT>", user: { userId, email, displayName } }
 *
 * Dependencias (instalar en /netlify/functions con package.json propio,
 * o en la raíz del proyecto):
 *   npm install jsonwebtoken bcryptjs mongodb
 *
 * Variables de entorno requeridas en Netlify:
 *   MONGO_URI       → connection string de MongoDB Atlas
 *   MONGO_DB        → nombre de la base de datos (ej: "panini")
 *   JWT_SECRET      → string secreto para firmar tokens (mín. 32 chars)
 *   JWT_EXPIRES_IN  → duración del token (ej: "7d", "24h")  [opcional, default: 7d]
 */

const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const { MongoClient } = require('mongodb');

// ─── MongoDB connection (reutilizable entre invocaciones calientes) ──────────
let cachedClient = null;

async function getDb() {
  if (!cachedClient) {
    cachedClient = new MongoClient(process.env.MONGO_URI);
    await cachedClient.connect();
  }
  return cachedClient.db(process.env.MONGO_DB || 'panini');
}

// ─── CORS headers ────────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// ─── Handler principal ───────────────────────────────────────────────────────
exports.handler = async (event) => {

  // Preflight CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return json(405, { message: 'Método no permitido' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { message: 'Body inválido' });
  }

  const { action, email, password } = body;

  // ── Solo acción: login ────────────────────────────────────────────────────
  if (action !== 'login') {
    return json(400, { message: 'Acción no reconocida' });
  }

  if (!email || !password) {
    return json(400, { message: 'Correo y contraseña son requeridos' });
  }

  // ── Demo mode (sin validación en BD) ──────────────────────────────────────
  if (email.toLowerCase().trim() === 'demo@demo' && password === 'Demo$001') {
    const token = jwt.sign(
      {
        userId:      'demo-user',
        email:       'demo@demo',
        displayName: 'Demo',
        isDemo:      true
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return json(200, {
      token,
      user: {
        userId:      'demo-user',
        email:       'demo@demo',
        displayName: 'Demo',
        isDemo:      true
      }
    });
  }

  try {
    const db = await getDb();

    // Buscar usuario por email (colección: "users")
    // Documento esperado en MongoDB:
    // {
    //   _id: ObjectId,
    //   email: "user@example.com",
    //   passwordHash: "$2b$10$...",   ← bcrypt hash
    //   displayName: "Juan",
    //   active: true
    // }
    const user = await db.collection('users').findOne(
      { email: email.toLowerCase().trim() },
      { projection: { passwordHash: 1, displayName: 1, active: 1 } }
    );

    if (!user) {
      // Respuesta genérica para no revelar si el email existe
      return json(401, { message: 'Credenciales incorrectas' });
    }

    if (user.active === false) {
      return json(403, { message: 'Usuario desactivado. Contacta al administrador.' });
    }

    // Verificar contraseña
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return json(401, { message: 'Credenciales incorrectas' });
    }

    // Generar JWT
    const payload = {
      userId:      user._id.toString(),
      email:       email.toLowerCase().trim(),
      displayName: user.displayName || email.split('@')[0]
    };

    const token = jwt.sign(
      payload,
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    return json(200, {
      token,
      user: {
        userId:      payload.userId,
        email:       payload.email,
        displayName: payload.displayName
      }
    });

  } catch (err) {
    console.error('[auth] Error:', err);
    return json(500, { message: 'Error interno del servidor' });
  }
};

// ─── Helper ──────────────────────────────────────────────────────────────────
function json(statusCode, body) {
  return {
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}
