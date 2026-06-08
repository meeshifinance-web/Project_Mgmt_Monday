// ───────────────────────────────────────────────────────────────────────────
// MCP formatting + safety helpers.
//
// Everything an MCP tool returns to the AI client passes through here. The two
// jobs are (1) turn raw cell values into short human-readable text and
// (2) guarantee a tool can never flood the model's context window with a huge
// blob — every response is size-capped and lists are paginated by the caller.
// ───────────────────────────────────────────────────────────────────────────

// Context-window budget. A single tool result is hard-capped at this many
// characters; lists default-paginate well below it.
const MAX_RESPONSE_CHARS = 24000;
const CELL_TRUNC = 200; // max chars rendered for a single cell value
const TEXT_TRUNC = 300; // max chars for free-text like board descriptions

// Pagination knobs shared by every list tool.
const PAGE_DEFAULT = 25;
const PAGE_MAX = 50;

// A tool error whose message is already safe + user-facing. Thrown anywhere in
// the tool/loopback stack and rendered verbatim to the AI by `runTool`.
class ToolError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ToolError';
    this.status = status; // upstream HTTP status, when relevant
  }
}

function truncate(value, n = CELL_TRUNC) {
  const s = value == null ? '' : String(value);
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function clampPageSize(n) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v) || v <= 0) return PAGE_DEFAULT;
  return Math.min(PAGE_MAX, v);
}

// Render one stored cell value into a compact readable string. Returns '' for
// empty cells (callers omit those entirely to save tokens).
function renderCellValue(type, raw) {
  if (raw == null || raw === '') return '';
  switch (type) {
    case 'person': {
      try {
        const a = JSON.parse(raw);
        if (Array.isArray(a))
          return a.map(e => (e && typeof e === 'object') ? e.name : e).filter(Boolean).join(', ');
      } catch { /* fall through */ }
      return truncate(raw);
    }
    case 'connect_boards':
    case 'dependency': {
      try {
        const a = JSON.parse(raw);
        if (Array.isArray(a)) return `${a.length} linked item${a.length === 1 ? '' : 's'}`;
      } catch { /* fall through */ }
      return truncate(raw);
    }
    case 'checkbox':
      return raw === 'true' ? '✓' : '';
    case 'link': {
      try {
        const p = JSON.parse(raw);
        if (p && typeof p === 'object' && p.url) return p.label ? `${p.label} (${p.url})` : p.url;
      } catch { /* plain url */ }
      return truncate(raw);
    }
    default:
      return truncate(raw);
  }
}

// Build { column_id: { title, type } } from a board's column list.
function columnIndex(columns = []) {
  const idx = {};
  for (const c of columns) idx[c.id] = { title: c.title, type: c.type };
  return idx;
}

// Turn an item's { column_id: value } map into a compact { "Column Title": text }
// object, dropping empty cells.
function renderItemValues(values = {}, colIdx = {}) {
  const out = {};
  for (const [cid, raw] of Object.entries(values || {})) {
    const meta = colIdx[cid];
    if (!meta) continue;
    const text = renderCellValue(meta.type, raw);
    if (text !== '') out[meta.title] = text;
  }
  return out;
}

// Serialize a payload for the model, capped so it can never blow the context
// window. Strings pass through untouched (already controlled by the caller).
function serialize(payload) {
  if (typeof payload === 'string') return payload;
  let s = JSON.stringify(payload, null, 2);
  if (s.length > MAX_RESPONSE_CHARS) {
    s = s.slice(0, MAX_RESPONSE_CHARS) +
      `\n… (response truncated at ${MAX_RESPONSE_CHARS} characters — narrow your request or page through results)`;
  }
  return s;
}

// MCP success result.
function ok(payload) {
  return { content: [{ type: 'text', text: serialize(payload) }] };
}

// MCP error result — the message is shown to the AI (and relayed to the user).
function fail(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

module.exports = {
  ToolError, ok, fail, serialize,
  truncate, clampPageSize, renderCellValue, renderItemValues, columnIndex,
  MAX_RESPONSE_CHARS, CELL_TRUNC, TEXT_TRUNC, PAGE_DEFAULT, PAGE_MAX,
};
