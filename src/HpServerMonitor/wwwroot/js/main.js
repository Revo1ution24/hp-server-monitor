import * as api from './api.js';
import * as fmt from './format.js';
import * as ui from './ui.js';
import * as charts from './charts.js';
import { Realtime } from './realtime.js';

import overview from './views/overview.js';
import cpu from './views/cpu.js';
import gpu from './views/gpu.js';
import memory from './views/memory.js';
import storage from './views/storage.js';
import network from './views/network.js';
import fans from './views/fans.js';
import settings from './views/settings.js';

const VIEWS = { overview, cpu, gpu, memory, storage, network, fans, settings };

const els = {
  boot: document.getElementById('boot'),
  login: document.getElementById('login'),
  loginForm: document.getElementById('login-form'),
  loginUser: document.getElementById('login-user'),
  loginPass: document.getElementById('login-pass'),
  loginError: document.getElementById('login-error'),
  loginSubmit: document.getElementById('login-submit'),
  app: document.getElementById('app'),
  view: document.getElementById('view'),
  sidebar: document.getElementById('sidebar'),
  liquid: document.getElementById('liquid'),
  pageTitle: document.getElementById('page-title'),
  pageEyebrow: document.getElementById('page-eyebrow'),
  pageSubtitle: document.getElementById('page-subtitle'),
  hostName: document.getElementById('host-name'),
  hostUptime: document.getElementById('host-uptime'),
  hostBadge: document.querySelector('.host-badge'),
  livePill: document.getElementById('live-pill'),
  liveText: document.getElementById('live-text')
};

const state = {
  snapshot: null,
  lastUpdateAt: 0,
  wsConnected: false,
  realtime: null,
  active: null,
  activeId: null,
  polling: false,
  lastPollAt: 0,
  loginBusy: false,
  lastUsername: ''
};

const ctx = {
  api,
  format: fmt,
  ui,
  charts,
  getSnapshot: () => state.snapshot,
  toast: ui.toast,
  navigate: (id) => {
    if (!VIEWS[id]) return;
    if (location.hash === `#/${id}`) route();
    else location.hash = `#/${id}`;
  },
  onLogout: () => {
    api.clearSession();
    showLogin('已退出登录');
  },
  onReconnect: () => {
    if (!state.realtime) startRealtime();
    else state.realtime.reconnectNow();
    ui.toast('正在重新连接实时通道…');
  },
  setReducedMotion: (enabled) => {
    try { localStorage.setItem('hpmon.reduceMotion', enabled ? '1' : '0'); } catch { }
    ui.setReducedMotion(enabled);
  },
  reducedMotion: () => ui.reducedMotion()
};

function initMotion() {
  try {
    const saved = localStorage.getItem('hpmon.reduceMotion');
    if (saved === '1' || saved === '0') {
      document.documentElement.dataset.reduceMotion = saved;
      return;
    }
    document.documentElement.dataset.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? '1' : '0';
  } catch {
    // 忽略隐私模式下的存储异常
  }
}

function setLoginError(message) {
  if (!message) {
    els.loginError.hidden = true;
    els.loginError.textContent = '';
    return;
  }
  els.loginError.hidden = false;
  els.loginError.textContent = message;
}

function showLogin(message = '', clearSession = false) {
  if (clearSession) api.clearSession();
  if (state.realtime) {
    state.realtime.stop();
    state.realtime = null;
  }
  state.snapshot = null;
  state.lastUpdateAt = 0;
  state.wsConnected = false;
  state.active?.destroy?.();
  state.active = null;
  state.activeId = null;
  state.loginBusy = false;

  els.boot.hidden = true;
  els.app.hidden = true;
  els.login.hidden = false;
  els.loginSubmit.disabled = false;
  els.loginSubmit.textContent = '登录';
  setLoginError(message);

  if (!els.loginUser.value && state.lastUsername)
    els.loginUser.value = state.lastUsername;

  window.setTimeout(() => {
    if (els.loginUser.value) els.loginPass.focus();
    else els.loginUser.focus();
  }, 60);
}

function showApp() {
  els.boot.hidden = true;
  els.login.hidden = true;
  els.app.hidden = false;

  if (!state.realtime) startRealtime();
  if (state.snapshot) updateHost();

  route();
  requestAnimationFrame(updateLiquid);
}

function startRealtime() {
  if (state.realtime) state.realtime.stop();
  state.realtime = new Realtime({
    onSnapshot: handleSnapshot,
    onStatus: (status) => {
      state.wsConnected = status.connected;
      updateLivePill();
    },
    onAuthError: () => showLogin('登录已过期，请重新登录', true)
  });
  state.realtime.start();
}

function handleSnapshot(snapshot) {
  if (!snapshot) return;
  state.snapshot = snapshot;
  state.lastUpdateAt = Date.now();

  updateHost();
  if (state.active?.update) {
    try {
      state.active.update(snapshot);
    } catch (error) {
      console.error(error);
    }
  }
  updateLivePill();
}

function updateHost() {
  const system = state.snapshot?.system;
  ui.setText(els.hostName, system?.hostname || '—');
  ui.setText(els.hostUptime, fmt.isNumber(system?.uptimeSeconds) ? `已运行 ${fmt.uptime(system.uptimeSeconds)}` : '');
  if (system) {
    els.hostBadge.title = [system.osName, system.osVersion].filter(Boolean).join(' ');
  }
}

