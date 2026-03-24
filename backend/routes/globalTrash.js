/**
 * globalTrash.js
 *
 * Manages the global trash for boards and folders.
 * Both types are soft-deleted (is_deleted = true) and permanently removed after 15 days.
 *
 * GET  /api/global-trash              — list all trashed boards + folders (admin only)
 * POST /api/global-trash/boards/:id/restore   — restore a trashed board
 * POST /api/global-trash/folders/:id/restore  — restore a trashed folder + re-file boards
 * DELETE /api/global-trash/boards/:id          — permanently delete a board
 * DELETE /api/global-trash/folders/:id         — permanently delete a folder
 * DELETE /api/global-trash/empty               — permanently delete everything in trash
 */

const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const adminOnly = [requireAuth, requireRole('admin')];

// ── helpers ───────────────────────────────────────────────────────────────────
const DAYS_REMAINING = `CEIL(EXTRACT(EPOCH FROM (deleted_at + INTERVAL '15 days' - NOW())) / 86400)`;

// ── GET /api/global-trash ─────────────────────────────────────────────────────
router.get('/', ...adminOnly, async (req, res) => {
  try {
    const [boardsRes, foldersRes] = await Promise.all([
      pool.query(
        `SELECT id, name, description, visibility, folder_id,
                deleted_at, deleted_by_user_id, deleted_by_user_name,
                ${DAYS_REMAINING} AS days_left
         FROM boards
         WHERE is_deleted = true AND deleted_at > NOW() - INTERVAL '15 days'
         ORDER BY deleted_at DESC`
      ),
      pool.query(
        `SELECT id, name, board_ids_snapshot,
                deleted_at, deleted_by_user_id, deleted_by_user_name,
                ${DAYS_REMAINING} AS days_left
         FROM board_folders
         WHERE is_deleted = true AND deleted_at > NOW() - INTERVAL '15 days'
         ORDER BY deleted_at DESC`
      ),
    ]);
    res.json({ boards: boardsRes.rows, folders: foldersRes.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/global-trash/boards/:id/restore ─────────────────────────────────
router.post('/boards/:id/restore', ...adminOnly, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE boards
       SET is_deleted = false, deleted_at = NULL,
           deleted_by_user_id = NULL, deleted_by_user_name = NULL
       WHERE id = $1 AND is_deleted = true
       RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Board not found in trash' });
    res.json({ board: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/global-trash/folders/:id/restore ───────────────────────────────
router.post('/folders/:id/restore', ...adminOnly, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const folderRes = await client.query(
      `UPDATE board_folders
       SET is_deleted = false, deleted_at = NULL,
           deleted_by_user_id = NULL, deleted_by_user_name = NULL
       WHERE id = $1 AND is_deleted = true
       RETURNING *`,
      [req.params.id]
    );
    if (!folderRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Folder not found in trash' });
    }
    const folder = folderRes.rows[0];

    // Re-file boards that were in this folder when it was deleted,
    // but only if they're still active (not deleted) and currently unfiled
    const snapshot = Array.isArray(folder.board_ids_snapshot)
      ? folder.board_ids_snapshot
      : (typeof folder.board_ids_snapshot === 'string'
          ? JSON.parse(folder.board_ids_snapshot)
          : []);

    let refiledBoardIds = [];
    if (snapshot.length) {
      const refileRes = await client.query(
        `UPDATE boards
         SET folder_id = $1
         WHERE id = ANY($2::int[])
           AND (is_deleted IS NULL OR is_deleted = false)
           AND folder_id IS NULL
         RETURNING id`,
        [folder.id, snapshot]
      );
      refiledBoardIds = refileRes.rows.map(r => r.id);
    }

    await client.query('COMMIT');
    res.json({ folder, refiledBoardIds });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── DELETE /api/global-trash/boards/:id — permanent delete ────────────────────
router.delete('/boards/:id', ...adminOnly, async (req, res) => {
  try {
    // CASCADE on boards table removes groups, items, columns, etc.
    await pool.query('DELETE FROM boards WHERE id=$1 AND is_deleted = true', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/global-trash/folders/:id — permanent delete ──────────────────
router.delete('/folders/:id', ...adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM board_folders WHERE id=$1 AND is_deleted = true', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/global-trash/empty — nuke everything ─────────────────────────
router.delete('/empty', ...adminOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM boards        WHERE is_deleted = true');
    await pool.query('DELETE FROM board_folders WHERE is_deleted = true');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
