/**
 * formulaEngine.js
 *
 * Client-side formula evaluator for formula columns.
 * Supports monday.com-style syntax:
 *   - Column references: {Column Name}
 *   - Arithmetic: + - * /
 *   - String concat: &
 *   - Comparison: = != <> < > <= >=
 *   - Functions: IF, CONCATENATE, LEN, UPPER, LOWER, TRIM, LEFT, RIGHT, MID,
 *                CONTAINS, SUBSTITUTE, ABS, ROUND, CEILING, FLOOR, INT, SQRT,
 *                POWER, MOD, SUM, AVERAGE, MIN, MAX, AND, OR, NOT,
 *                TODAY, NOW, YEAR, MONTH, DAY, WEEKDAY, DAYS, DATEADD,
 *                ISNUMBER, ISBLANK, ISTEXT, VALUE, TEXT
 */

// ── Token types ───────────────────────────────────────────────────────────────
const TT = {
  NUMBER: 'NUMBER', STRING: 'STRING', IDENT: 'IDENT', COLREF: 'COLREF',
  LPAR: 'LPAR', RPAR: 'RPAR', COMMA: 'COMMA',
  PLUS: 'PLUS', MINUS: 'MINUS', STAR: 'STAR', SLASH: 'SLASH', AMP: 'AMP',
  EQ: 'EQ', NEQ: 'NEQ', LT: 'LT', GT: 'GT', LTE: 'LTE', GTE: 'GTE',
  EOF: 'EOF',
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function toNum(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function isTruthy(v) {
  if (v === '' || v === null || v === undefined || v === false || v === 0) return false;
  if (v === 'false' || v === 'FALSE' || v === '0') return false;
  return true;
}

// ── Tokenizer ─────────────────────────────────────────────────────────────────
function tokenize(formula, colValues) {
  const tokens = [];
  let i = 0;

  while (i < formula.length) {
    const ch = formula[i];

    // Whitespace
    if (/\s/.test(ch)) { i++; continue; }

    // Column reference {Column Name}
    if (ch === '{') {
      const end = formula.indexOf('}', i);
      if (end === -1) throw new Error('Unclosed column reference {');
      const name = formula.slice(i + 1, end).trim();
      const val = colValues.hasOwnProperty(name.toLowerCase()) ? colValues[name.toLowerCase()] : '';
      tokens.push({ type: TT.COLREF, value: val, name });
      i = end + 1;
      continue;
    }

    // String literal
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let str = '';
      i++;
      while (i < formula.length && formula[i] !== quote) {
        if (formula[i] === '\\' && i + 1 < formula.length) { str += formula[i + 1]; i += 2; }
        else { str += formula[i]; i++; }
      }
      i++; // skip closing quote
      tokens.push({ type: TT.STRING, value: str });
      continue;
    }

    // Number
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(formula[i + 1] || ''))) {
      let num = '';
      while (i < formula.length && /[0-9.]/.test(formula[i])) { num += formula[i++]; }
      tokens.push({ type: TT.NUMBER, value: parseFloat(num) });
      continue;
    }

    // Identifier / keyword
    if (/[A-Za-z_]/.test(ch)) {
      let ident = '';
      while (i < formula.length && /[A-Za-z0-9_]/.test(formula[i])) { ident += formula[i++]; }
      tokens.push({ type: TT.IDENT, value: ident.toUpperCase() });
      continue;
    }

    // Two-char operators
    const two = formula.slice(i, i + 2);
    if (two === '!=') { tokens.push({ type: TT.NEQ }); i += 2; continue; }
    if (two === '<>') { tokens.push({ type: TT.NEQ }); i += 2; continue; }
    if (two === '<=') { tokens.push({ type: TT.LTE }); i += 2; continue; }
    if (two === '>=') { tokens.push({ type: TT.GTE }); i += 2; continue; }
    if (two === '==') { tokens.push({ type: TT.EQ  }); i += 2; continue; }

    // Single-char
    const ops = { '(': TT.LPAR, ')': TT.RPAR, ',': TT.COMMA, '+': TT.PLUS,
                  '-': TT.MINUS, '*': TT.STAR, '/': TT.SLASH, '&': TT.AMP,
                  '=': TT.EQ, '<': TT.LT, '>': TT.GT };
    if (ops[ch]) { tokens.push({ type: ops[ch] }); i++; continue; }

    i++; // skip unknown
  }

  tokens.push({ type: TT.EOF });
  return tokens;
}

