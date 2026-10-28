const numberFormatters = new Map();

function formatter(digits) {
  let nf = numberFormatters.get(digits);
  if (!nf) {
    nf = new Intl.NumberFormat('zh-CN', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
    numberFormatters.set(digits, nf);
  }
  return nf;
}

export function isNumber(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

export function num(value, digits = 0, fallback = 'N/A') {
  if (!isNumber(value)) return fallback;
  const d = Math.max(0, Math.min(3, digits));
  return formatter(d).format(Number(value));
}

export function pctValue(value, digits = 1) {
  return num(value, digits);
}

export function pct(value, digits = 1) {
  return isNumber(value) ? `${num(value, digits)}%` : 'N/A';
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export function bytes(value, digits = 1) {
  if (!isNumber(value)) return 'N/A';
  let n = Math.max(0, Number(value));
  let unit = 0;
  while (n >= 1024 && unit < BYTE_UNITS.length - 1) {
    n /= 1024;
    unit++;
  }
  const d = unit === 0 ? 0 : Math.max(0, Math.min(2, digits));
  return `${num(n, d)} ${BYTE_UNITS[unit]}`;
}

export function bytesShort(value) {
  if (!isNumber(value)) return 'N/A';
  let n = Math.max(0, Number(value));
  let unit = 0;
  while (n >= 1024 && unit < BYTE_UNITS.length - 1) {
    n /= 1024;
    unit++;
  }
  return `${num(n, unit === 0 ? 0 : 1)}${BYTE_UNITS[unit]}`;
}

export function rate(value, digits = 1) {
  return isNumber(value) ? `${bytes(value, digits)}/s` : 'N/A';
}

export function mhz(value) {
  if (!isNumber(value)) return 'N/A';
  const n = Number(value);
  if (n >= 1000) return `${num(n / 1000, 2)} GHz`;
  return `${num(n, 0)} MHz`;
}

export function temp(value) {
  return isNumber(value) ? `${num(value, 1)}°C` : 'N/A';
}

export function watt(value) {
  return isNumber(value) ? `${num(value, 1)} W` : 'N/A';
}

export function volt(value) {
  return isNumber(value) ? `${num(value, 3)} V` : 'N/A';
}

export function rpm(value) {
  return isNumber(value) ? `${num(value, 0)} RPM` : 'N/A';
}

export function uptime(seconds) {
  if (!isNumber(seconds)) return 'N/A';
  let s = Math.max(0, Math.floor(Number(seconds)));
  const days = Math.floor(s / 86400);
  s %= 86400;
  const hours = Math.floor(s / 3600);
  s %= 3600;
  const minutes = Math.floor(s / 60);
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分`;
  return `${s} 秒`;
}

export function timeAgo(seconds) {
  if (!isNumber(seconds)) return '刚刚';
  const s = Math.max(0, Math.floor(Number(seconds)));
  if (s < 2) return '刚刚';
  if (s < 60) return `${s} 秒前`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  return `${Math.floor(s / 3600)} 小时前`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

export function clock(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function clockSeconds(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function dateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${clockSeconds(date)}`;
}

export function relativeUntil(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  const seconds = Math.floor((date.getTime() - Date.now()) / 1000);
  if (seconds <= 0) return '已过期';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟后`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时后`;
  return `${Math.floor(seconds / 86400)} 天后`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function safe(value, fallback = 'N/A') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}
