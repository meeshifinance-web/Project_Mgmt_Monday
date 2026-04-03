const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole, canAccessBoard } = require('../middleware/auth');
const { requireScope } = require('../middleware/apiAuth');

const canWrite = [requireAuth, requireRole('admin', 'manager')];

// ── Helpers ───────────────────────────────────────────────────────────────────

// Parse multi-owner value — handles JSON array or legacy single-name string
function parseOwners(val) {
  if (!val) return [];
  try { const p = JSON.parse(val); return Array.isArray(p) ? p : p ? [String(p)] : []; }
  catch { return val.trim() ? [val.trim()] : []; }
}

// Sync member options on all person-type columns.
// Returns the array of updated column objects { id, settings } for the frontend to apply.
async function syncOwnerColumn(client, boardId) {
  const colRes = await client.query(
    `SELECT id, settings FROM columns WHERE board_id=$1 AND type='person'`,
    [boardId]
  );
  if (!colRes.rows.length) return [];

  const membersRes = await client.query(
    `SELECT u.name FROM board_members bm
     JOIN users u ON u.id = bm.user_id
     WHERE bm.board_id = $1 ORDER BY bm.added_at`,
    [boardId]
  );
  const names = membersRes.rows.map(r => r.name);

  const updated = [];
  for (const col of colRes.rows) {
    const settings = { ...(col.settings || {}), options: names };
    await client.query(
      'UPDATE columns SET settings=$1 WHERE id=$2',
      [JSON.stringify(settings), col.id]
    );
    updated.push({ id: col.id, settings });
  }
  return updated;
}

const DEFAULT_STATUS_OPTIONS = [
  { label: 'Not Started', color: '#c4c4c4' },
  { label: 'In Progress', color: '#fdab3d' },
  { label: 'Done',        color: '#00c875' },
  { label: 'Stuck',       color: '#e2445c' },
  { label: 'Review',      color: '#a25ddc' },
];