// ── Parser ────────────────────────────────────────────────────────────────────
class Parser {
  constructor(tokens) { this.tokens = tokens; this.pos = 0; }

  peek()  { return this.tokens[this.pos]; }
  advance() { return this.tokens[this.pos++]; }

  match(...types) {
    if (types.includes(this.peek().type)) return this.advance();
    return null;
  }

  expect(type) {
    const tok = this.advance();
    if (tok.type !== type) throw new Error(`Expected ${type} got ${tok.type}`);
    return tok;
  }

  parse() { return this.parseComparison(); }

  parseComparison() {
    let left = this.parseTerm();
    while (true) {
      const op = this.match(TT.EQ, TT.NEQ, TT.LT, TT.GT, TT.LTE, TT.GTE);
      if (!op) break;
      const right = this.parseTerm();
      const l = left, r = right;
      const ls = String(l ?? '').toLowerCase(), rs = String(r ?? '').toLowerCase();
      switch (op.type) {
        case TT.EQ:  left = ls === rs || l == r; break; // eslint-disable-line eqeqeq
        case TT.NEQ: left = ls !== rs; break;
        case TT.LT:  left = toNum(l) < toNum(r); break;
        case TT.GT:  left = toNum(l) > toNum(r); break;
        case TT.LTE: left = toNum(l) <= toNum(r); break;
        case TT.GTE: left = toNum(l) >= toNum(r); break;
      }
    }
    return left;
  }

  parseTerm() {
    let left = this.parseFactor();
    while (true) {
      const op = this.match(TT.PLUS, TT.MINUS, TT.AMP);
      if (!op) break;
      const right = this.parseFactor();
      if (op.type === TT.AMP) {
        left = String(left ?? '') + String(right ?? '');
      } else if (op.type === TT.MINUS) {
        left = toNum(left) - toNum(right);
      } else {
        // + : numeric if both numeric, else string concat
        const ln = Number(left), rn = Number(right);
        left = (!isNaN(ln) && !isNaN(rn) && left !== '' && right !== '')
          ? ln + rn
          : String(left ?? '') + String(right ?? '');
      }
    }
    return left;
  }

  parseFactor() {
    let left = this.parseUnary();
    while (true) {
      const op = this.match(TT.STAR, TT.SLASH);
      if (!op) break;
      const right = this.parseUnary();
      if (op.type === TT.STAR) { left = toNum(left) * toNum(right); }
      else {
        const denom = toNum(right);
        left = denom === 0 ? '#DIV/0!' : toNum(left) / denom;
      }
    }
    return left;
  }

  parseUnary() {
    if (this.match(TT.MINUS)) return -toNum(this.parsePrimary());
    return this.parsePrimary();
  }

  parsePrimary() {
    const tok = this.peek();

    if (tok.type === TT.NUMBER) { this.advance(); return tok.value; }
    if (tok.type === TT.STRING) { this.advance(); return tok.value; }
    if (tok.type === TT.COLREF) { this.advance(); return tok.value; }

    if (tok.type === TT.IDENT) {
      this.advance();
      if (tok.value === 'TRUE')  return true;
      if (tok.value === 'FALSE') return false;

      // Function call
      if (this.peek().type === TT.LPAR) {
        this.advance(); // consume LPAR
        const args = [];
        if (this.peek().type !== TT.RPAR) {
          args.push(this.parseComparison());
          while (this.match(TT.COMMA)) args.push(this.parseComparison());
        }
        this.expect(TT.RPAR);
        return this.callFn(tok.value, args);
      }
      return tok.value; // bare identifier as string
    }

    if (tok.type === TT.LPAR) {
      this.advance();
      const val = this.parseComparison();
      this.expect(TT.RPAR);
      return val;
    }

    return '';
  }

