// Deterministic "AI" per-row derivations for the AI column type. No LLM needed
// — these compile other columns into a useful derived value, and are pure so
// they can be unit-tested. (An LLM could later replace any single op.)

function parsePersons(raw) {
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a.map(x => (x && x.name) ? x.name : x) : [String(raw)]; }
  catch { return raw ? [String(raw)] : []; }
}
const valOf = (item, id) => item?.values?.[id] ?? '';
const firstOfType = (columns, t) => columns.find(c => c.type === t);

function summary(item, columns) {
  const parts = [];
  const owner = firstOfType(columns, 'person');
  if (owner) { const n = parsePersons(valOf(item, owner.id)); if (n.length) parts.push(n.join(', ')); }
  const status = firstOfType(columns, 'status');
  if (status && valOf(item, status.id)) parts.push(valOf(item, status.id));
  const prio = firstOfType(columns, 'priority');
  if (prio && valOf(item, prio.id)) parts.push(valOf(item, prio.id));
  const date = firstOfType(columns, 'date');
  if (date && valOf(item, date.id)) parts.push('due ' + valOf(item, date.id));
  const num = firstOfType(columns, 'number');
  if (num && valOf(item, num.id) !== '') parts.push(`${num.title}: ${valOf(item, num.id)}`);
  return parts.length ? parts.join(' · ') : '—';
}

function health(item, columns, settings) {
  const status = (settings.statusColumnId && columns.find(c => String(c.id) === String(settings.statusColumnId))) || firstOfType(columns, 'status');
  const date = (settings.dateColumnId && columns.find(c => String(c.id) === String(settings.dateColumnId))) || firstOfType(columns, 'date');
  const sv = String(status ? valOf(item, status.id) : '').toLowerCase();
  const dv = date ? valOf(item, date.id) : '';
  if (/done|complete|closed|shipped|resolved/.test(sv)) return '✅ Complete';
  if (/stuck|block|hold|risk/.test(sv)) return '🔴 Blocked';
  if (dv && /^\d{4}-\d{2}-\d{2}$/.test(dv)) {
    const today = new Date().toISOString().slice(0, 10);
    if (dv < today) return '⚠ Overdue';
    const days = Math.round((new Date(dv) - new Date(today)) / 86400000);
    if (days <= 3) return '🟡 Due soon';
  }
  return '🟢 On track';
}

function extract(text, kind) {
  const s = String(text || '');
  const re = {
    email: /[^\s@]+@[^\s@]+\.[^\s@]+/g,
    phone: /\+?\d[\d\s().-]{6,}\d/g,
    url: /https?:\/\/[^\s]+/g,
    number: /-?\d+(?:\.\d+)?/g,
  }[kind];
  if (!re) return '';
  const m = s.match(re);
  return m ? [...new Set(m.map(x => x.trim()))].join(', ') : '';
}

const POS = ['great', 'good', 'excellent', 'love', 'happy', 'resolved', 'win', 'success', 'approved', 'perfect', 'thanks', 'awesome', 'smooth', 'fast'];
const NEG = ['bad', 'issue', 'problem', 'bug', 'fail', 'angry', 'delay', 'blocked', 'stuck', 'urgent', 'broken', 'wrong', 'error', 'complaint', 'cancel', 'slow', 'frustrat'];
function sentiment(text) {
  const s = String(text || '').toLowerCase();
  if (!s.trim()) return '—';
  let score = 0;
  POS.forEach(w => { if (s.includes(w)) score++; });
  NEG.forEach(w => { if (s.includes(w)) score--; });
  return score > 0 ? '😊 Positive' : score < 0 ? '☹️ Negative' : '😐 Neutral';
}

export const AI_OPS = [
  ['summary', 'Row summary', 'One-line summary of the row'],
  ['health', 'Health / status', 'Classify as on-track / blocked / overdue'],
  ['extract', 'Extract', 'Pull emails / phones / links / numbers from text'],
  ['sentiment', 'Sentiment', 'Positive / neutral / negative from a text column'],
];

export function aiCompute(item, columns = [], settings = {}) {
  const op = settings.op || 'summary';
  switch (op) {
    case 'summary': return summary(item, columns);
    case 'health': return health(item, columns, settings);
    case 'extract': return extract(valOf(item, settings.sourceColumnId), settings.extract || 'email');
    case 'sentiment': return sentiment(valOf(item, settings.sourceColumnId));
    default: return '';
  }
}