// ── GET all accessible boards ─────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.* FROM boards b
       WHERE (b.is_deleted IS NULL OR b.is_deleted = false)
         AND ($1 = 'admin'
          OR EXISTS (
            SELECT 1 FROM board_members bm
            WHERE bm.board_id = b.id AND bm.user_id = $2
          ))
       ORDER BY b.created_at DESC`,
      [req.user.role, req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET full board ────────────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const boardRes = await pool.query('SELECT * FROM boards WHERE id=$1 AND (is_deleted IS NULL OR is_deleted = false)', [id]);
    if (!boardRes.rows.length) return res.status(404).json({ error: 'Board not found' });

    const board = boardRes.rows[0];
    if (!(await canAccessBoard(id, req.user, pool)))
      return res.status(403).json({ error: 'You do not have access to this board' });

    const colsRes = await pool.query('SELECT * FROM columns WHERE board_id=$1 ORDER BY position', [id]);
    board.columns = colsRes.rows;

    const groupsRes = await pool.query('SELECT * FROM groups WHERE board_id=$1 ORDER BY position', [id]);
    for (const group of groupsRes.rows) {
      const itemsRes = await pool.query(
        'SELECT * FROM items WHERE group_id=$1 AND parent_item_id IS NULL ORDER BY position',
        [group.id]
      );
      for (const item of itemsRes.rows) {
        const valsRes = await pool.query('SELECT * FROM column_values WHERE item_id=$1', [item.id]);
        item.values = {};
        for (const v of valsRes.rows) item.values[v.column_id] = v.value;
        // Load subitems for each item
        const subRes = await pool.query(
          'SELECT * FROM items WHERE parent_item_id=$1 ORDER BY position',
          [item.id]
        );
        for (const sub of subRes.rows) {
          const svRes = await pool.query('SELECT * FROM column_values WHERE item_id=$1', [sub.id]);
          sub.values = {};
          for (const sv of svRes.rows) sub.values[sv.column_id] = sv.value;
          sub.subitems = [];
        }
        item.subitems = subRes.rows;
      }
      group.items = itemsRes.rows;
    }

    // ── Item-level visibility filter ────────────────────────────────────────
    // Admins and managers see everything.
    // Regular members only see items where EVERY active owner column is either
    // empty (visible to all) OR contains their name.
    if (req.user.role !== 'admin' && req.user.role !== 'manager') {
      const ownerCols = colsRes.rows.filter(c => {
        const s = typeof c.settings === 'string' ? JSON.parse(c.settings) : (c.settings || {});
        return c.type === 'person' && s.isOwnerColumn === true;
      });

      if (ownerCols.length > 0) {
        for (const group of groupsRes.rows) {
          group.items = group.items.filter(item => {
            // Item is visible unless an owner column has owners set that don't include this user
            for (const col of ownerCols) {
              const raw = item.values[col.id];
              const owners = parseOwners(raw);
              // If owners are set and this user is NOT in the list → hide item
              if (owners.length > 0 && !owners.includes(req.user.name)) return false;
            }
            return true;
          });
        }
      }
    }
    // ── End visibility filter ───────────────────────────────────────────────

    board.groups = groupsRes.rows;

    const membersRes = await pool.query(
      `SELECT u.id, u.name, u.email, u.avatar_url, u.role, bm.added_at
       FROM board_members bm JOIN users u ON u.id = bm.user_id
       WHERE bm.board_id = $1 ORDER BY bm.added_at`,
      [id]
    );
    board.members = membersRes.rows;

    res.json(board);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST create board — with default group, columns and items ─────────────────
router.post('/', ...canWrite, async (req, res) => {
  const { name, description, visibility = 'private' } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create board
    const boardRes = await client.query(
      'INSERT INTO boards (name, description, visibility, created_by) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, description || '', visibility, req.user.id]
    );
    const board = boardRes.rows[0];

    // 2. Add creator as first member
    await client.query(
      'INSERT INTO board_members (board_id, user_id, added_by) VALUES ($1,$2,$2) ON CONFLICT DO NOTHING',
      [board.id, req.user.id]
    );

    // 3. Get creator name (used in Owner column options for private boards)
    const creatorRes = await client.query('SELECT name FROM users WHERE id=$1', [req.user.id]);
    const creatorName = creatorRes.rows[0]?.name || '';

    // 4. Create three default columns: Status | Owner | Due Date
    const columnsSpec = [
      {
        title: 'Status', type: 'status', position: 0,
        settings: { options: DEFAULT_STATUS_OPTIONS },
      },
      {
        title: 'Owner',
        type: 'person',
        position: 1,
        settings: { options: [creatorName] },
      },
      { title: 'Due Date', type: 'date', position: 2, settings: {} },
    ];

    const createdCols = [];
    for (const spec of columnsSpec) {
      const r = await client.query(
        'INSERT INTO columns (board_id, title, type, settings, position) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [board.id, spec.title, spec.type, JSON.stringify(spec.settings), spec.position]
      );
      createdCols.push(r.rows[0]);
    }

    // 5. Create default group
    const groupRes = await client.query(
      'INSERT INTO groups (board_id, name, color, position) VALUES ($1,$2,$3,$4) RETURNING *',
      [board.id, 'Group 1', '#0073ea', 0]
    );
    const group = groupRes.rows[0];

    // 6. Create 3 default items with preset status values
    const DEFAULT_ITEM_STATUSES = ['In Progress', 'Done', 'Stuck'];
    const statusCol = createdCols.find(c => c.title === 'Status');
    const createdItems = [];
    for (let i = 0; i < 3; i++) {
      const itemRes = await client.query(
        'INSERT INTO items (group_id, name, position) VALUES ($1,$2,$3) RETURNING *',
        [group.id, `Item ${i + 1}`, i]
      );
      const item = itemRes.rows[0];
      item.values = {};

      for (const col of createdCols) {
        const val = (col.id === statusCol?.id) ? DEFAULT_ITEM_STATUSES[i] : '';
        await client.query(
          'INSERT INTO column_values (item_id, column_id, value) VALUES ($1,$2,$3)',
          [item.id, col.id, val]
        );
        item.values[col.id] = val;
      }
      createdItems.push(item);
    }

    await client.query('COMMIT');

    // Build full response so the frontend can display immediately without a reload
    board.columns = createdCols;
    board.groups = [{ ...group, items: createdItems }];
    board.members = [{ id: req.user.id, name: creatorName, added_at: new Date().toISOString() }];

    res.status(201).json(board);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ── PUT update board ──────────────────────────────────────────────────────────
router.put('/:id', ...canWrite, async (req, res) => {
  const { id } = req.params;
  const { name, description, visibility, item_name } = req.body;
  try {
    if (!(await canAccessBoard(id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    const { rows } = await pool.query(
      'UPDATE boards SET name=$1, description=$2, visibility=$3, item_name=$4 WHERE id=$5 RETURNING *',
      [name, description ?? '', visibility ?? 'private', item_name ?? 'Item', id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Board not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── PATCH board email-settings — per-board sender address ─────────────────────
router.patch('/:id/email-settings', ...canWrite, async (req, res) => {
  const { email_from } = req.body;
  try {
    if (!(await canAccessBoard(req.params.id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    const { rows } = await pool.query(
      'UPDATE boards SET email_from=$1 WHERE id=$2 RETURNING id, email_from',
      [email_from || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Board not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE board — soft-delete (moves to global trash, 15-day retention) ──────
router.delete('/:id', requireAuth, requireScope('full'), requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE boards
       SET is_deleted = true, deleted_at = NOW(),
           deleted_by_user_id = $1, deleted_by_user_name = $2
       WHERE id = $3 AND (is_deleted IS NULL OR is_deleted = false)
       RETURNING id`,
      [req.user.id, req.user.name, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Board not found' });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST clone board ──────────────────────────────────────────────────────────
router.post('/:id/clone', requireAuth, async (req, res) => {
  const { name, includeItems = true, includeColumns = true, includeGroups = true } = req.body;
  const sourceId = req.params.id;
  const client = await pool.connect();
  try {
    // 1. Fetch source board and verify access
    const srcRes = await client.query(
      'SELECT * FROM boards WHERE id=$1 AND (is_deleted IS NULL OR is_deleted=false)',
      [sourceId]
    );
    if (!srcRes.rows.length) return res.status(404).json({ error: 'Board not found' });
    if (!(await canAccessBoard(sourceId, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });
    const src = srcRes.rows[0];

    await client.query('BEGIN');

    // 2. Create new board
    const newBoardRes = await client.query(
      'INSERT INTO boards (name, description, visibility, folder_id, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [name || `Copy of ${src.name}`, src.description || '', src.visibility, src.folder_id, req.user.id]
    );
    const newBoard = newBoardRes.rows[0];

    // Add creator as member
    await client.query(
      'INSERT INTO board_members (board_id, user_id, added_by) VALUES ($1,$2,$2) ON CONFLICT DO NOTHING',
      [newBoard.id, req.user.id]
    );

    // 3. Copy columns and build columnIdMap
    const columnIdMap = {};
    newBoard.columns = [];
    if (includeColumns) {
      const colsRes = await client.query(
        'SELECT * FROM columns WHERE board_id=$1 ORDER BY position', [sourceId]
      );
      for (const col of colsRes.rows) {
        const r = await client.query(
          'INSERT INTO columns (board_id, title, type, settings, position) VALUES ($1,$2,$3,$4,$5) RETURNING *',
          [newBoard.id, col.title, col.type, JSON.stringify(col.settings || {}), col.position]
        );
        columnIdMap[col.id] = r.rows[0].id;
        newBoard.columns.push(r.rows[0]);
      }
    }

    // 4. Copy groups and build groupIdMap
    const groupIdMap = {};
    newBoard.groups = [];
    if (includeGroups) {
      const grpsRes = await client.query(
        'SELECT * FROM groups WHERE board_id=$1 ORDER BY position', [sourceId]
      );
      for (const grp of grpsRes.rows) {
        const r = await client.query(
          'INSERT INTO groups (board_id, name, color, position) VALUES ($1,$2,$3,$4) RETURNING *',
          [newBoard.id, grp.name, grp.color, grp.position]
        );
        groupIdMap[grp.id] = r.rows[0].id;
        newBoard.groups.push({ ...r.rows[0], items: [] });
      }

      // 5. Copy items (only if both groups and columns are included)
      if (includeItems && includeColumns) {
        const itemsRes = await client.query(
          `SELECT * FROM items
           WHERE group_id = ANY(SELECT id FROM groups WHERE board_id=$1)
             AND parent_item_id IS NULL
           ORDER BY position`,
          [sourceId]
        );
        for (const item of itemsRes.rows) {
          const newGroupId = groupIdMap[item.group_id];
          if (!newGroupId) continue;
          const newItemRes = await client.query(
            'INSERT INTO items (group_id, name, position) VALUES ($1,$2,$3) RETURNING *',
            [newGroupId, item.name, item.position]
          );
          const newItem = { ...newItemRes.rows[0], values: {} };

          // Copy column values — skip person columns (no assignees)
          const valsRes = await client.query(
            'SELECT cv.*, c.type FROM column_values cv JOIN columns c ON c.id=cv.column_id WHERE cv.item_id=$1',
            [item.id]
          );
          for (const val of valsRes.rows) {
            const newColId = columnIdMap[val.column_id];
            if (!newColId) continue;
            if (val.type === 'person') continue; // do not copy assignees
            await client.query(
              'INSERT INTO column_values (item_id, column_id, value) VALUES ($1,$2,$3)',
              [newItem.id, newColId, val.value]
            );
            newItem.values[newColId] = val.value;
          }

          const grpObj = newBoard.groups.find(g => g.id === newGroupId);
          if (grpObj) grpObj.items.push(newItem);
        }
      }
    }

    const creatorRes = await client.query('SELECT name FROM users WHERE id=$1', [req.user.id]);
    newBoard.members = [{ id: req.user.id, name: creatorRes.rows[0]?.name || req.user.name }];

    await client.query('COMMIT');
    res.status(201).json({ success: true, board: newBoard });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ── GET board members ─────────────────────────────────────────────────────────
router.get('/:id/members', requireAuth, async (req, res) => {
  if (!(await canAccessBoard(req.params.id, req.user, pool)))
    return res.status(403).json({ error: 'Access denied' });
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.name, u.email, u.avatar_url, u.role, bm.added_at
       FROM board_members bm JOIN users u ON u.id = bm.user_id
       WHERE bm.board_id = $1 ORDER BY bm.added_at`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST add member — also syncs person columns ───────────────────────────────
router.post('/:id/members', ...canWrite, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    if (!(await canAccessBoard(req.params.id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }

  const client = await pool.connect();
  try {
    const userRes = await client.query(
      'SELECT id, name, email, avatar_url, role FROM users WHERE email=$1 AND is_active=true',
      [email.toLowerCase()]
    );
    if (!userRes.rows.length)
      return res.status(404).json({ error: 'No active user found with that email' });

    const invitee = userRes.rows[0];
    await client.query(
      'INSERT INTO board_members (board_id, user_id, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [req.params.id, invitee.id, req.user.id]
    );

    // Sync member options on all person columns
    const updatedColumns = await syncOwnerColumn(client, req.params.id);

    res.status(201).json({ member: invitee, updatedColumns });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// ── DELETE remove member — also syncs person columns ─────────────────────────
router.delete('/:id/members/:userId', ...canWrite, async (req, res) => {
  try {
    if (!(await canAccessBoard(req.params.id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }

  const client = await pool.connect();
  try {
    await client.query(
      'DELETE FROM board_members WHERE board_id=$1 AND user_id=$2',
      [req.params.id, req.params.userId]
    );

    // Sync member options on all person columns
    const updatedColumns = await syncOwnerColumn(client, req.params.id);

    res.json({ success: true, updatedColumns });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