function updateLivePill() {
  const age = state.lastUpdateAt ? (Date.now() - state.lastUpdateAt) / 1000 : null;
  let kind = '';
  let text = '';

  if (els.app.hidden) {
    kind = '';
    text = '等待登录';
  } else if (!state.wsConnected) {
    if (age === null) {
      kind = 'warn';
      text = '正在连接实时通道…';
    } else {
      kind = 'bad';
      text = '连接中断 · 正在重连';
    }
  } else if (age === null) {
    kind = 'warn';
    text = '等待首帧…';
  } else if (age <= 5) {
    kind = 'ok';
    text = `实时 · 更新于 ${Math.max(0, Math.floor(age))} 秒前`;
  } else if (age <= 15) {
    kind = 'warn';
    text = `延迟 · 更新于 ${Math.floor(age)} 秒前`;
  } else {
    kind = 'bad';
    text = `数据已过期 · ${Math.floor(age)} 秒前`;
  }

  els.livePill.classList.remove('ok', 'warn', 'bad');
  if (kind) els.livePill.classList.add(kind);
  ui.setText(els.liveText, text);
}

function currentViewId() {
  const match = location.hash.match(/^#\/([a-z]+)/i);
  return match && VIEWS[match[1]] ? match[1] : 'overview';
}

function route() {
  if (els.app.hidden) return;
  const id = currentViewId();
  if (state.activeId === id && state.active) {
    updateLiquid();
    return;
  }

  state.active?.destroy?.();
  const view = VIEWS[id];
  state.activeId = id;

  els.pageTitle.textContent = view.title;
  els.pageEyebrow.textContent = view.eyebrow;
  els.pageSubtitle.textContent = view.subtitle;
  document.title = `${view.title} · HP Server Monitor`;

  for (const bubble of document.querySelectorAll('.nav-bubble')) {
    const active = bubble.dataset.view === id;
    bubble.classList.toggle('active', active);
    if (active) bubble.setAttribute('aria-current', 'page');
    else bubble.removeAttribute('aria-current');
  }

  els.view.replaceChildren();
  state.active = view.mount(els.view, ctx);
  if (state.snapshot && state.active?.update) state.active.update(state.snapshot);
  updateLiquid();
  window.scrollTo(0, 0);
}

function updateLiquid() {
  if (els.app.hidden) return;
  const active = els.sidebar.querySelector('.nav-bubble.active');
  if (!active) return;

  els.liquid.style.width = `${active.offsetWidth}px`;
  els.liquid.style.height = `${active.offsetHeight}px`;
  els.liquid.style.transform = `translate3d(${active.offsetLeft}px, ${active.offsetTop}px, 0)`;
}

async function pollFallback() {
  if (els.app.hidden || !api.hasSession()) return;
  const age = state.lastUpdateAt ? (Date.now() - state.lastUpdateAt) / 1000 : Number.POSITIVE_INFINITY;
  if (age < 6 || state.polling || Date.now() - state.lastPollAt < 5000) return;

  state.polling = true;
  state.lastPollAt = Date.now();
  try {
    handleSnapshot(await api.snapshot());
  } catch (error) {
    if (error.status === 401) showLogin('登录已过期，请重新登录', true);
  } finally {
    state.polling = false;
  }
}

function bindEvents() {
  for (const bubble of document.querySelectorAll('.nav-bubble')) {
    bubble.addEventListener('click', () => {
      const id = bubble.dataset.view;
      if (state.activeId === id) return;
      location.hash = `#/${id}`;
    });
  }

  window.addEventListener('hashchange', route);
  window.addEventListener('resize', () => requestAnimationFrame(updateLiquid));
  window.addEventListener('orientationchange', () => requestAnimationFrame(updateLiquid));

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.realtime) state.realtime.reconnectNow();
    updateLivePill();
  });

  els.loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.loginBusy) return;

    const username = els.loginUser.value.trim();
    const password = els.loginPass.value;
    if (!username || !password) {
      setLoginError('请输入用户名和密码');
      return;
    }

    state.loginBusy = true;
    els.loginSubmit.disabled = true;
    els.loginSubmit.textContent = '登录中…';
    setLoginError('');

    try {
      const session = await api.login(username, password);
      state.lastUsername = session.username || username;
      els.loginPass.value = '';
      showApp();
      try {
        handleSnapshot(await api.snapshot());
      } catch (error) {
        if (error.status === 401) showLogin('登录已过期，请重新登录', true);
      }
    } catch (error) {
      let message = error.message || '登录失败';
      if (error.status === 429 && error.body?.retryAfterSeconds)
        message = `尝试次数过多，请 ${error.body.retryAfterSeconds} 秒后再试`;
      if (error.status === 0) message = '无法连接服务器，请检查网络';
      setLoginError(message);
    } finally {
      state.loginBusy = false;
      els.loginSubmit.disabled = false;
      els.loginSubmit.textContent = '登录';
    }
  });

  window.setInterval(updateLivePill, 1000);
  window.setInterval(pollFallback, 1500);
}

async function init() {
  initMotion();
  bindEvents();
  updateLivePill();

  if (!location.hash) {
    history.replaceState(null, '', '#/overview');
  }

  if (!api.hasSession()) {
    showLogin();
    return;
  }

  try {
    const session = api.getSession();
    if (session?.username) state.lastUsername = session.username;
  } catch { }

  showApp();
  try {
    handleSnapshot(await api.snapshot());
  } catch (error) {
    if (error.status === 401) {
      showLogin('登录已过期，请重新登录', true);
      return;
    }
    // 503/网络异常时保持应用壳，等待 WebSocket 或轮询恢复
    if (error.status !== 503 && error.status !== 0) {
      ui.toast(error.message || '数据加载失败', 'bad');
    }
  }
}

init();
