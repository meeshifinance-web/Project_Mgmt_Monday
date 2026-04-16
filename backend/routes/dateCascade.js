const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { runDateCascade } = require('../services/dateCascadeEngine');

// ── Step Templates ────────────────────────────────────────────────────────────

// GET /api/date-cascade/templates/:boardId
router.get('/templates/:boardId', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT bst.*, c.title AS column_title, c.type AS column_type
       FROM board_step_templates bst
       LEFT JOIN columns c ON c.id = bst.column_id
       WHERE bst.board_id=$1
       ORDER BY bst.step_order ASC`,
      [req.params.boardId]
    );
    res.json(rows);
  } catch (err) {
    console.error('[DateCascade] get templates:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/date-cascade/templates/:boardId — replace all steps (upsert by delete+insert)
router.post('/templates/:boardId', requireAuth, async (req, res) => {
  const boardId = parseInt(req.params.boardId);
  const { steps } = req.body;
  if (!Array.isArray(steps)) return res.status(400).json({ error: 'steps must be an array' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM board_step_templates WHERE board_id=$1', [boardId]);

    let anchorSet = false;
    for (const step of steps) {
      const isAnchor = !!step.is_anchor && !anchorSet;
      if (step.is_anchor) anchorSet = true;
      await client.query(
        `INSERT INTO board_step_templates
           (board_id, step_order, step_name, duration_days, column_id, is_anchor)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [boardId, step.step_order, step.step_name,
         Math.max(0, parseInt(step.duration_days) ?? 0),
         step.column_id, isAnchor]
      );
    }

    await client.query('COMMIT');
    const { rows } = await pool.query(
      `SELECT bst.*, c.title AS column_title, c.type AS column_type
       FROM board_step_templates bst
       LEFT JOIN columns c ON c.id = bst.column_id
       WHERE bst.board_id=$1 ORDER BY bst.step_order ASC`,
      [boardId]
    );
    res.json(rows);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[DateCascade] save templates:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// PUT /api/date-cascade/templates/:boardId/step/:stepId — partial update a single step
