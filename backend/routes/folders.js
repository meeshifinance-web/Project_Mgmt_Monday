const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole, isSuperAdmin } = require('../middleware/auth');

const canWrite = [requireAuth, requireRole('admin', 'manager')];

// Hierarchy rule: at most 2 levels (top folder → subfolder). Subfolders cannot
// themselves contain subfolders. Enforced in code rather than via CHECK so
// the constraint can be relaxed later without a schema migration.
const MAX_DEPTH = 2; // 1 = root, 2 = subfolder

// Look up a folder's depth (1 = top-level, 2 = subfolder).
async function folderDepth(client, folderId) {
  if (!folderId) return 0;
  const r = await client.query(
    'SELECT parent_folder_id FROM board_folders WHERE id=$1 AND (is_deleted IS NULL OR is_deleted = false)',
    [folderId]
  );
  if (!r.rows.length) return null; // does not exist
  return r.rows[0].parent_folder_id == null ? 1 : 2;
}

// GET /api/folders — list folders visible to the current user.
//
// Visibility (non-admin):
//   1. Folders the user created (so empty folders the creator just made are visible),
//   2. Folders that contain at least one board the user is a member of, OR
//   3. Folders whose subfolder contains at least one board the user is a member of.
//
// Always include parent_folder_id so the frontend can render the tree.
router.get('/', requireAuth, async (req, res) => {
  try {
    let rows;
    if (isSuperAdmin(req.user)) {
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
             -- A board is "visible" to the user when it's org-wide (public) OR
             -- they're a member. Folders containing any visible board must show,
             -- otherwise a public board nested in a folder the user doesn't own
             -- becomes invisible in the sidebar.
             OR EXISTS (
               SELECT 1 FROM boards b
               LEFT JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = $1
               WHERE b.folder_id = f.id
                 AND (b.is_deleted IS NULL OR b.is_deleted = false)
                 AND (b.visibility = 'org_wide' OR bm.user_id IS NOT NULL)
             )
             -- Also surface a parent folder if any of its subfolders contain
             -- a board the user can see. Without this, a subfolder appears
             -- in the tree with no parent and the UI gets confused.
             OR EXISTS (
               SELECT 1 FROM board_folders sf
               JOIN boards b ON b.folder_id = sf.id
               LEFT JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = $1
               WHERE sf.parent_folder_id = f.id
                 AND (sf.is_deleted IS NULL OR sf.is_deleted = false)
                 AND (b.is_deleted IS NULL OR b.is_deleted = false)
                 AND (b.visibility = 'org_wide' OR bm.user_id IS NOT NULL)
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

// POST /api/folders — create folder. Optional parent_folder_id makes it a subfolder.
router.post('/', ...canWrite, async (req, res) => {
  const { name, parent_folder_id } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name required' });

  const client = await pool.connect();
  try {
    // Validate parent (must exist and not already be a subfolder — depth cap = 2)
    if (parent_folder_id != null) {
      const parentDepth = await folderDepth(client, parent_folder_id);
      if (parentDepth === null) return res.status(400).json({ error: 'Parent folder not found' });
      if (parentDepth >= MAX_DEPTH) {
        return res.status(400).json({
          error: 'Subfolders cannot contain further subfolders (max depth 2 levels).',
        });
      }
    }

    const posRes = await client.query('SELECT COALESCE(MAX(position),0)+1 AS pos FROM board_folders');
    const { rows } = await client.query(
      `INSERT INTO board_folders (name, position, created_by, parent_folder_id)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [name.trim(), posRes.rows[0].pos, req.user.id, parent_folder_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
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

// PATCH /api/folders/:id/parent — move a folder under another folder, or to top level.
//
// Body: { parent_folder_id: number | null }
//
// Rules enforced:
//   - Cannot make a folder its own parent.
//   - The new parent must currently be top-level (otherwise we'd create a
//     3-deep tree).
//   - If the folder being moved already has subfolders, it cannot itself be
//     moved under another folder (otherwise its children become 3-deep).
router.patch('/:id/parent', ...canWrite, async (req, res) => {
  const folderId = parseInt(req.params.id);
  const newParentId = req.body.parent_folder_id == null ? null : parseInt(req.body.parent_folder_id);
  if (Number.isNaN(folderId)) return res.status(400).json({ error: 'Invalid folder id' });

  const client = await pool.connect();
  try {
    if (newParentId === folderId) {
      return res.status(400).json({ error: 'A folder cannot be moved into itself.' });
    }

    if (newParentId !== null) {
      const parentDepth = await folderDepth(client, newParentId);
      if (parentDepth === null) return res.status(400).json({ error: 'Target folder not found' });
      if (parentDepth >= MAX_DEPTH) {
        return res.status(400).json({
          error: 'Cannot move into a subfolder — only top-level folders can hold subfolders.',
        });
      }

      // If this folder has its own subfolders, moving it under another folder
      // would push those subfolders to depth 3.
      const childRes = await client.query(
        `SELECT 1 FROM board_folders
          WHERE parent_folder_id=$1 AND (is_deleted IS NULL OR is_deleted = false) LIMIT 1`,
        [folderId]
      );
      if (childRes.rows.length) {
        return res.status(400).json({
          error: "This folder has subfolders, so it can't be made a subfolder itself.",
        });
      }
    }

    const { rows } = await client.query(
      'UPDATE board_folders SET parent_folder_id=$1 WHERE id=$2 RETURNING *',
      [newParentId, folderId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Folder not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// DELETE /api/folders/:id — soft-delete folder.
//   - Boards inside become unfiled (folder_id = NULL).
//   - Subfolders are promoted to top-level (parent_folder_id = NULL) so they
//     and their boards aren't lost in the tree.
router.delete('/:id', ...canWrite, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Snapshot which boards were directly inside this folder
    const boardsRes = await client.query(
      'SELECT id FROM boards WHERE folder_id=$1 AND (is_deleted IS NULL OR is_deleted = false)',
      [req.params.id]
    );
    const boardIds = boardsRes.rows.map(r => r.id);

    // Unfile the boards
    await client.query('UPDATE boards SET folder_id=NULL WHERE folder_id=$1', [req.params.id]);

    // Promote any subfolders up to top-level so they don't become orphans
    const promotedRes = await client.query(
      `UPDATE board_folders SET parent_folder_id=NULL
        WHERE parent_folder_id=$1 AND (is_deleted IS NULL OR is_deleted = false)
        RETURNING id`,
      [req.params.id]
    );
    const promotedFolderIds = promotedRes.rows.map(r => r.id);

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
    res.json({ success: true, unfiledBoardIds: boardIds, promotedFolderIds });
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
