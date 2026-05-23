/**
 * api.js
 * Módulo central de comunicación con las Netlify Functions.
 * Maneja: autenticación JWT, carga/guardado de datos en la nube,
 * y consulta del avance de otros usuarios.
 *
 * Uso: importar como módulo ES desde los HTML.
 *   import { login, logout, saveAlbum, loadAlbum, getAllUsers } from './api.js';
 */

// ─── Configuración ───────────────────────────────────────────────────────────

const API_BASE   = '/.netlify/functions';   // Netlify Functions base path
const TOKEN_KEY  = 'panini_jwt';            // clave en localStorage
const USER_KEY   = 'panini_user';           // datos del usuario en caché

// ─── Helpers internos ────────────────────────────────────────────────────────

/**
 * Realiza una petición autenticada a una Netlify Function.
 * Si el token expiró (401), limpia la sesión y redirige al login.
 */
async function apiFetch(endpoint, options = {}) {
  const token = getToken();

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const res = await fetch(`${API_BASE}/${endpoint}`, {
    ...options,
    headers
  });

  // Token expirado o inválido → cerrar sesión
  if (res.status === 401) {
    logout();
    window.location.replace('./index.html');
    throw new Error('Sesión expirada. Inicia sesión de nuevo.');
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.message || `Error ${res.status}`);
  }

  return data;
}

// ─── Token / Sesión ──────────────────────────────────────────────────────────

/** Guarda el token JWT en localStorage */
function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

/** Obtiene el token JWT desde localStorage */
function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

/** Guarda la información básica del usuario en caché */
function setUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/**
 * Retorna true si hay un token almacenado.
 * No valida expiración en el cliente (eso lo hace el servidor).
 */
export function isAuthenticated() {
  return !!getToken();
}

/** Devuelve el usuario en caché (sin llamada al servidor) */
export function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY)) || null;
  } catch {
    return null;
  }
}

// ─── Auth ────────────────────────────────────────────────────────────────────

/**
 * Inicia sesión con email y contraseña.
 * Llama a /.netlify/functions/auth → POST /login
 * Guarda el JWT y los datos básicos del usuario.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ user, token }>}
 */
export async function login(email, password) {
  const data = await apiFetch('auth', {
    method: 'POST',
    body: JSON.stringify({ action: 'login', email, password })
  });

  setToken(data.token);
  setUser(data.user);

  return data;
}

/**
 * Cierra sesión localmente (borra token y caché).
 * No hay llamada al servidor (tokens son stateless con JWT).
 */
export function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// ─── Álbum del usuario ───────────────────────────────────────────────────────

/**
 * Carga el estado del álbum del usuario autenticado desde MongoDB.
 * Llama a /.netlify/functions/album → GET
 *
 * @returns {Promise<object>} El state del álbum (stickers, transactions, settings…)
 */
export async function loadAlbum() {
  const data = await apiFetch('album', { method: 'GET' });
  return data.album;   // { stickers, transactions, settings, createdAt }
}

/**
 * Guarda el estado completo del álbum en MongoDB.
 * Llama a /.netlify/functions/album → PUT
 *
 * @param {object} albumState  El objeto `state` de la app
 * @returns {Promise<void>}
 */
export async function saveAlbum(albumState) {
  // No enviamos campos internos de UI
  const { hasUnsavedChanges, lastSavedAt, ...cleanState } = albumState;

  await apiFetch('album', {
    method: 'PUT',
    body: JSON.stringify({ album: cleanState })
  });
}

// ─── Usuarios (módulo de comparación) ────────────────────────────────────────

/**
 * Obtiene el progreso resumido de todos los usuarios.
 * Llama a /.netlify/functions/users → GET
 *
 * Retorna un array de:
 * {
 *   userId, displayName,
 *   percent, owned, duplicates, missing,
 *   stickers   // objeto completo { "MEX-1": { owned, duplicates }, ... }
 * }
 *
 * @returns {Promise<Array>}
 */
export async function getAllUsers() {
  const data = await apiFetch('users', { method: 'GET' });
  return data.users;
}
