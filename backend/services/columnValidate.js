// ───────────────────────────────────────────────────────────────────────────
// Server-side validation & normalisation for column cell values.
// Previously the API accepted anything: number="banana"/NaN/Infinity, impossible
// dates, rating=999, progress=5000/negative, garbage emails. This is the single
// authority the upsert + bulk-upsert + import paths all funnel through.
// ───────────────────────────────────────────────────────────────────────────

// The set of column types the product supports. Used to reject unknown types
// at column-creation time.
const COLUMN_TYPES = new Set([
  'status', 'dropdown', 'text', 'date', 'person', 'number',
  'file', 'checkbox', 'formula', 'priority', 'timeline', 'rating',
  'long_text', 'link', 'email', 'phone', 'progress', 'tags',
  'color_picker', 'time_tracking', 'location', 'creation_log',
  // Cross-board: link items to another board, mirror a column, roll up a value
  'connect_boards', 'mirror', 'rollup',
  // Project scheduling: predecessors this task depends on (drives auto-shift + critical path)
  'dependency',
  // AI column — derives a value per row (summary / health / extract / sentiment)
  'ai',
]);

// Generic hard cap so a single cell can't be used to store megabytes.
// long_text gets a larger budget than everything else.
const MAX_LEN = { long_text: 20000, default: 5000 };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isValidISODate(s) {
  if (!ISO_DATE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// Block javascript:/data:/vbscript: URLs (stored-XSS) and auto-prefix bare hosts.
function sanitizeUrl(raw) {
  const v = String(raw).trim();
  if (!v) return { ok: true, value: '' };
  const lowered = v.toLowerCase();
  if (/^(javascript|data|vbscript|file):/i.test(lowered))
    return { ok: false, error: 'That link scheme is not allowed' };
  // bare domains (no scheme) become https:// so they don't resolve as in-app relative links
  if (!/^https?:\/\//i.test(v) && !/^mailto:/i.test(v)) {
    if (/^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(v)) return { ok: true, value: 'https://' + v };
  }
  return { ok: true, value: v };
}

// Validate + normalise a single value. Empty string always clears the cell.
// Returns { ok:true, value } or { ok:false, error }.
function validateColumnValue(type, rawValue, settings = {}) {
  const value = rawValue == null ? '' : String(rawValue);
  if (value === '') return { ok: true, value: '' };

  const cap = MAX_LEN[type] || MAX_LEN.default;
  if (value.length > cap)
    return { ok: false, error: `Value too long (max ${cap} characters)` };

  switch (type) {
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) return { ok: false, error: 'Must be a valid number' };
      return { ok: true, value: String(n) };
    }
    case 'date': {
      if (!isValidISODate(value)) return { ok: false, error: 'Must be a valid date (YYYY-MM-DD)' };
      return { ok: true, value };
    }
    case 'email': {
      if (!EMAIL_RE.test(value)) return { ok: false, error: `“${value.slice(0, 40)}” is not a valid email — use a format like name@example.com` };
      return { ok: true, value };
    }
    case 'phone': {
      // Allow digits and common formatting chars; must be exactly 10 digits.
      if (!/^[\d\s+()\-.]+$/.test(value))
        return { ok: false, error: 'Phone number can only contain digits and the symbols + - ( ) . and spaces' };
      const digits = value.replace(/\D/g, '');
      if (digits.length !== 10)
        return { ok: false, error: `Phone number must be exactly 10 digits — you entered ${digits.length}` };
      return { ok: true, value: value.trim() };
    }
    case 'rating': {
      const n = Number(value);
      if (!Number.isFinite(n)) return { ok: false, error: 'Rating must be a number' };
      // Configurable max (settings.max, 1–10) and half-star steps.
      const max = Math.max(1, Math.min(10, parseInt(settings?.max) || 5));
      const clamped = Math.max(0, Math.min(max, Math.round(n * 2) / 2));
      return { ok: true, value: String(clamped) };
    }
    case 'progress': {
      const n = Math.round(Number(value));
      if (!Number.isFinite(n)) return { ok: false, error: 'Progress must be a number' };
      return { ok: true, value: String(Math.max(0, Math.min(100, n))) }; // clamp 0..100
    }
    case 'checkbox': {
      const truthy = value === 'true' || value === '1' || value === 'checked';
      return { ok: true, value: truthy ? 'true' : 'false' };
    }
    case 'color_picker': {
      if (!HEX_COLOR.test(value)) return { ok: false, error: 'Colour must be a #rrggbb hex value' };
      return { ok: true, value: value.toLowerCase() };
    }
    case 'link': {
      // plain URL string, or JSON { url, label } when a display label is set
      let url = value, label = null;
      try { const p = JSON.parse(value); if (p && typeof p === 'object' && 'url' in p) { url = p.url || ''; label = String(p.label || ''); } } catch { /* plain url */ }
      const s = sanitizeUrl(url);
      if (!s.ok) return s;
      if (label) return { ok: true, value: JSON.stringify({ url: s.value, label: label.slice(0, 200) }) };
      return { ok: true, value: s.value };
    }
    case 'timeline': {
      // Stored as "start → end". Both dates must be valid; end must be >= start.
      const parts = value.split('→').map(s => s.trim());
      const s = parts[0] || '', e = parts[1] || '';
      if (s && !isValidISODate(s)) return { ok: false, error: 'Timeline start must be YYYY-MM-DD' };
      if (e && !isValidISODate(e)) return { ok: false, error: 'Timeline end must be YYYY-MM-DD' };
      if (s && e && e < s) return { ok: false, error: 'Timeline end must be on or after start' };
      if (!s && !e) return { ok: true, value: '' };
      return { ok: true, value: `${s} → ${e}` };
    }
    case 'connect_boards': {
      // Stored as a JSON array of linked item ids: "[12,45]".
      let arr;
      try { arr = JSON.parse(value); } catch { return { ok: false, error: 'Invalid connection value' }; }
      if (!Array.isArray(arr)) return { ok: false, error: 'Connection must be a list of items' };
      const ids = [...new Set(arr.map(n => parseInt(n, 10)).filter(n => Number.isInteger(n) && n > 0))];
      if (!ids.length) return { ok: true, value: '' };
      // allowMultiple defaults to true; when false keep only the first link.
      if (settings && settings.allowMultiple === false) return { ok: true, value: JSON.stringify([ids[0]]) };
      return { ok: true, value: JSON.stringify(ids) };
    }
    case 'dependency': {
      // JSON array of predecessor item ids this task depends on (same board).
      let arr;
      try { arr = JSON.parse(value); } catch { return { ok: false, error: 'Invalid dependency value' }; }
      if (!Array.isArray(arr)) return { ok: false, error: 'Dependencies must be a list of items' };
      const ids = [...new Set(arr.map(n => parseInt(n, 10)).filter(n => Number.isInteger(n) && n > 0))];
      return { ok: true, value: ids.length ? JSON.stringify(ids) : '' };
    }
    case 'ai':
      // Derived per-row on the client from other columns — nothing user-written.
      return { ok: true, value: '' };
    case 'mirror':
    case 'rollup':
      // Computed server-side at read time from the linked items — never written
      // directly by a client. Any incoming value is ignored (cell stays empty in
      // storage; the live value is injected by the connection resolver on GET).
      return { ok: true, value: '' };
    case 'tags': {
      // de-dupe, drop blanks; comma-separated
      const seen = new Set();
      const tags = value.split(',').map(t => t.trim()).filter(t => {
        if (!t || seen.has(t.toLowerCase())) return false;
        seen.add(t.toLowerCase());
        return true;
      });
      return { ok: true, value: tags.join(', ') };
    }
    default:
      return { ok: true, value };
  }
}

module.exports = { validateColumnValue, sanitizeUrl, isValidISODate, COLUMN_TYPES };