router.put('/templates/:boardId/step/:stepId', requireAuth, async (req, res) => {
  const { step_name, duration_days, is_anchor, step_order } = req.body;
  const fields = [];
  const vals = [];
  let idx = 1;
  if (step_name !== undefined)     { fields.push(`step_name=$${idx++}`);     vals.push(step_name); }
  if (duration_days !== undefined) { fields.push(`duration_days=$${idx++}`); vals.push(Math.max(0, parseInt(duration_days) || 0)); }
  if (is_anchor !== undefined)     { fields.push(`is_anchor=$${idx++}`);     vals.push(!!is_anchor); }
  if (step_order !== undefined)    { fields.push(`step_order=$${idx++}`);    vals.push(parseInt(step_order)); }
  if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
  fields.push('updated_at=NOW()');
  vals.push(req.params.stepId);
  try {
    const { rows } = await pool.query(
      `UPDATE board_step_templates SET ${fields.join(',')} WHERE id=$${idx} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Step not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[DateCascade] update step:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/date-cascade/templates/:boardId — wipe all steps for a board
router.delete('/templates/:boardId', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM board_step_templates WHERE board_id=$1', [req.params.boardId]);
    res.json({ success: true });
  } catch (err) {
    console.error('[DateCascade] delete templates:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Automation Rules ──────────────────────────────────────────────────────────

// GET /api/date-cascade/rules/:boardId
router.get('/rules/:boardId', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT bar.*,
              tc.title AS trigger_column_title,
              ac.title AS anchor_column_title
       FROM board_automation_rules bar
       LEFT JOIN columns tc ON tc.id = bar.trigger_column_id
       LEFT JOIN columns ac ON ac.id = bar.anchor_column_id
       WHERE bar.board_id=$1
       ORDER BY bar.id ASC`,
      [req.params.boardId]
    );
    res.json(rows);
  } catch (err) {
    console.error('[DateCascade] get rules:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/date-cascade/rules/:boardId
router.post('/rules/:boardId', requireAuth, async (req, res) => {
  const {
    rule_name, trigger_type, trigger_column_id,
    trigger_status_from, trigger_status_to,
    anchor_column_id, direction,
  } = req.body;
  if (!['date_entry', 'status_change'].includes(trigger_type))
    return res.status(400).json({ error: 'Invalid trigger_type' });
  if (!['forward', 'backward'].includes(direction))
    return res.status(400).json({ error: 'Invalid direction' });
  if (!anchor_column_id)
    return res.status(400).json({ error: 'anchor_column_id is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO board_automation_rules
         (board_id, rule_name, trigger_type, trigger_column_id,
          trigger_status_from, trigger_status_to, anchor_column_id, direction)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.params.boardId, rule_name, trigger_type,
       trigger_column_id || null,
       trigger_status_from || null, trigger_status_to || null,
       anchor_column_id, direction]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[DateCascade] create rule:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/date-cascade/rules/:ruleId
router.put('/rules/:ruleId', requireAuth, async (req, res) => {
  const {
    rule_name, trigger_type, trigger_column_id,
    trigger_status_from, trigger_status_to,
    anchor_column_id, direction, is_active,
  } = req.body;
  const fields = [];
  const vals = [];
  let idx = 1;
  if (rule_name !== undefined)           { fields.push(`rule_name=$${idx++}`);           vals.push(rule_name); }
  if (trigger_type !== undefined)        { fields.push(`trigger_type=$${idx++}`);        vals.push(trigger_type); }
  if (trigger_column_id !== undefined)   { fields.push(`trigger_column_id=$${idx++}`);   vals.push(trigger_column_id || null); }
  if (trigger_status_from !== undefined) { fields.push(`trigger_status_from=$${idx++}`); vals.push(trigger_status_from || null); }
  if (trigger_status_to !== undefined)   { fields.push(`trigger_status_to=$${idx++}`);   vals.push(trigger_status_to || null); }
  if (anchor_column_id !== undefined)    { fields.push(`anchor_column_id=$${idx++}`);    vals.push(anchor_column_id); }
  if (direction !== undefined)           { fields.push(`direction=$${idx++}`);            vals.push(direction); }
  if (is_active !== undefined)           { fields.push(`is_active=$${idx++}`);            vals.push(!!is_active); }
  if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
  fields.push('updated_at=NOW()');
  vals.push(req.params.ruleId);
  try {
    const { rows } = await pool.query(
      `UPDATE board_automation_rules SET ${fields.join(',')} WHERE id=$${idx} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Rule not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[DateCascade] update rule:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/date-cascade/rules/:ruleId
router.delete('/rules/:ruleId', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM board_automation_rules WHERE id=$1', [req.params.ruleId]);
    res.json({ success: true });
  } catch (err) {
    console.error('[DateCascade] delete rule:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Manual Trigger ────────────────────────────────────────────────────────────

// POST /api/date-cascade/trigger
router.post('/trigger', requireAuth, async (req, res) => {
  const { boardId, itemId, anchorColumnId, anchorDate, direction, ruleId, forceOverwrite } = req.body;
  if (!boardId || !itemId || !anchorColumnId || !anchorDate)
    return res.status(400).json({ error: 'boardId, itemId, anchorColumnId, anchorDate are required' });
  if (!['forward', 'backward'].includes(direction))
    return res.status(400).json({ error: 'Invalid direction — must be forward or backward' });
  try {
    const result = await runDateCascade({
      boardId: parseInt(boardId),
      itemId: parseInt(itemId),
      anchorColumnId: parseInt(anchorColumnId),
      anchorDate,
      direction,
      userId: req.user?.id,
      ruleId: ruleId ? parseInt(ruleId) : null,
      forceOverwrite: !!forceOverwrite,
    });
    res.json(result);
  } catch (err) {
    console.error('[DateCascade] manual trigger:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Logs ──────────────────────────────────────────────────────────────────────

// GET /api/date-cascade/logs/:boardId/:itemId — last 20 for a specific item
router.get('/logs/:boardId/:itemId', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT al.*, c.title AS anchor_column_title
       FROM automation_logs al
       LEFT JOIN columns c ON c.id = al.anchor_column_id
       WHERE al.board_id=$1 AND al.item_id=$2
       ORDER BY al.created_at DESC LIMIT 20`,
      [req.params.boardId, req.params.itemId]
    );
    res.json(rows);
  } catch (err) {
    console.error('[DateCascade] item logs:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/date-cascade/logs/:boardId — last 20 board-wide cascade events
router.get('/logs/:boardId', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT al.*, i.name AS item_name, c.title AS anchor_column_title
       FROM automation_logs al
       LEFT JOIN items i ON i.id = al.item_id
       LEFT JOIN columns c ON c.id = al.anchor_column_id
       WHERE al.board_id=$1
       ORDER BY al.created_at DESC LIMIT 20`,
      [req.params.boardId]
    );
    res.json(rows);
  } catch (err) {
    console.error('[DateCascade] board logs:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/date-cascade/meta/override — clear auto-cascade flag for one cell
// Allows free manual editing of a cascade-set cell
router.patch('/meta/override', requireAuth, async (req, res) => {
  const { item_id, column_id } = req.body;
  if (!item_id || !column_id) return res.status(400).json({ error: 'item_id and column_id are required' });
  try {
    await pool.query(
      `INSERT INTO column_value_meta (item_id, column_id, is_auto_cascaded)
       VALUES ($1,$2,false)
       ON CONFLICT (item_id, column_id) DO UPDATE SET is_auto_cascaded=false`,
      [item_id, column_id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[DateCascade] meta override:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
