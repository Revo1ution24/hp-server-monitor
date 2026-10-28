const STORAGE_KEY = 'hpmon.session';
let memorySession = null;

export class ApiError extends Error {
  constructor(status, message, body = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

function readStorage() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStorage(session) {
  try {
    if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 隐私模式等场景下退化为内存会话
  }
}

export function getSession() {
  const session = memorySession || readStorage();
  if (!session || !session.token) return null;
  const expires = Date.parse(session.expiresAt);
  if (!Number.isFinite(expires) || expires <= Date.now() + 1000) {
    clearSession();
    return null;
  }
  memorySession = session;
  return session;
}

export function saveSession(session) {
  memorySession = session;
  writeStorage(session);
}

export function clearSession() {
  memorySession = null;
  writeStorage(null);
}

export function hasSession() {
  return getSession() !== null;
}

async function readBody(response) {
  try {
    const text = await response.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return { error: text }; }
  } catch {
    return null;
  }
}

async function request(path, options = {}) {
  const session = getSession();
  if (!session) throw new ApiError(401, '未登录或登录已过期');

  let response;
  try {
    response = await fetch(path, {
      ...options,
      cache: 'no-store',
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${session.token}`
      }
    });
  } catch (error) {
    throw new ApiError(0, '网络连接失败', error);
  }

  const body = await readBody(response);
  if (response.status === 401) {
    clearSession();
    throw new ApiError(401, body?.error || '未登录或登录已过期', body);
  }
  if (!response.ok) {
    throw new ApiError(response.status, body?.error || `请求失败（${response.status}）`, body);
  }
  return body;
}

export async function login(username, password) {
  let response;
  try {
    response = await fetch('/api/login', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
  } catch (error) {
    throw new ApiError(0, '无法连接服务器', error);
  }

  const body = await readBody(response);
  if (!response.ok) {
    const message = response.status === 429
      ? (body?.error || '尝试次数过多，请稍后再试')
      : (body?.error || '用户名或密码错误');
    throw new ApiError(response.status, message, body);
  }

  const session = {
    token: body.token,
    expiresAt: body.expiresAt,
    username: body.username
  };
  saveSession(session);
  return session;
}

export async function snapshot() {
  return request('/api/snapshot');
}

export async function history(metric, range = '5m') {
  return request(`/api/history?metric=${encodeURIComponent(metric)}&range=${encodeURIComponent(range)}`);
}

export async function health() {
  let response;
  try {
    response = await fetch('/api/health', { cache: 'no-store' });
  } catch (error) {
    throw new ApiError(0, '网络连接失败', error);
  }
  const body = await readBody(response);
  if (!response.ok) throw new ApiError(response.status, body?.error || '健康检查失败', body);
  return body;
}
