const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole, canAccessBoard } = require('../middleware/auth');

const canWrite = [requireAuth, requireRole('admin', 'manager')];

// ── POST / — create column ────────────────────────────────────────────────────
const { COLUMN_TYPES } = require('../services/columnValidate');

router.post('/', ...canWrite, async (req, res) => {
  const { board_id, title, type, settings } = req.body;
  if (!board_id || !title || !String(title).trim())
    return res.status(400).json({ error: 'board_id and a non-empty title are required' });
  if (type && !COLUMN_TYPES.has(type))
    return res.status(400).json({ error: `Unknown column type: ${type}` });

  try {
    if (!(await canAccessBoard(board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const posRes = await client.query('SELECT COALESCE(MAX(position),0)+1 AS pos FROM columns WHERE board_id=$1', [board_id]);
    const colRes = await client.query(
      'INSERT INTO columns (board_id, title, type, settings, position) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [board_id, title, type || 'text', JSON.stringify(settings || {}), posRes.rows[0].pos]
    );
    const newCol = colRes.rows[0];

    // Create empty column_values for all existing items in this board
    await client.query(
      `INSERT INTO column_values (item_id, column_id, value)
       SELECT i.id, $1, ''
       FROM items i
       JOIN groups g ON g.id = i.group_id
       WHERE g.board_id = $2
       ON CONFLICT DO NOTHING`,
      [newCol.id, board_id]
    );

    // ── Two-way (reciprocal) Connect Boards ──────────────────────────────────
    // monday-style: linking board A → B also creates a matching connect column
    // on B → A, so the relationship is visible and editable from both sides.
    // Skipped for same-board links, when twoWay is off, or when the creator
    // lacks access to the target board.
    if (newCol.type === 'connect_boards') {
      const st = settings || {};
      const targetBoardId = parseInt(st.boardId, 10);
      const twoWay = st.twoWay !== false;
      if (twoWay && Number.isInteger(targetBoardId) && targetBoardId !== parseInt(board_id, 10)
          && await canAccessBoard(targetBoardId, req.user, client)) {
        const srcName = (await client.query('SELECT name FROM boards WHERE id=$1', [board_id])).rows[0]?.name || 'Linked';
        const posR = await client.query('SELECT COALESCE(MAX(position),0)+1 AS pos FROM columns WHERE board_id=$1', [targetBoardId]);
        const recipSettings = { boardId: parseInt(board_id, 10), allowMultiple: true, reciprocalColumnId: newCol.id, isReciprocal: true, twoWay: true };
        const recipR = await client.query(
          'INSERT INTO columns (board_id, title, type, settings, position) VALUES ($1,$2,$3,$4,$5) RETURNING *',
          [targetBoardId, `🔗 ${srcName}`, 'connect_boards', JSON.stringify(recipSettings), posR.rows[0].pos]
        );
        const recipCol = recipR.rows[0];
        await client.query(
          `INSERT INTO column_values (item_id, column_id, value)
             SELECT i.id, $1, '' FROM items i JOIN groups g ON g.id = i.group_id
            WHERE g.board_id = $2 ON CONFLICT DO NOTHING`,
          [recipCol.id, targetBoardId]
        );
        const linkedSettings = { ...st, reciprocalColumnId: recipCol.id, twoWay: true };
        await client.query('UPDATE columns SET settings=$1 WHERE id=$2', [JSON.stringify(linkedSettings), newCol.id]);
        newCol.settings = linkedSettings;
      }
    }

    await client.query('COMMIT');
    res.status(201).json(newCol);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ── PUT /:id — update column title / settings / type ─────────────────────────
router.put('/:id', ...canWrite, async (req, res) => {
  const { title, settings, type } = req.body;
  if (title !== undefined && !String(title).trim())
    return res.status(400).json({ error: 'Column title cannot be empty' });
  if (type !== undefined && !COLUMN_TYPES.has(type))
    return res.status(400).json({ error: `Unknown column type: ${type}` });
  try {
    const colRes = await pool.query('SELECT board_id FROM columns WHERE id=$1', [req.params.id]);
    if (!colRes.rows.length) return res.status(404).json({ error: 'Column not found' });

    if (!(await canAccessBoard(colRes.rows[0].board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    // Build update dynamically so callers can omit fields they don't want changed
    const fields = [];
    const params = [];
    if (title    !== undefined) { fields.push(`title=$${params.push(title)}`); }
    if (settings !== undefined) { fields.push(`settings=$${params.push(JSON.stringify(settings || {}))}`); }
    if (type     !== undefined) { fields.push(`type=$${params.push(type)}`); }
    if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(req.params.id);

    const { rows } = await pool.query(
      `UPDATE columns SET ${fields.join(', ')} WHERE id=$${params.length} RETURNING *`,
      params
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /:id — delete column ───────────────────────────────────────────────
router.delete('/:id', ...canWrite, async (req, res) => {
  try {
    // Resolve board so we can verify membership
    const colRes = await pool.query('SELECT board_id, type, settings FROM columns WHERE id=$1', [req.params.id]);
    if (!colRes.rows.length) return res.status(404).json({ error: 'Column not found' });

    if (!(await canAccessBoard(colRes.rows[0].board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    // Two-way connect: also remove the reciprocal column on the other board.
    const col = colRes.rows[0];
    if (col.type === 'connect_boards') {
      const st = typeof col.settings === 'string' ? JSON.parse(col.settings || '{}') : (col.settings || {});
      if (st.reciprocalColumnId) {
        await pool.query('DELETE FROM columns WHERE id=$1', [st.reciprocalColumnId]).catch(() => {});
      }
    }

    await pool.query('DELETE FROM columns WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /:id/duplicate — duplicate a column (type + settings + all values) ───
router.post('/:id/duplicate', ...canWrite, async (req, res) => {
  const client = await pool.connect();
  try {
    const srcRes = await client.query('SELECT * FROM columns WHERE id=$1', [req.params.id]);
    if (!srcRes.rows.length) return res.status(404).json({ error: 'Column not found' });
    const src = srcRes.rows[0];

    if (!(await canAccessBoard(src.board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    await client.query('BEGIN');
    // Insert right after the source column, shifting the rest right.
    await client.query('UPDATE columns SET position=position+1 WHERE board_id=$1 AND position>$2', [src.board_id, src.position]);

    // Don't carry over cross-board reciprocal wiring into a copy.
    const settings = (typeof src.settings === 'string' ? JSON.parse(src.settings || '{}') : (src.settings || {}));
    delete settings.reciprocalColumnId; delete settings.isReciprocal;

    const newColRes = await client.query(
      'INSERT INTO columns (board_id,title,type,settings,position) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [src.board_id, `${src.title} (copy)`, src.type, JSON.stringify(settings), src.position + 1]
    );
    const newCol = newColRes.rows[0];

    // Copy every cell value to the new column.
    await client.query(
      `INSERT INTO column_values (item_id, column_id, value)
         SELECT cv.item_id, $1, cv.value FROM column_values cv WHERE cv.column_id=$2`,
      [newCol.id, src.id]
    );
    await client.query('COMMIT');

    const valsRes = await pool.query('SELECT item_id, value FROM column_values WHERE column_id=$1', [newCol.id]);
    const values = {};
    for (const v of valsRes.rows) values[v.item_id] = v.value;
    res.status(201).json({ column: newCol, values });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ── PATCH /reorder — reorder columns by updating positions ────────────────────
router.patch('/reorder', ...canWrite, async (req, res) => {
  const { board_id, ordered_ids } = req.body;
  if (!board_id || !Array.isArray(ordered_ids)) return res.status(400).json({ error: 'board_id and ordered_ids required' });

  try {
    if (!(await canAccessBoard(board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < ordered_ids.length; i++) {
      await client.query('UPDATE columns SET position=$1 WHERE id=$2 AND board_id=$3', [i, ordered_ids[i], board_id]);
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