  callFn(name, args) {
    const a = args;
    switch (name) {
      // ── Logical ──────────────────────────────────────────────────────────
      case 'IF':     return isTruthy(a[0]) ? (a[1] ?? '') : (a[2] ?? '');
      case 'AND':    return a.every(isTruthy);
      case 'OR':     return a.some(isTruthy);
      case 'NOT':    return !isTruthy(a[0]);
      case 'IFS': {
        for (let i = 0; i + 1 < a.length; i += 2) {
          if (isTruthy(a[i])) return a[i + 1] ?? '';
        }
        return '';
      }

      // ── String ───────────────────────────────────────────────────────────
      case 'CONCATENATE': return a.map(x => x ?? '').join('');
      case 'LEN':         return String(a[0] ?? '').length;
      case 'UPPER':       return String(a[0] ?? '').toUpperCase();
      case 'LOWER':       return String(a[0] ?? '').toLowerCase();
      case 'TRIM':        return String(a[0] ?? '').trim();
      case 'LEFT':        return String(a[0] ?? '').slice(0, toNum(a[1]));
      case 'RIGHT': {
        const s = String(a[0] ?? '');
        return s.slice(Math.max(0, s.length - toNum(a[1])));
      }
      case 'MID':         return String(a[0] ?? '').slice(toNum(a[1]) - 1, toNum(a[1]) - 1 + toNum(a[2]));
      case 'CONTAINS':    return String(a[0] ?? '').toLowerCase().includes(String(a[1] ?? '').toLowerCase());
      case 'SUBSTITUTE':  return String(a[0] ?? '').split(String(a[1] ?? '')).join(String(a[2] ?? ''));
      case 'FIND': {
        const idx = String(a[1] ?? '').indexOf(String(a[0] ?? ''));
        return idx === -1 ? 0 : idx + 1;
      }
      case 'REPT':        return String(a[0] ?? '').repeat(Math.max(0, toNum(a[1])));
      case 'EXACT':       return String(a[0] ?? '') === String(a[1] ?? '');

      // ── Numeric ──────────────────────────────────────────────────────────
      case 'ABS':         return Math.abs(toNum(a[0]));
      case 'ROUND':       return parseFloat(toNum(a[0]).toFixed(Math.max(0, toNum(a[1]))));
      case 'ROUNDUP':     return Math.ceil(toNum(a[0]) * Math.pow(10, toNum(a[1]))) / Math.pow(10, toNum(a[1]));
      case 'ROUNDDOWN':   return Math.floor(toNum(a[0]) * Math.pow(10, toNum(a[1]))) / Math.pow(10, toNum(a[1]));
      case 'CEILING':     return Math.ceil(toNum(a[0]));
      case 'FLOOR':       return Math.floor(toNum(a[0]));
      case 'INT':         return Math.trunc(toNum(a[0]));
      case 'SQRT':        return Math.sqrt(toNum(a[0]));
      case 'POWER':       return Math.pow(toNum(a[0]), toNum(a[1]));
      case 'MOD':         return toNum(a[0]) % toNum(a[1]);
      case 'LOG':         return a[1] !== undefined ? Math.log(toNum(a[0])) / Math.log(toNum(a[1])) : Math.log10(toNum(a[0]));
      case 'EXP':         return Math.exp(toNum(a[0]));
      case 'PI':          return Math.PI;
      case 'SUM':         return a.reduce((acc, x) => acc + toNum(x), 0);
      case 'AVERAGE':     return a.length ? a.reduce((acc, x) => acc + toNum(x), 0) / a.length : 0;
      case 'MIN':         return Math.min(...a.map(toNum));
      case 'MAX':         return Math.max(...a.map(toNum));
      case 'COUNT':       return a.filter(x => x !== '' && x !== null && x !== undefined && !isNaN(Number(x))).length;
      case 'COUNTA':      return a.filter(x => x !== '' && x !== null && x !== undefined).length;

      // ── Date ─────────────────────────────────────────────────────────────
      case 'TODAY':       return new Date().toISOString().slice(0, 10);
      case 'NOW':         return new Date().toLocaleString('en-IN');
      case 'YEAR':        { const d = new Date(a[0]); return isNaN(d) ? '#VALUE!' : d.getFullYear(); }
      case 'MONTH':       { const d = new Date(a[0]); return isNaN(d) ? '#VALUE!' : d.getMonth() + 1; }
      case 'DAY':         { const d = new Date(a[0]); return isNaN(d) ? '#VALUE!' : d.getDate(); }
      case 'WEEKDAY':     { const d = new Date(a[0]); return isNaN(d) ? '#VALUE!' : d.getDay() + 1; }
      case 'HOUR':        { const d = new Date(a[0]); return isNaN(d) ? '#VALUE!' : d.getHours(); }
      case 'MINUTE':      { const d = new Date(a[0]); return isNaN(d) ? '#VALUE!' : d.getMinutes(); }
      case 'DAYS': {
        const d1 = new Date(a[0]), d2 = new Date(a[1]);
        if (isNaN(d1) || isNaN(d2)) return '#VALUE!';
        return Math.round((d1 - d2) / 86400000);
      }
      case 'DATEADD': {
        const d = new Date(a[0]);
        if (isNaN(d)) return '#VALUE!';
        const n = toNum(a[1]);
        const unit = String(a[2] ?? 'day').toLowerCase();
        if (unit === 'day' || unit === 'days')    d.setDate(d.getDate() + n);
        else if (unit === 'month' || unit === 'months') d.setMonth(d.getMonth() + n);
        else if (unit === 'year'  || unit === 'years')  d.setFullYear(d.getFullYear() + n);
        return d.toISOString().slice(0, 10);
      }
      case 'EDATE': {
        const d = new Date(a[0]);
        if (isNaN(d)) return '#VALUE!';
        d.setMonth(d.getMonth() + toNum(a[1]));
        return d.toISOString().slice(0, 10);
      }

      // ── Type checks ──────────────────────────────────────────────────────
      case 'ISNUMBER': {
        const v = a[0];
        return v !== '' && v !== null && v !== undefined && !isNaN(Number(v));
      }
      case 'ISBLANK':  return a[0] === '' || a[0] === null || a[0] === undefined;
      case 'ISTEXT':   return typeof a[0] === 'string' && isNaN(Number(a[0])) && a[0] !== '';
      case 'ISERROR':  return typeof a[0] === 'string' && a[0].startsWith('#');

      // ── Conversion ───────────────────────────────────────────────────────
      case 'VALUE':    return parseFloat(String(a[0] ?? '').replace(/[^0-9.-]/g, '')) || 0;
      case 'TEXT': {
        const n = toNum(a[0]);
        const fmt = String(a[1] ?? '');
        const decimals = (fmt.split('.')[1] || '').length;
        return decimals > 0 ? n.toFixed(decimals) : String(Math.round(n));
      }
      case 'FIXED':    return toNum(a[0]).toFixed(Math.max(0, toNum(a[1] ?? 2)));

      default:
        return `#NAME?(${name})`;
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Evaluate a formula expression for a specific item row.
 * @param {string} formula  - The formula string, e.g. "IF({Status}="Done","✅","❌")"
 * @param {object} item     - The item object with item.values[colId]
 * @param {Array}  columns  - All board column definitions [{id, title, type}, ...]
 * @returns {string}        - The computed display value
 */
export function evaluateFormula(formula, item, columns) {
  if (!formula || !formula.trim()) return '';

  try {
    // Build colValues map: colName.toLowerCase() -> raw cell value
    const colValues = {};
    for (const col of (columns || [])) {
      const raw = item?.values?.[col.id] ?? '';
      colValues[col.title.toLowerCase()] = raw;
    }

    const tokens = tokenize(formula.trim(), colValues);
    const parser = new Parser(tokens);
    const result = parser.parse();

    if (result === null || result === undefined) return '';
    if (typeof result === 'boolean') return result ? 'TRUE' : 'FALSE';
    if (typeof result === 'number') {
      if (isNaN(result)) return '#NUM!';
      if (!isFinite(result)) return '#DIV/0!';
      // Show up to 10 significant digits, strip trailing zeros
      return Number.isInteger(result) ? String(result) : parseFloat(result.toPrecision(10)).toString();
    }
    return String(result);
  } catch (e) {
    return `#ERROR: ${e.message}`;
  }
}

/**
 * List of supported functions for display in the editor.
 */
export const FORMULA_FUNCTIONS = [
  { name: 'IF',         sig: 'IF(condition, true, false)',       desc: 'Conditional' },
  { name: 'IFS',        sig: 'IFS(cond1, val1, cond2, val2…)',   desc: 'Multiple conditions' },
  { name: 'AND',        sig: 'AND(a, b, …)',                      desc: 'All true' },
  { name: 'OR',         sig: 'OR(a, b, …)',                       desc: 'Any true' },
  { name: 'NOT',        sig: 'NOT(value)',                        desc: 'Invert boolean' },
  { name: 'CONCATENATE',sig: 'CONCATENATE(a, b, …)',              desc: 'Join text (also use &)' },
  { name: 'LEN',        sig: 'LEN(text)',                         desc: 'Text length' },
  { name: 'UPPER',      sig: 'UPPER(text)',                       desc: 'Uppercase' },
  { name: 'LOWER',      sig: 'LOWER(text)',                       desc: 'Lowercase' },
  { name: 'TRIM',       sig: 'TRIM(text)',                        desc: 'Remove spaces' },
  { name: 'LEFT',       sig: 'LEFT(text, n)',                     desc: 'First n chars' },
  { name: 'RIGHT',      sig: 'RIGHT(text, n)',                    desc: 'Last n chars' },
  { name: 'MID',        sig: 'MID(text, start, len)',             desc: 'Substring' },
  { name: 'CONTAINS',   sig: 'CONTAINS(text, search)',            desc: 'TRUE if found' },
  { name: 'SUBSTITUTE', sig: 'SUBSTITUTE(text, old, new)',        desc: 'Replace text' },
  { name: 'FIND',       sig: 'FIND(find, within)',                desc: '1-based position' },
  { name: 'ROUND',      sig: 'ROUND(num, decimals)',              desc: 'Round number' },
  { name: 'ABS',        sig: 'ABS(num)',                          desc: 'Absolute value' },
  { name: 'CEILING',    sig: 'CEILING(num)',                      desc: 'Round up' },
  { name: 'FLOOR',      sig: 'FLOOR(num)',                        desc: 'Round down' },
  { name: 'INT',        sig: 'INT(num)',                          desc: 'Truncate to integer' },
  { name: 'MOD',        sig: 'MOD(num, divisor)',                 desc: 'Remainder' },
  { name: 'POWER',      sig: 'POWER(base, exp)',                  desc: 'Exponent' },
  { name: 'SQRT',       sig: 'SQRT(num)',                         desc: 'Square root' },
  { name: 'SUM',        sig: 'SUM(a, b, …)',                      desc: 'Sum values' },
  { name: 'AVERAGE',    sig: 'AVERAGE(a, b, …)',                  desc: 'Average' },
  { name: 'MIN',        sig: 'MIN(a, b, …)',                      desc: 'Minimum' },
  { name: 'MAX',        sig: 'MAX(a, b, …)',                      desc: 'Maximum' },
  { name: 'TODAY',      sig: 'TODAY()',                           desc: 'Current date' },
  { name: 'NOW',        sig: 'NOW()',                             desc: 'Current date & time' },
  { name: 'YEAR',       sig: 'YEAR(date)',                        desc: 'Year from date' },
  { name: 'MONTH',      sig: 'MONTH(date)',                       desc: 'Month from date' },
  { name: 'DAY',        sig: 'DAY(date)',                         desc: 'Day from date' },
  { name: 'DAYS',       sig: 'DAYS(end, start)',                  desc: 'Days between dates' },
  { name: 'DATEADD',    sig: 'DATEADD(date, n, "day"|"month"|"year")', desc: 'Add to date' },
  { name: 'ISNUMBER',   sig: 'ISNUMBER(val)',                     desc: 'Check if numeric' },
  { name: 'ISBLANK',    sig: 'ISBLANK(val)',                      desc: 'Check if empty' },
  { name: 'ISTEXT',     sig: 'ISTEXT(val)',                       desc: 'Check if text' },
  { name: 'VALUE',      sig: 'VALUE(text)',                       desc: 'Text to number' },
  { name: 'TEXT',       sig: 'TEXT(num, "0.00")',                 desc: 'Number to text' },
];
