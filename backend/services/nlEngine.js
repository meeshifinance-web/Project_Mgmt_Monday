// ───────────────────────────────────────────────────────────────────────────
// Natural-language builders — deterministic, validated, no hallucination.
//
//   parseBoard(prompt)                 → board spec (columns + groups)
//   parseFormula(prompt, columns)      → { formula, valid, error, explanation }
//   parseAutomation(prompt, cols, grps)→ { recipe, valid, error, explanation }
//
// These compile plain English into the app's real structures and validate the
// result against the actual columns before anything is saved. If an LLM is
// later configured it can pre-normalise the prompt, but the engine stands alone.
// ───────────────────────────────────────────────────────────────────────────

const FORMULA_FUNCS = new Set([
  'SUM', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'IF', 'IFS', 'AND', 'OR', 'NOT',
  'CONCATENATE', 'LEN', 'UPPER', 'LOWER', 'TRIM', 'LEFT', 'RIGHT', 'MID', 'CONTAINS',
  'SUBSTITUTE', 'FIND', 'REPT', 'EXACT', 'ABS', 'ROUND', 'ROUNDUP', 'ROUNDDOWN',
  'CEILING', 'FLOOR', 'INT', 'SQRT', 'POWER', 'MOD', 'LOG', 'EXP', 'PI', 'TODAY',
  'NOW', 'YEAR', 'MONTH', 'DAY', 'WEEKDAY', 'HOUR', 'MINUTE', 'DAYS', 'DATEADD',
  'EDATE', 'NETWORKDAYS', 'ISNUMBER', 'ISBLANK', 'ISTEXT', 'ISERROR', 'VALUE', 'TEXT', 'FIXED',
]);

const ARTICLES = /^(a|an|the|my|our|some)\s+/i;
function titleCase(s) {
  return String(s || '').replace(ARTICLES, '').trim()
    .replace(/[^\w\s&/-]/g, '').replace(/\s+/g, ' ')
    .split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1) : '').join(' ').trim();
}

const DEFAULT_STATUS = [
  { label: 'Not Started', color: '#c4c4c4' }, { label: 'Working on it', color: '#fdab3d' },
  { label: 'Stuck', color: '#e2445c' }, { label: 'Done', color: '#00c875' },
];
const DEFAULT_PRIORITY = [
  { label: 'Critical', color: '#e2445c' }, { label: 'High', color: '#ff642e' },
  { label: 'Medium', color: '#fdab3d' }, { label: 'Low', color: '#00c875' },
];

// Infer a column type from a phrase like "publish checklist" or "deal value".
function inferColumnType(phrase) {
  const s = String(phrase).toLowerCase();
  if (/priorit/.test(s)) return 'priority';
  if (/\bstatus\b|\bstage\b|\bstate\b|progress stage/.test(s)) return 'status';
  if (/owner|assignee|assigned|responsible|\bpeople\b|\bperson\b|\bwho\b|team member|reviewer/.test(s)) return 'person';
  // checklist must beat "publish date" etc. — check it before date keywords
  if (/checklist|checkbox|done\?|complete\?|is .*done|approved\??/.test(s)) return 'checkbox';
  if (/timeline|date range|start.*end|duration window/.test(s)) return 'timeline';
  if (/due|deadline|\bdate\b|publish|schedul|when\b|launch/.test(s)) return 'date';
  if (/e-?mail/.test(s)) return 'email';
  if (/phone|mobile|contact number/.test(s)) return 'phone';
  if (/\blink\b|\burl\b|website/.test(s)) return 'link';
  if (/budget|cost|price|amount|\bvalue\b|number|hours|qty|quantity|revenue|deal|score points|estimate/.test(s)) return 'number';
  if (/notes?|description|comment|details?|summary/.test(s)) return 'long_text';
  if (/\btags?\b|labels?|categor/.test(s)) return 'tags';
  if (/files?|attach|documents?/.test(s)) return 'file';
  if (/rating|stars/.test(s)) return 'rating';
  if (/progress|percent|%/.test(s)) return 'progress';
  if (/location|address|city|\bplace\b|map/.test(s)) return 'location';
  if (/dropdown|select one|channel|category/.test(s)) return 'dropdown';
  return 'text';
}

function settingsForType(type) {
  if (type === 'status') return { options: DEFAULT_STATUS };
  if (type === 'priority') return { options: DEFAULT_PRIORITY };
  if (type === 'dropdown') return { options: [] };
  return {};
}

