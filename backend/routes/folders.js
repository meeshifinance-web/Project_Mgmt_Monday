const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const canWrite = [requireAuth, requireRole('admin', 'manager')];

// GET /api/folders — list folders visible to the current user.
// Admins see all folders. Everyone else sees only:
//   1. Folders they created (so creators can manage their own empty folders), OR
//   2. Folders that contain at least one board they are a member of.
router.get('/', requireAuth, async (req, res) => {
  try {
    let rows;
    if (req.user.role === 'admin') {
      ({ rows } = await pool.query(
        'SELECT * FROM board_folders WHERE (is_deleted IS NULL OR is_deleted = false) ORDER BY position, name'
      ));
    } else {
      ({ rows } = await pool.query(
        `SELECT DISTINCT f.*
         FROM board_folders f
         WHERE (f.is_deleted IS NULL OR f.is_deleted = false)
           AND (
             f.created_by = $1
             OR EXISTS (
               SELECT 1 FROM boards b
               JOIN board_members bm ON bm.board_id = b.id
               WHERE b.folder_id = f.id
                 AND bm.user_id = $1
                 AND (b.is_deleted IS NULL OR b.is_deleted = false)
             )
           )
         ORDER BY f.position, f.name`,
        [req.user.id]
      ));
    }
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/folders — create folder
router.post('/', ...canWrite, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  try {
    const posRes = await pool.query('SELECT COALESCE(MAX(position),0)+1 AS pos FROM board_folders');
    const { rows } = await pool.query(
      'INSERT INTO board_folders (name, position, created_by) VALUES ($1,$2,$3) RETURNING *',
      [name.trim(), posRes.rows[0].pos, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/folders/:id — rename folder
router.put('/:id', ...canWrite, async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
  try {
    const { rows } = await pool.query(
      'UPDATE board_folders SET name=$1 WHERE id=$2 RETURNING *',
      [name.trim(), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Folder not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/folders/:id — soft-delete folder; boards inside become unfiled
router.delete('/:id', ...canWrite, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Snapshot which boards were in this folder
    const boardsRes = await client.query(
      'SELECT id FROM boards WHERE folder_id=$1 AND (is_deleted IS NULL OR is_deleted = false)',
      [req.params.id]
    );
    const boardIds = boardsRes.rows.map(r => r.id);

    // Unfile the boards
    await client.query('UPDATE boards SET folder_id=NULL WHERE folder_id=$1', [req.params.id]);

    // Soft-delete the folder, snapshot board IDs for potential restore
    const { rows } = await client.query(
      `UPDATE board_folders
       SET is_deleted = true, deleted_at = NOW(),
           deleted_by_user_id = $1, deleted_by_user_name = $2,
           board_ids_snapshot = $3
       WHERE id = $4 AND (is_deleted IS NULL OR is_deleted = false)
       RETURNING id`,
      [req.user.id, req.user.name, JSON.stringify(boardIds), req.params.id]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Folder not found' });
    }
    await client.query('COMMIT');
    res.json({ success: true, unfiledBoardIds: boardIds });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// PATCH /api/folders/board/:boardId — assign or remove a board from a folder
router.patch('/board/:boardId', ...canWrite, async (req, res) => {
  const folder_id = req.body.folder_id ?? null;
  try {
    const { rows } = await pool.query(
      'UPDATE boards SET folder_id=$1 WHERE id=$2 RETURNING id, folder_id',
      [folder_id, req.params.boardId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Board not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
