const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole, canAccessBoard } = require('../middleware/auth');
const { requireScope } = require('../middleware/apiAuth');

const canWrite = [requireAuth, requireScope('write'), requireRole('admin', 'manager')];

// Normalise the incoming recipe into the multi-condition / multi-action shape,
// while keeping the legacy single action_type/action_config columns mirrored
// (from the first action) so older readers and the client Summary keep working.
function normalizeRecipe(body) {
  const conditions = Array.isArray(body.conditions)
    ? body.conditions.filter(c => c && c.column_id && c.operator)
    : [];
  let actions = Array.isArray(body.actions)
    ? body.actions.filter(a => a && a.type).map(a => ({ type: a.type, config: a.config || {} }))
    : [];
  // Legacy single-action payload → wrap it as a one-element action list.
  if (!actions.length && body.action_type) {
    actions = [{ type: body.action_type, config: body.action_config || {} }];
  }
  const mirrorType   = actions[0]?.type   || body.action_type   || null;
  const mirrorConfig = actions[0]?.config || body.action_config || {};
  return { conditions, actions, mirrorType, mirrorConfig };
}

// Resolve the board a given automation belongs to (for /:id routes).
async function boardIdForAutomation(automationId) {
  const { rows } = await pool.query('SELECT board_id FROM automations WHERE id=$1', [automationId]);
  return rows.length ? rows[0].board_id : null;
}

router.get('/board/:boardId', requireAuth, async (req, res) => {
  try {
    if (!(await canAccessBoard(req.params.boardId, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });
    const { rows } = await pool.query(
      'SELECT * FROM automations WHERE board_id=$1 ORDER BY created_at DESC',
      [req.params.boardId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', ...canWrite, async (req, res) => {
  const { board_id, name, trigger_type, trigger_config, enabled } = req.body;
  try {
    if (!board_id) return res.status(400).json({ error: 'board_id is required' });
    if (!(await canAccessBoard(board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });
    const { conditions, actions, mirrorType, mirrorConfig } = normalizeRecipe(req.body);
    const { rows } = await pool.query(
      `INSERT INTO automations (board_id, name, trigger_type, trigger_config, action_type, action_config, conditions, actions, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9, true)) RETURNING *`,
      [board_id, name, trigger_type, JSON.stringify(trigger_config), mirrorType, JSON.stringify(mirrorConfig),
       JSON.stringify(conditions), JSON.stringify(actions), enabled ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT preserves the existing `enabled` value when the request body omits it
// (form-edit payloads typically don't carry the toggle state). The toggle
// endpoint sends an explicit boolean, which still lands correctly via COALESCE.
router.put('/:id', ...canWrite, async (req, res) => {
  const { name, trigger_type, trigger_config, enabled } = req.body;
  try {
    const boardId = await boardIdForAutomation(req.params.id);
    if (!boardId) return res.status(404).json({ error: 'Automation not found' });
    if (!(await canAccessBoard(boardId, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });
    const { conditions, actions, mirrorType, mirrorConfig } = normalizeRecipe(req.body);
    const { rows } = await pool.query(
      `UPDATE automations SET name=$1, trigger_type=$2, trigger_config=$3, action_type=$4, action_config=$5,
                              conditions=$6, actions=$7, enabled=COALESCE($8, enabled)
       WHERE id=$9 RETURNING *`,
      [name, trigger_type, JSON.stringify(trigger_config), mirrorType, JSON.stringify(mirrorConfig),
       JSON.stringify(conditions), JSON.stringify(actions), enabled ?? null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', ...canWrite, async (req, res) => {
  try {
    const boardId = await boardIdForAutomation(req.params.id);
    if (!boardId) return res.status(404).json({ error: 'Automation not found' });
    if (!(await canAccessBoard(boardId, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });
    await pool.query('DELETE FROM automations WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
