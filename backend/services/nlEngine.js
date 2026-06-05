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

// ── Ask-your-workspace intent ────────────────────────────────────────────────
function parseAskIntent(question) {
  const s = String(question || '').toLowerCase();
  let m;
  if (/overdue|past due|\blate\b|missed (the )?deadline/.test(s)) return { type: 'overdue', label: 'Overdue items' };
  if (/block|stuck|at risk|on hold|impediment/.test(s)) return { type: 'blocked', label: 'Blocked / at-risk items' };
  if (/unassigned|no owner|nobody|without (an )?owner|needs an owner/.test(s)) return { type: 'unassigned', label: 'Unassigned items' };
  if (/due (this week|soon|upcoming)|\bthis week\b|upcoming|next \d+ days|coming up/.test(s)) return { type: 'due_soon', label: 'Due in the next 7 days' };
  if (/\b(done|completed|finished|shipped|closed)\b/.test(s)) return { type: 'done', label: 'Completed items' };
  if ((m = s.match(/what (?:is|are)\s+([a-z .'-]+?)\s+(?:working on|doing|up to)/))) return { type: 'by_owner', value: m[1].trim(), label: `Items owned by ${m[1].trim()}` };
  if ((m = s.match(/(?:working on|assigned to|owned by|owner is|by)\s+([a-z .'-]+)/))) return { type: 'by_owner', value: m[1].trim(), label: `Items owned by ${m[1].trim()}` };
  const term = s.replace(/\b(what|which|who|show|me|list|find|all|items?|tasks?|are|is|the|on|board|right now|currently)\b/g, '').replace(/[?]/g, '').trim();
  return { type: 'search', value: term, label: term ? `Matching "${term}"` : 'Recent items' };
}

module.exports = { parseBoard, parseFormula, parseAutomation, validateFormula, inferColumnType, parseAskIntent };
