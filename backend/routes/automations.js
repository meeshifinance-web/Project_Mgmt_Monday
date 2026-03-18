const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const canWrite = [requireAuth, requireRole('admin', 'manager')];

router.get('/board/:boardId', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM automations WHERE board_id=$1 ORDER BY created_at DESC',
      [req.params.boardId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', ...canWrite, async (req, res) => {
  const { board_id, name, trigger_type, trigger_config, action_type, action_config } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO automations (board_id, name, trigger_type, trigger_config, action_type, action_config)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [board_id, name, trigger_type, JSON.stringify(trigger_config), action_type, JSON.stringify(action_config)]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', ...canWrite, async (req, res) => {
  const { name, trigger_type, trigger_config, action_type, action_config, enabled } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE automations SET name=$1, trigger_type=$2, trigger_config=$3, action_type=$4, action_config=$5, enabled=$6
       WHERE id=$7 RETURNING *`,
      [name, trigger_type, JSON.stringify(trigger_config), action_type, JSON.stringify(action_config), enabled, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', ...canWrite, async (req, res) => {
  try {
    await pool.query('DELETE FROM automations WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