// ── NL → Board ────────────────────────────────────────────────────────────────
// Strip filler/intent words from a board-name fragment.
function cleanBoardName(s) {
  let x = String(s || '').toLowerCase();
  x = x.replace(/\b(i\s*want|i'?d\s*like|i\s*would\s*like|i\s*need|please|can\s*you|could\s*you|create|make|build|generate|set\s*up|setup|give\s*me|add|new)\b/g, ' ');
  x = x.replace(/\bboards?\b/g, ' ');
  return titleCase(x);
}
// Strip a leading "3 columns" / "columns" / article from a column phrase.
function cleanColPhrase(p) {
  return String(p || '').trim()
    .replace(/^\s*\d+\s+columns?\b/i, '')
    .replace(/^\s*(?:with\s+)?columns?\b/i, '')
    .replace(/^\s*(?:a|an|the)\b/i, '')
    .trim();
}

function parseBoard(prompt) {
  let text = String(prompt || '').trim();
  if (!text) return { name: 'New Board', columns: [], groups: [], error: 'Describe the board you want.' };

  // 1. Explicit name anywhere: "name/call/title (it|the board) (as) X" (to end of string).
  let explicitName = null, nm;
  if ((nm = text.match(/\b(?:name|call|title)(?:d|ed|ing)?\s+(?:it|this|the\s+board|this\s+board|the\s+project|the\s+board\s+as)?\s*(?:as|to|:|=)?\s*["']?([a-z0-9][\w &/-]*?)["']?\s*$/i))) {
    explicitName = titleCase(nm[1]);
    text = text.slice(0, nm.index).replace(/[,;]?\s*\band\b\s*$/i, '').replace(/[,;]\s*$/, '').trim();
  } else if ((nm = text.match(/\bboard\s+(?:called|named|titled)\s+["']?([a-z0-9][\w &/-]*?)["']?(?=\s+(?:with|that|having|including|to\s+track)\b|$)/i))) {
    explicitName = titleCase(nm[1]);
    text = text.replace(nm[1], '').replace(/\b(?:called|named|titled)\b/i, '').trim();
  }

  // 2. Split "<name> with <columns>".
  const splitRe = /\b(with|that has|that have|having|including|containing|to track|tracking|columns?:)\b/i;
  const m = text.match(splitRe);
  let namePart = m ? text.slice(0, m.index) : (explicitName ? '' : text);
  let colPart = m ? text.slice(m.index + m[0].length) : '';

  let name = explicitName || cleanBoardName(namePart) || 'New Board';

  // Column phrases: split on commas / "and" / "&", strip count prefixes.
  const phrases = colPart.split(/,|\band\b|&|\bplus\b/i).map(p => cleanColPhrase(p)).filter(Boolean);
  const columns = [];
  const seen = new Set();
  for (const p of phrases) {
    const type = inferColumnType(p);
    let title = titleCase(p);
    if (type === 'checkbox' && !/check/i.test(title)) title = title || 'Done';
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    columns.push({ title, type, settings: settingsForType(type) });
  }

  // Every working board needs a Status; add one up front if none was described.
  if (!columns.some(c => c.type === 'status')) {
    columns.unshift({ title: 'Status', type: 'status', settings: { options: DEFAULT_STATUS } });
    seen.add('status');
  }
  // If nothing else was described, round out a usable default.
  if (columns.length === 1) {
    if (!seen.has('owner')) columns.push({ title: 'Owner', type: 'person', settings: {} });
    columns.push({ title: 'Due Date', type: 'date', settings: {} });
  }

  // Groups — explicit ("groups: a, b, c") or a sensible default workflow.
  let groups = [];
  const gm = text.match(/groups?:?\s*([\w\s,&/-]+)$/i);
  if (gm) {
    groups = gm[1].split(/,|\band\b|&/i).map(g => titleCase(g)).filter(Boolean)
      .map((g, i) => ({ name: g, color: ['#0073ea', '#fdab3d', '#00c875', '#a25ddc', '#e2445c'][i % 5], items: [] }));
  }
  if (!groups.length) {
    groups = [
      { name: 'To Do', color: '#0073ea', items: [{ name: 'First task', values: {} }, { name: 'Second task', values: {} }] },
      { name: 'In Progress', color: '#fdab3d', items: [] },
      { name: 'Done', color: '#00c875', items: [] },
    ];
  }

  return { name, columns, groups };
}

// ── NL → Formula ────────────────────────────────────────────────────────────────
function ref(title) { return `{${title}}`; }

// Find a column whose title best matches a fragment of the prompt.
function resolveColumn(fragment, columns) {
  const f = String(fragment).toLowerCase().replace(ARTICLES, '').trim();
  if (!f) return null;
  // exact title
  let c = columns.find(col => col.title.toLowerCase() === f);
  if (c) return c;
  // fragment contains the title, or title contains the fragment
  c = columns.find(col => f.includes(col.title.toLowerCase()) || col.title.toLowerCase().includes(f));
  return c || null;
}

// Columns mentioned in the prompt, in order of first appearance.
function columnsInOrder(prompt, columns) {
  const lower = prompt.toLowerCase();
  return columns
    .map(c => ({ c, idx: lower.indexOf(c.title.toLowerCase()) }))
    .filter(x => x.idx >= 0)
    .sort((a, b) => a.idx - b.idx)
    .map(x => x.c);
}

function parseFormula(prompt, columns = []) {
  const text = String(prompt || '').trim();
  if (!text) return { formula: '', valid: false, error: 'Describe the formula you want.' };
  const s = text.toLowerCase();
  const titles = columns.map(c => c.title);
  const ordered = columnsInOrder(text, columns);

  const result = (formula, explanation) => {
    const v = validateFormula(formula, titles);
    return { formula, explanation, valid: v.valid, error: v.valid ? null : v.error };
  };

  let mm;
  // days between X and Y (optionally excluding weekends)
  if ((mm = s.match(/days?\s+between\s+(.+?)\s+and\s+([^,]+?)(?:,?\s*(excluding weekends|business days|working days|weekdays only|workdays))?$/))) {
    const a = resolveColumn(mm[1], columns), b = resolveColumn(mm[2], columns);
    if (a && b) {
      if (mm[3]) return result(`NETWORKDAYS(${ref(a.title)}, ${ref(b.title)})`, `Business days between ${a.title} and ${b.title} (weekends excluded).`);
      return result(`DAYS(${ref(b.title)}, ${ref(a.title)})`, `Calendar days from ${a.title} to ${b.title}.`);
    }
  }
  // X as a percentage of Y / percent  (checked before "age of" so it wins)
  if ((mm = s.match(/(.+?)\s+as a (?:percentage|percent|%)\s+of\s+(.+)/))) {
    const a = resolveColumn(mm[1], columns), b = resolveColumn(mm[2], columns);
    if (a && b) return result(`ROUND(${ref(a.title)} / ${ref(b.title)} * 100, 0)`, `${a.title} as a % of ${b.title}.`);
  }
  // days since X / age of X
  if ((mm = s.match(/days?\s+(?:since|from)\s+(.+)/)) || (mm = s.match(/\bage of\s+(.+)/))) {
    const a = resolveColumn(mm[1], columns);
    if (a) return result(`DAYS(TODAY(), ${ref(a.title)})`, `Days since ${a.title}.`);
  }
  // sum/average of a list
  if ((mm = s.match(/(sum|total|average|avg)\s+of\s+(.+)/))) {
    const cols = mm[2].split(/,|\band\b|&|\bplus\b/i).map(x => resolveColumn(x, columns)).filter(Boolean);
    if (cols.length >= 1) {
      const fn = /aver|avg/.test(mm[1]) ? 'AVERAGE' : 'SUM';
      return result(`${fn}(${cols.map(c => ref(c.title)).join(', ')})`, `${fn === 'SUM' ? 'Sum' : 'Average'} of ${cols.map(c => c.title).join(', ')}.`);
    }
  }
  // concatenate / join
  if ((mm = s.match(/(?:concat(?:enate)?|join|combine)\s+(.+)/))) {
    const cols = mm[1].split(/,|\band\b|&|\bwith\b/i).map(x => resolveColumn(x, columns)).filter(Boolean);
    if (cols.length >= 2) return result(`CONCATENATE(${cols.map(c => ref(c.title)).join(', " ", ')})`, `Join ${cols.map(c => c.title).join(' + ')}.`);
  }
  // if {col} is "X" then A else B
  if ((mm = text.match(/if\s+(.+?)\s+(?:is|=|equals)\s+["']?([\w\s-]+?)["']?\s+then\s+["']?([\w\s.-]+?)["']?(?:\s+(?:else|otherwise)\s+["']?([\w\s.-]+?)["']?)?$/i))) {
    const a = resolveColumn(mm[1], columns);
    if (a) {
      const elsePart = mm[4] !== undefined ? `"${mm[4].trim()}"` : '""';
      return result(`IF(${ref(a.title)} = "${mm[2].trim()}", "${mm[3].trim()}", ${elsePart})`, `If ${a.title} is "${mm[2].trim()}".`);
    }
  }
  // binary arithmetic: X <op> Y
  const ops = [
    [/(.+?)\s+(?:plus|\+|added to)\s+(.+)/, '+'],
    [/(.+?)\s+(?:minus|-|less)\s+(.+)/, '-'],
    [/(.+?)\s+(?:times|multiplied by|\*|×)\s+(.+)/, '*'],
    [/(.+?)\s+(?:divided by|\/|over)\s+(.+)/, '/'],
  ];
  for (const [re, op] of ops) {
    if ((mm = s.match(re))) {
      const a = resolveColumn(mm[1], columns), b = resolveColumn(mm[2], columns);
      if (a && b) return result(`${ref(a.title)} ${op} ${ref(b.title)}`, `${a.title} ${op} ${b.title}.`);
    }
  }
  // bare "today"
  if (/^today'?s? date|^today$/.test(s)) return result('TODAY()', "Today's date.");

  // Fallback: two numeric/date columns mentioned → assume a difference.
  if (ordered.length >= 2) {
    return result(`${ref(ordered[0].title)} - ${ref(ordered[1].title)}`, `Difference of ${ordered[0].title} and ${ordered[1].title}.`);
  }
  return { formula: '', valid: false, error: 'Couldn’t interpret that. Try e.g. "days between Start and End excluding weekends".' };
}

// Structural validation: known functions, balanced parens, real column refs.
function validateFormula(formula, columnTitles = []) {
  if (!formula || !formula.trim()) return { valid: false, error: 'Empty formula' };
  // balanced parentheses
  let depth = 0;
  for (const ch of formula) { if (ch === '(') depth++; else if (ch === ')') { depth--; if (depth < 0) return { valid: false, error: 'Unbalanced parentheses' }; } }
  if (depth !== 0) return { valid: false, error: 'Unbalanced parentheses' };
  // column refs exist
  const titlesLower = new Set(columnTitles.map(t => t.toLowerCase()));
  const refs = [...formula.matchAll(/\{([^}]+)\}/g)].map(x => x[1].trim());
  for (const r of refs) if (!titlesLower.has(r.toLowerCase())) return { valid: false, error: `Unknown column: ${r}` };
  // function names known
  const fns = [...formula.matchAll(/([A-Z_]+)\s*\(/g)].map(x => x[1]);
  for (const fn of fns) if (!FORMULA_FUNCS.has(fn)) return { valid: false, error: `Unknown function: ${fn}` };
  return { valid: true };
}

// ── NL → Automation ──────────────────────────────────────────────────────────
function parseAutomation(prompt, columns = [], groups = []) {
  const text = String(prompt || '').trim();
  const s = text.toLowerCase();
  if (!s) return { valid: false, error: 'Describe the rule you want.' };

  const statusCols = columns.filter(c => c.type === 'status' || c.type === 'dropdown');
  const personCols = columns.filter(c => c.type === 'person');
  const dateCols = columns.filter(c => c.type === 'date');
  const findStatusCol = () => columns.find(c => c.type === 'status') || statusCols[0] || null;

  // Split on "then" to separate trigger from action(s).
  const [triggerPart, ...rest] = text.split(/\bthen\b/i);
  const actionPart = rest.join(' then ') || triggerPart;
  const ts = triggerPart.toLowerCase();

  let trigger_type = null; let trigger_config = {}; let mm;
  if (/\b(item|task|row|lead|deal|ticket) (is )?created\b|new (item|task|row|lead)\b|when (an? )?(item|task|row) is added/.test(ts)) {
    trigger_type = 'item_created';
  } else if ((mm = ts.match(/(?:status|stage)\s+(?:changes? to|is set to|becomes?|moves? to|=)\s+["']?([\w\s-]+?)["']?(?:\s*$|,|\bthen\b)/))) {
    const col = findStatusCol();
    if (!col) return { valid: false, error: 'This board has no Status column to watch.' };
    trigger_type = 'status_change';
    trigger_config = { column_id: col.id, column_title: col.title, to_value: titleCaseValue(mm[1], col) };
  } else if ((mm = ts.match(/(.+?)\s+(?:changes? to|is set to|becomes?)\s+["']?([\w\s-]+?)["']?(?:\s*$|,|\bthen\b)/))) {
    const col = resolveColumn(mm[1], statusCols) || findStatusCol();
    if (col) { trigger_type = 'status_change'; trigger_config = { column_id: col.id, column_title: col.title, to_value: titleCaseValue(mm[2], col) }; }
  } else if (/date arrives|due date arrives|deadline (is )?reached|when .* arrives/.test(ts) && dateCols.length) {
    trigger_type = 'date_arrives';
    trigger_config = { column_id: dateCols[0].id, column_title: dateCols[0].title };
  }
  if (!trigger_type) return { valid: false, error: 'Couldn’t find a trigger. Try "when status changes to Done, then …".' };

  // Actions.
  const actions = [];
  const as = actionPart.toLowerCase();
  // notify
  if ((mm = actionPart.match(/notif(?:y|ication)\s+(.+?)(?:\.|$)/i)) || /send (?:a )?notification|alert/.test(as)) {
    const who = mm ? mm[1].trim() : 'the owner';
    actions.push({ type: 'notify', config: { message: `Automation: ${who}` } });
  }
  // set status / mark as
  if ((mm = as.match(/(?:set|change|update)\s+(?:the\s+)?status\s+to\s+["']?([\w\s-]+?)["']?(?:\.|,|$)/)) ||
      (mm = as.match(/\bmark(?:\s+it)?\s+as\s+["']?([\w\s-]+?)["']?(?:\.|,|$)/))) {
    const col = findStatusCol();
    if (col) actions.push({ type: 'set_status', config: { column_id: col.id, value: titleCaseValue(mm[1], col) } });
  }
  // move to group
  if ((mm = actionPart.match(/move (?:it )?to (?:the )?(?:group )?["']?([\w\s-]+?)["']?(?:\s+group\b|\s+and\b|\.|,|$)/i))) {
    const g = groups.find(gr => gr.name.toLowerCase() === mm[1].trim().toLowerCase()) ||
              groups.find(gr => gr.name.toLowerCase().includes(mm[1].trim().toLowerCase()));
    if (g) actions.push({ type: 'move_to_group', config: { target_group_id: g.id } });
  }
  // assign person
  if ((mm = actionPart.match(/assign(?:\s+it)?\s+(?:to\s+)?["']?([\w .'-]+?)["']?(?:\.|,|$)/i))) {
    const col = personCols[0];
    if (col) actions.push({ type: 'assign_person', config: { column_id: col.id, user_name: titleCase(mm[1]) } });
  }

  if (!actions.length) return { valid: false, error: 'Couldn’t find an action. Try "… then notify the owner" or "… then set status to Done".' };

  const recipe = {
    name: text.length > 60 ? text.slice(0, 57) + '…' : text,
    trigger_type, trigger_config, conditions: [], actions, enabled: true,
  };
  return { valid: true, recipe, explanation: describeRecipe(recipe) };
}

// Snap a free-text value to an existing status option if one matches.
function titleCaseValue(v, col) {
  const val = String(v).trim();
  const opts = (col?.settings?.options || []).map(o => (typeof o === 'string' ? o : o.label));
  const hit = opts.find(o => o.toLowerCase() === val.toLowerCase());
  return hit || titleCase(val) || val;
}
function describeRecipe(r) {
  const trig = r.trigger_type === 'item_created' ? 'When an item is created'
    : r.trigger_type === 'status_change' ? `When ${r.trigger_config.column_title} becomes "${r.trigger_config.to_value}"`
      : `When ${r.trigger_config.column_title || 'a date'} arrives`;
  const acts = r.actions.map(a => a.type === 'notify' ? 'send a notification'
    : a.type === 'set_status' ? `set status to "${a.config.value}"`
      : a.type === 'move_to_group' ? 'move it to a group'
        : a.type === 'assign_person' ? `assign ${a.config.user_name}` : a.type).join(', then ');
  return `${trig}, ${acts}.`;
}

// ── Ask-your-workspace intent (rigorous, multi-filter, no LLM required) ───────
//
// parseAskIntent compiles a free-text question into a *structured query* with
// any number of filters that the route then ANDs together. Entities (people,
// boards, statuses, priorities, dates) are extracted with a light NER pass and
// resolved against the caller's real workspace vocabulary so "john", "Jhon" and
// "John Smith" all land on the same person. Nothing is invented — an entity that
// can't be resolved is left as free-text search instead.
//
//   parseAskIntent(question, { owners, boards, me })
//     → { filters, label, intent, sort }
//
// filters: {
//   overdue, due ('today'|'tomorrow'|'this_week'|'next_week'|'this_month'|'n_days'|null),
//   dueDays, noDeadline, statusGroup ('done'|'blocked'|'working'|'not_started'|null),
//   priority, unassigned, ownerIsMe, owner, board, text
// }

const ASK_STOPWORDS = new Set(
  ('what whats which who whom whose show me list find get show all any every some' +
   ' item items task tasks thing things stuff work working assigned assignee owner owners' +
   ' are is am be was were do does did have has had the a an of for to on in at by with' +
   ' that this these those right now currently please give tell about can you could would' +
   ' anything everything something nothing anyone someone anybody everybody things' +
   ' status state stage priority due date deadline board boards group and or not but my mine')
    .split(/\s+/),
);

function normalize(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // strip accents
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Damerau-Levenshtein: counts a transposition (e.g. "jhon"↔"john") as one edit.
function levenshtein(a, b) {
  a = String(a); b = String(b);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prevPrev = null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      let v = Math.min(cur[j] + 1, prev[j + 1] + 1, prev[j] + cost);
      if (i > 0 && j > 0 && a[i] === b[j - 1] && a[i - 1] === b[j]) v = Math.min(v, prevPrev[j - 1] + 1);
      cur[j + 1] = v;
    }
    prevPrev = prev; prev = cur;
  }
  return prev[b.length];
}

// Score how well a free-text fragment matches a known candidate (0..1).
function matchScore(fragment, candidate) {
  const f = normalize(fragment), c = normalize(candidate);
  if (!f || !c) return 0;
  if (f === c) return 1;
  if (c.includes(f) || f.includes(c)) return 0.9;
  // token overlap (handles "john" ↔ "John Smith", word reorderings)
  const ft = new Set(f.split(' ')), ct = new Set(c.split(' '));
  let shared = 0;
  for (const t of ft) if (ct.has(t)) shared++;
  if (shared) {
    const overlap = shared / Math.min(ft.size, ct.size);
    if (overlap >= 0.5) return 0.6 + 0.3 * overlap;
  }
  // fuzzy on the closest token pair (typos: "jhon" ↔ "john")
  let best = Infinity;
  for (const a of ft) for (const b of ct) {
    if (Math.abs(a.length - b.length) > 2) continue;
    best = Math.min(best, levenshtein(a, b) / Math.max(a.length, b.length));
  }
  return best <= 0.34 ? 0.55 : 0;
}

// Best candidate above threshold, or null.
function fuzzyResolve(fragment, candidates = [], threshold = 0.5) {
  let best = null, bestScore = threshold;
  for (const cand of candidates) {
    const score = matchScore(fragment, cand);
    if (score > bestScore) { bestScore = score; best = cand; }
  }
  return best;
}

const STATUS_GROUP_RE = {
  done:        /\b(done|completed?|complete|finished|shipped|closed|resolved|delivered)\b/,
  blocked:     /\b(blocked?|stuck|on[ -]?hold|at[ -]?risk|impediment|impeded|waiting|stalled)\b/,
  working:     /\b(working on it|in[ -]?progress|ongoing|active|in flight|doing|started)\b/,
  not_started: /\b(not[ -]?started|to[ -]?do|todo|backlog|unstarted|pending|queued|new tasks?)\b/,
};
const STATUS_GROUP_LABEL = { done: 'completed', blocked: 'blocked / at-risk', working: 'in progress', not_started: 'not started' };

// Map free-text priority words to canonical buckets, incl. urgency synonyms.
const PRIORITY_SYNONYM = {
  critical: 'critical', urgent: 'critical', asap: 'critical', emergency: 'critical', blocker: 'critical',
  important: 'high', highest: 'high', high: 'high', 'top priority': 'high',
  medium: 'medium', moderate: 'medium', normal: 'medium',
  low: 'low', lowest: 'low', minor: 'low', trivial: 'low', whenever: 'low',
};

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_ALT = 'january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec';
const DATE_RE = new RegExp(
  '(\\d{4}-\\d{1,2}-\\d{1,2}' +                                   // 2026-06-20
  '|\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?' +                        // 6/20 or 6/20/26 (M/D)
  '|(?:' + MONTH_ALT + ')\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*\\d{4})?' + // June 20 / Jun 20, 2026
  '|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:' + MONTH_ALT + ')(?:,?\\s*\\d{4})?)', // 20 June
  'i');
const WEEKDAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
const pad2 = (n) => String(n).padStart(2, '0');
function addDaysISO(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
// Next occurrence of a weekday on or after `todayISO` (today counts).
function nextWeekday(todayISO, wd) { const d = new Date(todayISO + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + ((wd - d.getUTCDay() + 7) % 7)); return d.toISOString().slice(0, 10); }
function parseDateFragment(frag, year) {
  const f = String(frag).toLowerCase().trim();
  let m;
  if ((m = f.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  if ((m = f.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/))) { const y = m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : year; return `${y}-${pad2(m[1])}-${pad2(m[2])}`; }
  if ((m = f.match(/^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?$/)) && MONTHS[m[1]]) return `${m[3] || year}-${pad2(MONTHS[m[1]])}-${pad2(m[2])}`;
  if ((m = f.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]{3,9})(?:,?\s*(\d{4}))?$/)) && MONTHS[m[2]]) return `${m[3] || year}-${pad2(MONTHS[m[2]])}-${pad2(m[1])}`;
  return null;
}

function parseAskIntent(question, ctx = {}) {
  const owners = ctx.owners || [];
  const boards = ctx.boards || [];
  const statuses = ctx.statuses || [];
  const me = ctx.me || '';
  const todayISO = ctx.today || new Date().toISOString().slice(0, 10);
  const year = ctx.year || Number(todayISO.slice(0, 4));

  // Work on a padded, lowercased copy; `strip` removes matched spans so they
  // don't leak into the free-text search at the end.
  let s = ' ' + String(question || '').toLowerCase().replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const strip = (re) => { s = (' ' + s + ' ').replace(re, ' ').replace(/\s+/g, ' '); };
  const stripStr = (str) => strip(new RegExp(str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));

  const filters = {
    overdue: false, due: null, dueDays: null, noDeadline: false,
    dueOn: null, dueBefore: null, dueAfter: null,
    created: null, createdDays: null,
    statusGroup: null, statusValue: null, notDone: false, priority: null,
    unassigned: false, ownerIsMe: false, ownerIsNotMe: false, owner: null, ownersAny: null,
    board: null, count: false, help: false, limit: null, text: '',
  };
  const parts = [];
  let m;

  // ── Help / capabilities ──────────────────────────────────────────────────────
  if (/\b(what can (you|i) (do|ask)|how (do|to) (i|you) use|help me|^\s*help\s*$|examples?|what do you support)\b/.test(s)) {
    return { filters: { ...filters, help: true }, label: 'How to ask', intent: 'help', sort: 'due' };
  }

  // ── Count / aggregation ──────────────────────────────────────────────────────
  if (/\b(how many|number of|count (of|the)|total (number|count)|how much)\b/.test(s)) {
    filters.count = true;
    strip(/\b(how many|number of|count of|count the|total number of|total count of|total number|total count|how much)\b/g);
  }

  // ── Limit / superlative ──────────────────────────────────────────────────────
  // "top/first/last/next N" (but not "last N days") or "N items/tasks".
  // Match "top/first/last/next N" or "N items/tasks". Superlative words
  // (newest/oldest/latest) are intentionally left for the sort rule below.
  if ((m = s.match(/\b(?:top|first|last|next)\s+(\d{1,3})\b(?!\s+days?\b)/)) ||
      (m = s.match(/\b(\d{1,3})\s+(?:items?|tasks?|things?|results?|rows?)\b/))) {
    filters.limit = Math.min(parseInt(m[1], 10) || 1, 200);
    strip(/\b(?:top|first|last|next)\s+\d{1,3}\b/g);
    strip(/\b\d{1,3}\s+(?:items?|tasks?|things?|results?|rows?)\b/g);
  }
  let sortOverride = null;
  if (/\b(soonest|earliest|due next|next due|most urgent|due soonest|first to)\b/.test(s)) { sortOverride = 'due_asc'; if (!filters.limit && /\b(what|which) (is|s)\b|next due|due next|soonest\b/.test(s)) filters.limit = filters.limit || 1; strip(/\b(soonest|earliest|due next|next due|most urgent|due soonest|first to)\b/g); }
  else if (/\b(most overdue|longest overdue)\b/.test(s)) { filters.overdue = true; sortOverride = 'due_asc'; parts.push('overdue'); strip(/\b(most overdue|longest overdue)\b/g); }
  else if (/\b(newest|latest|most recent|recently (added|created)|just (added|created))\b/.test(s)) { sortOverride = 'created_desc'; strip(/\b(newest|latest|most recent|just added|just created)\b/g); }
  else if (/\b(oldest|stalest)\b/.test(s)) { sortOverride = 'created_asc'; strip(/\b(oldest|stalest)\b/g); }

  // ── Created window ───────────────────────────────────────────────────────────
  if ((m = s.match(/\b(?:created|added|made|new)\s+(?:in the\s+)?(?:last|past)\s+(\d{1,3})\s+days?\b/)) || (m = s.match(/\b(?:in the\s+)?(?:last|past)\s+(\d{1,3})\s+days?\b/) && /\b(created|added|new|made)\b/.test(s) && m)) {
    filters.created = 'n_days'; filters.createdDays = Math.min(parseInt(m[1], 10) || 7, 365);
    parts.push(`created in the last ${filters.createdDays} days`); strip(/\b(?:created|added|made|new)\s+(?:in the\s+)?(?:last|past)\s+\d{1,3}\s+days?\b/g); strip(/\b(?:in the\s+)?(?:last|past)\s+\d{1,3}\s+days?\b/g);
  } else if (/\b(created|added|made)\s+today\b/.test(s)) { filters.created = 'today'; parts.push('created today'); strip(/\b(created|added|made)\s+today\b/g); }
  else if (/\b(created|added|made)\s+this\s+week\b|\b(new|added|created)\s+this\s+week\b|recently (created|added|made)\b|\bjust (created|added)\b/.test(s)) { filters.created = 'this_week'; parts.push('created this week'); strip(/\b(created|added|made)\s+this\s+week\b|\b(new|added|created)\s+this\s+week\b|recently (created|added|made)\b|just (created|added)\b/g); }
  else if (/\b(created|added|made)\s+this\s+month\b/.test(s)) { filters.created = 'this_month'; parts.push('created this month'); strip(/\b(created|added|made)\s+this\s+month\b/g); }

  // ── Explicit due dates (before / after / by / on) ────────────────────────────
  let dm;
  if ((dm = s.match(DATE_RE))) {
    const iso = parseDateFragment(dm[0], year);
    if (iso) {
      const pre = s.slice(0, dm.index);
      if (/\b(before|prior to|earlier than)\s*$/.test(pre)) { filters.dueBefore = addDaysISO(iso, -1); parts.push(`due before ${iso}`); strip(/\b(before|prior to|earlier than)\b/g); }
      else if (/\b(after|later than)\s*$/.test(pre)) { filters.dueAfter = addDaysISO(iso, 1); parts.push(`due after ${iso}`); strip(/\b(after|later than)\b/g); }
      else if (/\b(from|since)\s*$/.test(pre)) { filters.dueAfter = iso; parts.push(`due on or after ${iso}`); strip(/\b(from|since)\b/g); }
      else if (/\b(by|until|till|due by)\s*$/.test(pre)) { filters.dueBefore = iso; parts.push(`due by ${iso}`); strip(/\b(by|until|till)\b/g); }
      else { filters.dueOn = iso; parts.push(`due on ${iso}`); }
      stripStr(dm[0]); strip(/\b(due|on)\b\s*$/g);
    }
  }
  // Weekday dates ("due by friday", "due monday") — only in an explicit date context.
  if (!filters.dueOn && !filters.dueBefore && !filters.dueAfter &&
      (m = s.match(new RegExp('\\b(' + Object.keys(WEEKDAYS).join('|') + ')\\b')))) {
    const pre = s.slice(0, m.index);
    const iso = nextWeekday(todayISO, WEEKDAYS[m[1]]);
    let matched = true;
    if (/\b(by|until|till)\s*$/.test(pre)) { filters.dueBefore = iso; parts.push(`due by ${m[1]}`); strip(/\b(by|until|till)\b/g); }
    else if (/\b(before|prior to|earlier than)\s*$/.test(pre)) { filters.dueBefore = addDaysISO(iso, -1); parts.push(`due before ${m[1]}`); strip(/\b(before|prior to|earlier than)\b/g); }
    else if (/\b(after|later than)\s*$/.test(pre)) { filters.dueAfter = addDaysISO(iso, 1); parts.push(`due after ${m[1]}`); strip(/\b(after|later than)\b/g); }
    else if (/\b(due|on|due on)\s*$/.test(pre)) { filters.dueOn = iso; parts.push(`due on ${m[1]}`); }
    else matched = false;
    if (matched) { stripStr(m[1]); strip(/\b(due|on)\b\s*$/g); }
  }

  // ── Relative due windows ─────────────────────────────────────────────────────
  if (!filters.dueOn && !filters.dueBefore && !filters.dueAfter) {
    if (/\b(overdue|over due|past due|late|behind schedule|missed (the )?deadline|slipped)\b/.test(s)) {
      filters.overdue = true; if (!parts.includes('overdue')) parts.push('overdue');
      strip(/\b(overdue|over due|past due|late|behind schedule|missed the deadline|missed deadline|slipped)\b/g);
    }
    if ((m = s.match(/\b(?:in the )?next (\d{1,3}) days?\b/))) {
      filters.due = 'n_days'; filters.dueDays = Math.min(parseInt(m[1], 10) || 7, 365);
      parts.push(`due in ${filters.dueDays} days`); strip(/\b(?:in the )?next \d{1,3} days?\b/g);
    } else if (/\b(due (this )?week|this week|due soon|upcoming|coming up|due shortly)\b/.test(s)) {
      filters.due = 'this_week'; parts.push('due this week');
      strip(/\b(due this week|due week|this week|due soon|upcoming|coming up|due shortly)\b/g);
    } else if (/\bnext week\b/.test(s)) {
      filters.due = 'next_week'; parts.push('due next week'); strip(/\bnext week\b/g);
    } else if (/\b(due )?tomorrow\b/.test(s)) {
      filters.due = 'tomorrow'; parts.push('due tomorrow'); strip(/\b(due )?tomorrow\b/g);
    } else if (/\b(due )?today\b/.test(s)) {
      filters.due = 'today'; parts.push('due today'); strip(/\b(due )?today\b/g);
    } else if (/\b(due )?this month\b/.test(s)) {
      filters.due = 'this_month'; parts.push('due this month'); strip(/\b(due )?this month\b/g);
    }
  }
  if (/\b(no (due ?date|deadline)|without (a )?(due ?date|deadline)|missing (a )?(due ?date|deadline)|undated|no date)\b/.test(s)) {
    filters.noDeadline = true; parts.push('with no due date');
    strip(/\b(no due ?date|no deadline|without a due ?date|without a deadline|missing a due ?date|missing a deadline|undated|no date)\b/g);
  }

  // ── Ownership ────────────────────────────────────────────────────────────────
  if (/\b(unassigned|no owner|without (an )?owner|nobody|no one|needs an owner|has no owner|not assigned to anyone|not assigned\b(?! to me))\b/.test(s)) {
    filters.unassigned = true; parts.push('unassigned');
    strip(/\b(unassigned|no owner|without an owner|without owner|nobody|no one|needs an owner|has no owner|not assigned to anyone)\b/g);
  }
  if (/\b(not (assigned to|owned by) me|not mine|isn't mine|someone else|other people|others)\b/.test(s)) {
    filters.ownerIsNotMe = true; parts.push('not owned by you');
    strip(/\b(not assigned to me|not owned by me|not mine|isn't mine|someone else|other people|others)\b/g);
  }
  if (!filters.ownerIsNotMe && /\b(assigned to me|my (items|tasks|work|stuff|things)|owned by me|for me|on my plate|mine|that i own|i am working on|i'm working on|am i working on)\b/.test(s)) {
    filters.ownerIsMe = true; parts.push('owned by you');
    strip(/\b(assigned to me|owned by me|for me|on my plate|that i own|i am working on|i'm working on|am i working on|mine)\b/g);
    strip(/\bmy (items|tasks|work|stuff|things)\b/g);
  }
  if (!filters.ownerIsMe && !filters.ownerIsNotMe) {
    // Multiple owners: "assigned to John or Priya".
    if ((m = s.match(/\b(?:assigned to|owned by|by|for)\s+([a-z][a-z .'’-]+?(?:\s*(?:,|or|and|&)\s*[a-z][a-z .'’-]+?)+)(?=\s+(?:on|in|board|that|which|due|right|now)\b|\s*$)/))) {
      const names = m[1].split(/\s*(?:,|\bor\b|\band\b|&)\s*/).map(x => fuzzyResolve(x.trim(), owners)).filter(Boolean);
      if (names.length >= 2) { filters.ownersAny = [...new Set(names)]; parts.push(`owned by ${filters.ownersAny.join(' or ')}`); stripStr(m[1]); }
    }
    if (!filters.ownersAny) {
      let frag = null;
      if ((m = s.match(/\b(?:assigned to|owned by|owner is|belongs to|handled by|managed by|responsible[: ]+|for)\s+([a-z][a-z .'’-]*?)(?=\s+(?:on|in|for|that|which|and|with|board|right|now|due)\b|\s*$)/))) frag = m[1];
      else if ((m = s.match(/\bwhat (?:is|are)\s+([a-z][a-z .'’-]*?)\s+(?:working on|doing|up to|responsible for)\b/))) frag = m[1];
      else if ((m = s.match(/\b([a-z][a-z'’-]+(?:\s+[a-z][a-z'’-]+)?)['’]s\s+(?:\w+\s+){0,3}?(?:items?|tasks?|work|stuff|things)\b/))) frag = m[1];
      else if ((m = s.match(/\bby\s+([a-z][a-z .'’-]*?)(?=\s+(?:on|in|that|which|and|board)\b|\s*$)/))) frag = m[1];
      if (frag) {
        frag = frag.trim();
        // The fragment may itself name several people ("John or Aanya").
        const pieces = frag.split(/\s*(?:,|\bor\b|\band\b|&)\s*/).map(x => x.trim()).filter(Boolean);
        const resolved = [...new Set(pieces.map(p => fuzzyResolve(p, owners)).filter(Boolean))];
        if (resolved.length >= 2) { filters.ownersAny = resolved; parts.push(`owned by ${resolved.join(' or ')}`); stripStr(frag); }
        else {
          const hit = resolved[0] || fuzzyResolve(frag, owners);
          if (hit) { filters.owner = hit; parts.push(`owned by ${hit}`); }
          else if (!owners.length && frag && !ASK_STOPWORDS.has(normalize(frag))) { filters.owner = titleCase(frag); parts.push(`owned by ${titleCase(frag)}`); }
          if (filters.owner) stripStr(frag);
        }
      }
    }
  }

  // ── Board scope ──────────────────────────────────────────────────────────────
  if ((m = s.match(/\b(?:on|in|from|within)\s+(?:the\s+)?([a-z0-9][a-z0-9 &/-]*?)\s+board\b/)) ||
      (m = s.match(/\bboard\s+(?:called|named|titled)\s+([a-z0-9][a-z0-9 &/-]*?)(?=\s+(?:with|that|and)\b|\s*$)/))) {
    const hit = fuzzyResolve(m[1], boards);
    if (hit) { filters.board = hit; parts.push(`on ${hit}`); stripStr(m[1]); strip(/\bboard\b/g); }
  }
  if (!filters.board) {
    for (const b of boards) {
      if (normalize(b).length >= 3 && normalize(s).includes(normalize(b))) {
        filters.board = b; parts.push(`on ${b}`); strip(new RegExp('\\b' + normalize(b).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi')); break;
      }
    }
  }

  // ── Priority (canonical buckets + urgency synonyms) ──────────────────────────
  const prioKeys = Object.keys(PRIORITY_SYNONYM).sort((a, b) => b.length - a.length);
  for (const k of prioKeys) {
    if (new RegExp('\\b' + k + '\\b').test(s) && (/\bpriorit/.test(s) || /\b(critical|urgent|asap|important|emergency|blocker|trivial)\b/.test(s))) {
      filters.priority = PRIORITY_SYNONYM[k]; parts.push(`${filters.priority} priority`);
      stripStr(k); strip(/\bpriority|importance\b/g); break;
    }
  }

  // ── Status: "not done" negation first (so it can't match the "Done" label),
  //    then an exact label from the real vocab, else a semantic group. ──────────
  if (/\b(not done|isn't done|is not done|unfinished|incomplete|not complete|still open|open items?|outstanding|remaining|left to do|still to do|not closed|unresolved|in flight|wip|not finished)\b/.test(s)) {
    filters.notDone = true; parts.push('not done');
    strip(/\b(not done|isn't done|is not done|unfinished|incomplete|not complete|still open|open items?|outstanding|remaining|left to do|still to do|not closed|unresolved|in flight|wip|not finished)\b/g);
  }
  for (const lbl of statuses.slice().sort((a, b) => String(b).length - String(a).length)) {
    const n = normalize(lbl);
    if (n.length >= 2 && normalize(s).includes(n)) { filters.statusValue = lbl; parts.push(`status "${lbl}"`); strip(new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi')); break; }
  }
  if (!filters.statusValue) {
    for (const [g, re] of Object.entries(STATUS_GROUP_RE)) {
      if (re.test(s)) { filters.statusGroup = g; parts.push(STATUS_GROUP_LABEL[g]); strip(new RegExp(re.source, 'g')); break; }
    }
  }

  // ── Free-text remainder ──────────────────────────────────────────────────────
  filters.text = normalize(s).split(' ').filter(w => w.length >= 2 && !ASK_STOPWORDS.has(w)).join(' ').trim();

  // ── Sort + human label + coarse intent tag ───────────────────────────────────
  const sort = sortOverride || (filters.text ? 'relevance' : 'due');
  let label;
  if (parts.length && filters.text) label = `${cap(joinParts(parts))} matching “${filters.text}”`;
  else if (parts.length) label = cap(joinParts(parts));
  else if (filters.text) label = `Matching “${filters.text}”`;
  else label = 'All items';

  const intent = filters.overdue ? 'overdue'
    : (filters.due || filters.dueOn || filters.dueBefore || filters.dueAfter) ? 'due_soon'
      : filters.created ? 'recent'
        : filters.unassigned ? 'unassigned'
          : filters.statusGroup === 'done' ? 'done'
            : filters.statusGroup === 'blocked' ? 'blocked'
              : (filters.owner || filters.ownersAny || filters.ownerIsMe) ? 'by_owner'
                : 'search';

  return { filters, label, intent, sort };
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
function joinParts(parts) {
  if (parts.length <= 1) return parts.join('');
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

module.exports = {
  parseBoard, parseFormula, parseAutomation, validateFormula, inferColumnType,
  parseAskIntent, normalize, fuzzyResolve, matchScore,
};
