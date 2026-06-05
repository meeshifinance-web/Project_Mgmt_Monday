// Pure, framework-free helpers for column cells. Kept out of ColumnCell.jsx so
// they can be unit-tested in isolation (no React imports).

// Returns a safe href, or null if the URL uses a dangerous scheme. Blocks
// javascript:/data:/vbscript:/file: (stored-XSS) and prefixes bare hosts with
// https:// so they don't resolve as in-app relative links.
export function safeHref(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (/^(javascript|data|vbscript|file):/i.test(v)) return null;
  if (!/^https?:\/\//i.test(v) && !/^mailto:/i.test(v)) return 'https://' + v;
  return v;
}

// Limit a phone value to at most 10 digits while allowing + - ( ) . and spaces.
export function sanitizePhone(raw) {
  let digits = 0, out = '';
  for (const ch of String(raw)) {
    if (/\d/.test(ch)) {
      if (digits >= 10) continue;
      digits++; out += ch;
    } else if (/[\s+()\-.]/.test(ch)) {
      out += ch;
    }
  }
  return out;
}

// A link value is either a plain URL string, or JSON { url, label }.
export function parseLink(value) {
  if (!value) return { url: '', label: '' };
  try { const p = JSON.parse(value); if (p && typeof p === 'object' && 'url' in p) return { url: p.url || '', label: p.label || '' }; } catch { /* plain url */ }
  return { url: String(value), label: '' };
}

function hexToRgb(h) {
  let s = String(h || '').replace('#', '');
  if (s.length === 3) s = s.split('').map(c => c + c).join('');
  if (s.length !== 6 || /[^0-9a-f]/i.test(s)) return null;
  const n = parseInt(s, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// Classify a status colour into a done %: green→100 (done), red→0 (stuck/
// not done), amber/blue/purple→50 (in progress / pending). Greyscale→0.
// Hue-based so it's robust to the exact palette used. Returns null if unparsable.
function pctFromColor(hex) {
  const c = hexToRgb(hex);
  if (!c) return null;
  const { r, g, b } = c, max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d < 25) return 0; // greyscale → "not started"
  let h = 0;
  if (max === r) h = ((g - b) / d + 6) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h >= 90 && h <= 165) return 100; // green → done
  if (h < 25 || h >= 330) return 0;    // red → stuck / not done
  return 50;                            // amber / blue / purple → in progress
}

// Map a status label to its "done %". Priority: explicit per-label `progress`
// in settings → "done"-style label name → colour semantics → 0. This matches
// Monday's battery: green statuses count as done, and the overall progress
// emerges from the weighted average across (one or more) status columns.
export function statusDonePct(label, opts) {
  if (!label || !Array.isArray(opts)) return 0;
  const opt = opts.find(o => o.label === label);
  if (!opt) return 0;
  if (opt.progress != null && Number.isFinite(Number(opt.progress)))
    return Math.max(0, Math.min(100, Number(opt.progress)));
  if (/^(done|complete|completed|closed|resolved|shipped|approved|delivered)$/i.test(opt.label)) return 100;
  const byColor = pctFromColor(opt.color);
  return byColor == null ? 0 : byColor;
}

// Monday-style "battery" progress: a weighted average of the item's Status
// columns. Each status column contributes a segment filled to its done %.
//   statusCols    : [{ id, title, settings:{options} }]
//   values        : item.values map (columnId → label)
//   settings      : the progress column's settings ({ weights, statusColumnIds })
//   defaultOptions: fallback status options when a column defines none
// Returns { overall, segments: [{ colId, title, value, pct, color, w }] }.
export function computeWeightedProgress(statusCols, values = {}, settings = {}, defaultOptions = []) {
  let accW = 0, accP = 0;
  const segments = [];
  for (const sc of statusCols || []) {
    const opts = (sc.settings && Array.isArray(sc.settings.options) && sc.settings.options.length)
      ? sc.settings.options : defaultOptions;
    const v = values[sc.id] || '';
    const pct = statusDonePct(v, opts);
    const cur = opts.find(o => o.label === v);
    const w = (settings.weights && Number.isFinite(Number(settings.weights[sc.id]))) ? Number(settings.weights[sc.id]) : 1;
    accW += w; accP += pct * w;
    segments.push({ colId: sc.id, title: sc.title, value: v, pct, color: cur?.color || null, w });
  }
  return { overall: accW > 0 ? Math.round(accP / accW) : 0, segments };
}

// Format a numeric value per the column's settings:
//   format: 'plain' | 'currency' | 'percent'  · decimals: 0–6 · separator: bool
//   currency: symbol (default ₹)
export function formatNumber(value, settings = {}) {
  const n = Number(value);
  if (value === '' || value == null || !Number.isFinite(n)) return '';
  const fmt = settings.format || 'plain';
  const decimals = settings.decimals != null
    ? Math.max(0, Math.min(6, parseInt(settings.decimals)))
    : (fmt === 'currency' ? 2 : 0);
  const useGrouping = settings.separator !== false;
  // Pin to en-IN so grouping is consistent for every viewer (the product is
  // India-localised: ₹ default, IST, +91). Avoids per-browser-locale drift.
  const body = n.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping });
  if (fmt === 'percent') return `${body}%`;
  if (fmt === 'currency') return `${settings.currency || '₹'}${body}`;
  return body;
}
