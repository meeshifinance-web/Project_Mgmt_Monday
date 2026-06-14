const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole, canAccessBoard, isSuperAdmin } = require('../middleware/auth');
const nl = require('../services/nlEngine');

const canWrite = [requireAuth, requireRole('admin', 'manager')];

// ── POST /api/ai/board — describe a board → spec (columns + groups) ───────────
router.post('/board', ...canWrite, (req, res) => {
  const { prompt } = req.body;
  if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: 'prompt is required' });
  const spec = nl.parseBoard(prompt);
  if (spec.error) return res.status(422).json({ error: spec.error });
  res.json({ spec });
});

// ── POST /api/ai/formula — describe a formula → validated formula ────────────
// Body: { prompt, columns:[{title,type}] }
router.post('/formula', requireAuth, (req, res) => {
  const { prompt, columns } = req.body;
  if (!prompt || !String(prompt).trim()) return res.status(400).json({ error: 'prompt is required' });
  const result = nl.parseFormula(prompt, Array.isArray(columns) ? columns : []);
  res.json(result);
});

// ── POST /api/ai/automation — describe a rule → recipe against real columns ──
// Body: { board_id, prompt }. Loads the board's real columns + groups.
router.post('/automation', ...canWrite, async (req, res) => {
  const { board_id, prompt } = req.body;
  if (!board_id || !prompt) return res.status(400).json({ error: 'board_id and prompt are required' });
  try {
    if (!(await canAccessBoard(board_id, req.user, pool))) return res.status(403).json({ error: 'Access denied' });
    const columns = (await pool.query('SELECT id, title, type, settings FROM columns WHERE board_id=$1 ORDER BY position', [board_id])).rows
      .map(c => ({ ...c, settings: typeof c.settings === 'string' ? JSON.parse(c.settings || '{}') : (c.settings || {}) }));
    const groups = (await pool.query('SELECT id, name FROM groups WHERE board_id=$1 ORDER BY position', [board_id])).rows;
    const result = nl.parseAutomation(prompt, columns, groups);
    if (!result.valid) return res.status(422).json({ error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[ai/automation]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Boards the user may read.
async function accessibleBoardIds(user) {
  if (isSuperAdmin(user)) return (await pool.query(`SELECT id FROM boards WHERE is_deleted IS NOT TRUE`)).rows.map(r => r.id);
  return (await pool.query(
    `SELECT b.id FROM boards b WHERE (b.is_deleted IS NOT TRUE)
       AND (b.visibility='org_wide' OR b.created_by=$1
            OR EXISTS (SELECT 1 FROM board_members bm WHERE bm.board_id=b.id AND bm.user_id=$1))`,
    [user.id]
  )).rows.map(r => r.id);
}

// One row per item with its first status / owner / date value across the boards.
async function loadWorkspaceItems(boardIds) {
  if (!boardIds.length) return [];
  const { rows } = await pool.query(
    `SELECT i.id, i.name, i.created_at, g.board_id, b.name AS board_name,
            MAX(CASE WHEN c.type='status'   THEN cv.value END) AS status,
            MAX(CASE WHEN c.type='priority' THEN cv.value END) AS priority,
            MAX(CASE WHEN c.type IN ('person') THEN cv.value END) AS owner,
            MAX(CASE WHEN c.type='date'     THEN cv.value END) AS due
       FROM items i
       JOIN groups g ON g.id=i.group_id
       JOIN boards b ON b.id=g.board_id
       LEFT JOIN column_values cv ON cv.item_id=i.id
       LEFT JOIN columns c ON c.id=cv.column_id AND c.type IN ('status','priority','person','date')
      WHERE g.board_id = ANY($1) AND i.parent_item_id IS NULL
      GROUP BY i.id, g.board_id, b.name
      LIMIT 5000`,
    [boardIds]
  );
  return rows.map(r => ({
    ...r, priority: cleanLabel(r.priority), owners: parseOwners(r.owner),
    created: r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : '',
  }));
}
function parseOwners(raw) {
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a.map(x => (x && x.name) ? x.name : x) : [String(raw)]; }
  catch { return raw ? [String(raw)] : []; }
}
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);

// A status/priority value may be stored as a plain label or as JSON ({label}).
function cleanLabel(raw) {
  if (!raw) return '';
  const v = String(raw).trim();
  if (v[0] === '{' || v[0] === '[') {
    try { const o = JSON.parse(v); return String((o && (o.label ?? o.text ?? o.value)) ?? '').trim(); } catch { /* fall through */ }
  }
  return v;
}
const isDone = (st) => /done|complete|closed|shipped|resolved|delivered/.test(st);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const lower = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

// Resolve a relative due-window keyword to an inclusive ISO date range.
function dueWindow(due, dueDays, t) {
  const base = new Date(t + 'T00:00:00Z');
  const add = (n) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  switch (due) {
    case 'today':      return { from: t, to: t };
    case 'tomorrow':   return { from: add(1), to: add(1) };
    case 'this_week':  return { from: t, to: add(7) };
    case 'next_week':  return { from: add(7), to: add(14) };
    case 'n_days':     return { from: t, to: add(dueDays || 7) };
    case 'this_month': { const eom = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)); return { from: t, to: eom.toISOString().slice(0, 10) }; }
    default:           return null;
  }
}

// Resolve a relative *created* window to an inclusive ISO range (backward-looking).
function createdWindow(created, createdDays, t) {
  const base = new Date(t + 'T00:00:00Z');
  const add = (n) => { const d = new Date(base); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  switch (created) {
    case 'today':      return { from: t, to: t };
    case 'this_week':  return { from: add(-6), to: t };
    case 'n_days':     return { from: add(-(createdDays || 7)), to: t };
    case 'this_month': return { from: t.slice(0, 8) + '01', to: t };
    default:           return null;
  }
}

function statusGroupMatch(st, g) {
  switch (g) {
    case 'done':        return isDone(st);
    case 'blocked':     return /stuck|block|hold|risk|impediment|impeded|waiting|stalled/.test(st);
    case 'working':     return (/working|progress|ongoing|active|doing|started|in flight/.test(st)) && !isDone(st);
    case 'not_started': return st === '' || /not started|to ?do|todo|backlog|unstarted|pending|queued|new/.test(st);
    default:            return true;
  }
}

// Owner equality: the filter value is already a resolved name, so a loose
// containment match is enough (handles "John" vs "John Smith").
function ownerMatches(o, target) {
  const a = nl.normalize(o), b = nl.normalize(target);
  return !!a && !!b && (a === b || a.includes(b) || b.includes(a) || nl.matchScore(b, a) >= 0.6);
}

// ── POST /api/ai/ask — semantic Q&A over the workspace ───────────────────────
router.post('/ask', requireAuth, async (req, res) => {
  const { question } = req.body;
  if (!question || !String(question).trim()) return res.status(400).json({ error: 'question is required' });
  try {
    const items = await loadWorkspaceItems(await accessibleBoardIds(req.user));

    // Build the real workspace vocabulary so the parser can resolve people and
    // board names by fuzzy match instead of blind substring guessing.
    const ownerVocab = [...new Set(items.flatMap(i => i.owners.map(o => String(o))))].filter(Boolean);
    const boardVocab = [...new Set(items.map(i => i.board_name))].filter(Boolean);
    const statusVocab = [...new Set(items.map(i => cleanLabel(i.status)))].filter(Boolean);
    const { filters, label, intent, sort } = nl.parseAskIntent(question, { owners: ownerVocab, boards: boardVocab, statuses: statusVocab, me: req.user.name });

    // Help / capabilities — explain what the assistant can answer.
    if (filters.help) {
      return res.json({
        intent: 'help', label, count: 0, filters, items: [],
        answer: [
          'Ask me about your workspace in plain English. You can combine filters freely:',
          '• "What\'s overdue and assigned to me?"',
          '• "Priya\'s blocked tasks on the Marketing board"',
          '• "How many high-priority items are unassigned?"',
          '• "What\'s due before June 20?"  ·  "due in the next 3 days"',
          '• "Items created this week"  ·  "newest 5 tasks"',
          '• "What is John or Aanya working on?"',
        ].join('\n'),
      });
    }

    const t = today();
    const win = dueWindow(filters.due, filters.dueDays, t);
    const cwin = createdWindow(filters.created, filters.createdDays, t);
    const textTokens = filters.text ? filters.text.split(' ').filter(Boolean) : [];

    let matches = items.filter(it => {
      const st = String(it.status || '').toLowerCase();
      const dated = it.due && ISO.test(it.due);
      if (filters.overdue && !(dated && it.due < t && !isDone(st))) return false;
      if (win && !(dated && it.due >= win.from && it.due <= win.to && !isDone(st))) return false;
      if (filters.dueOn && it.due !== filters.dueOn) return false;
      if (filters.dueBefore && !(dated && it.due <= filters.dueBefore)) return false;
      if (filters.dueAfter && !(dated && it.due >= filters.dueAfter)) return false;
      if (filters.noDeadline && dated) return false;
      if (cwin && !(it.created && it.created >= cwin.from && it.created <= cwin.to)) return false;
      if (filters.statusValue && nl.normalize(cleanLabel(it.status)) !== nl.normalize(filters.statusValue)) return false;
      if (filters.statusGroup && !statusGroupMatch(st, filters.statusGroup)) return false;
      if (filters.notDone && isDone(st)) return false;
      if (filters.priority && !String(it.priority || '').toLowerCase().includes(filters.priority.toLowerCase())) return false;
      if (filters.unassigned && it.owners.length) return false;
      if (filters.ownerIsMe && !it.owners.some(o => ownerMatches(o, req.user.name))) return false;
      if (filters.ownerIsNotMe && it.owners.some(o => ownerMatches(o, req.user.name))) return false;
      if (filters.owner && !it.owners.some(o => ownerMatches(o, filters.owner))) return false;
      if (filters.ownersAny && !it.owners.some(o => filters.ownersAny.some(t2 => ownerMatches(o, t2)))) return false;
      if (filters.board && nl.normalize(it.board_name) !== nl.normalize(filters.board)) return false;
      if (textTokens.length) {
        const hay = (it.name + ' ' + it.board_name + ' ' + it.owners.join(' ')).toLowerCase();
        if (!textTokens.every(tok => hay.includes(tok))) return false;
      }
      return true;
    });

    // Rank.
    const byDue = (a, b) => (a.due || '9999').localeCompare(b.due || '9999');
    if (sort === 'relevance') {
      const score = (it) => {
        const name = it.name.toLowerCase();
        let sc = 0;
        for (const tok of textTokens) { if (name.includes(tok)) sc += 2; }
        if (filters.text && name.includes(filters.text)) sc += 3;
        if (it.due && ISO.test(it.due) && it.due >= t) sc += 1;
        return sc;
      };
      matches.sort((a, b) => score(b) - score(a) || byDue(a, b));
    } else if (sort === 'created_desc') matches.sort((a, b) => (b.created || '').localeCompare(a.created || ''));
    else if (sort === 'created_asc') matches.sort((a, b) => (a.created || '9999').localeCompare(b.created || '9999'));
    else matches.sort(byDue); // 'due' / 'due_asc'

    const total = matches.length;
    if (filters.limit) matches = matches.slice(0, filters.limit);

    const noun = (n) => `${n} item${n !== 1 ? 's' : ''}`;
    let answer;
    if (filters.count) {
      answer = total ? `${cap(label)}: ${noun(total)}.` : `None — no items match ${lower(label)}.`;
    } else {
      answer = total ? `${cap(label)}: ${noun(total)}${filters.limit && total > filters.limit ? ` (showing ${matches.length})` : ''}.`
        : `No items found for ${lower(label)}.`;
    }
    res.json({
      intent, label, count: total, answer, filters,
      items: matches.slice(0, 50).map(m => ({ id: m.id, name: m.name, board_id: m.board_id, board_name: m.board_name, status: m.status || '', priority: m.priority || '', owners: m.owners, due: m.due || '', created: m.created || '' })),
    });
  } catch (err) {
    console.error('[ai/ask]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/ai/digest?board_id= | scope=me — auto-written standup summary ────
router.get('/digest', requireAuth, async (req, res) => {
  try {
    const scopeMe = req.query.scope === 'me';
    let boardIds, title;
    if (scopeMe) { boardIds = await accessibleBoardIds(req.user); title = `${req.user.name}'s standup`; }
    else {
      const bid = parseInt(req.query.board_id, 10);
      if (!bid || !(await canAccessBoard(bid, req.user, pool))) return res.status(403).json({ error: 'Access denied' });
      boardIds = [bid];
      title = (await pool.query('SELECT name FROM boards WHERE id=$1', [bid])).rows[0]?.name || 'Board';
    }
    let items = await loadWorkspaceItems(boardIds);
    if (scopeMe) items = items.filter(it => it.owners.some(o => String(o).toLowerCase() === String(req.user.name).toLowerCase()));
    const t = today();
    const done = items.filter(i => /done|complete|closed|shipped/.test(String(i.status).toLowerCase()));
    const blocked = items.filter(i => /stuck|block|hold|risk/.test(String(i.status).toLowerCase()));
    const overdue = items.filter(i => i.due && ISO.test(i.due) && i.due < t && !/done|complete|closed/.test(String(i.status).toLowerCase()));
    const dueSoon = items.filter(i => { if (!i.due || !ISO.test(i.due)) return false; const d = Math.round((new Date(i.due) - new Date(t)) / 86400000); return d >= 0 && d <= 7 && !/done|complete|closed/.test(String(i.status).toLowerCase()); });
    const lines = [
      `📋 ${title} — ${t}`,
      `• ${items.length} item${items.length !== 1 ? 's' : ''} total · ${done.length} done · ${blocked.length} blocked`,
      overdue.length ? `• ⚠ ${overdue.length} overdue: ${overdue.slice(0, 5).map(i => i.name).join(', ')}${overdue.length > 5 ? '…' : ''}` : '• ✅ Nothing overdue',
      dueSoon.length ? `• 🟡 ${dueSoon.length} due this week: ${dueSoon.slice(0, 5).map(i => i.name).join(', ')}${dueSoon.length > 5 ? '…' : ''}` : '• No deadlines in the next 7 days',
      blocked.length ? `• 🔴 Blocked: ${blocked.slice(0, 5).map(i => `${i.name}${i.owners[0] ? ' (' + i.owners[0] + ')' : ''}`).join(', ')}` : '',
    ].filter(Boolean);
    res.json({ title, date: t, text: lines.join('\n'), stats: { total: items.length, done: done.length, blocked: blocked.length, overdue: overdue.length, dueSoon: dueSoon.length } });
  } catch (err) {
    console.error('[ai/digest]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
