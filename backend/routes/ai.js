const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole, canAccessBoard } = require('../middleware/auth');
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
  if (user.role === 'admin') return (await pool.query(`SELECT id FROM boards WHERE is_deleted IS NOT TRUE`)).rows.map(r => r.id);
  return (await pool.query(
    `SELECT b.id FROM boards b WHERE (b.is_deleted IS NOT TRUE)
       AND (b.visibility='org_wide' OR EXISTS (SELECT 1 FROM board_members bm WHERE bm.board_id=b.id AND bm.user_id=$1))`,
    [user.id]
  )).rows.map(r => r.id);
}

// One row per item with its first status / owner / date value across the boards.
async function loadWorkspaceItems(boardIds) {
  if (!boardIds.length) return [];
  const { rows } = await pool.query(
    `SELECT i.id, i.name, g.board_id, b.name AS board_name,
            MAX(CASE WHEN c.type='status'   THEN cv.value END) AS status,
            MAX(CASE WHEN c.type IN ('person') THEN cv.value END) AS owner,
            MAX(CASE WHEN c.type='date'     THEN cv.value END) AS due
       FROM items i
       JOIN groups g ON g.id=i.group_id
       JOIN boards b ON b.id=g.board_id
       LEFT JOIN column_values cv ON cv.item_id=i.id
       LEFT JOIN columns c ON c.id=cv.column_id AND c.type IN ('status','person','date')
      WHERE g.board_id = ANY($1) AND i.parent_item_id IS NULL
      GROUP BY i.id, g.board_id, b.name
      LIMIT 5000`,
    [boardIds]
  );
  return rows.map(r => ({ ...r, owners: parseOwners(r.owner) }));
}
function parseOwners(raw) {
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a.map(x => (x && x.name) ? x.name : x) : [String(raw)]; }
  catch { return raw ? [String(raw)] : []; }
}
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const today = () => new Date().toISOString().slice(0, 10);

// ── POST /api/ai/ask — semantic Q&A over the workspace ───────────────────────
router.post('/ask', requireAuth, async (req, res) => {
  const { question } = req.body;
  if (!question || !String(question).trim()) return res.status(400).json({ error: 'question is required' });
  try {
    const intent = require('../services/nlEngine').parseAskIntent(question);
    const items = await loadWorkspaceItems(await accessibleBoardIds(req.user));
    const t = today();
    const matches = items.filter(it => {
      const st = String(it.status || '').toLowerCase();
      switch (intent.type) {
        case 'overdue':   return it.due && ISO.test(it.due) && it.due < t && !/done|complete|closed/.test(st);
        case 'blocked':   return /stuck|block|hold|risk/.test(st);
        case 'unassigned':return it.owners.length === 0;
        case 'done':      return /done|complete|closed|shipped/.test(st);
        case 'due_soon': { if (!it.due || !ISO.test(it.due) || /done|complete|closed/.test(st)) return false; const d = Math.round((new Date(it.due) - new Date(t)) / 86400000); return d >= 0 && d <= 7; }
        case 'by_owner':  return it.owners.some(o => String(o).toLowerCase().includes(intent.value));
        default:          return intent.value ? it.name.toLowerCase().includes(intent.value) : true;
      }
    });
    // Sort: overdue/soonest first when date-based, else by board.
    matches.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
    const answer = matches.length
      ? `${intent.label}: ${matches.length} item${matches.length !== 1 ? 's' : ''}.`
      : `No items found for "${intent.label}".`;
    res.json({
      intent: intent.type, label: intent.label, count: matches.length, answer,
      items: matches.slice(0, 50).map(m => ({ id: m.id, name: m.name, board_id: m.board_id, board_name: m.board_name, status: m.status || '', owners: m.owners, due: m.due || '' })),
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
