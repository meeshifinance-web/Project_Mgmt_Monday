const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const canWrite = [requireAuth, requireRole('admin', 'manager')];

// ── Helpers ───────────────────────────────────────────────────────────────────

// Parse multi-owner value — handles JSON array or legacy single-name string
function parseOwners(val) {
  if (!val) return [];
  try { const p = JSON.parse(val); return Array.isArray(p) ? p : p ? [String(p)] : []; }
  catch { return val.trim() ? [val.trim()] : []; }
}

async function canAccessBoard(boardId, user) {
  const { rows } = await pool.query('SELECT id FROM boards WHERE id=$1', [boardId]);
  if (!rows.length) return false;
  if (user.role === 'admin') return true;
  const mem = await pool.query(
    'SELECT 1 FROM board_members WHERE board_id=$1 AND user_id=$2', [boardId, user.id]
  );
  return mem.rows.length > 0;
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
    res.status(500).json({ error: err.message });
  }
});

// ── GET full board ────────────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const boardRes = await pool.query('SELECT * FROM boards WHERE id=$1 AND (is_deleted IS NULL OR is_deleted = false)', [id]);
    if (!boardRes.rows.length) return res.status(404).json({ error: 'Board not found' });

    const board = boardRes.rows[0];
    if (!(await canAccessBoard(id, req.user)))
      return res.status(403).json({ error: 'You do not have access to this board' });

    const colsRes = await pool.query('SELECT * FROM columns WHERE board_id=$1 ORDER BY position', [id]);
    board.columns = colsRes.rows;

    const groupsRes = await pool.query('SELECT * FROM groups WHERE board_id=$1 ORDER BY position', [id]);
    for (const group of groupsRes.rows) {
      const itemsRes = await pool.query('SELECT * FROM items WHERE group_id=$1 ORDER BY position', [group.id]);
      for (const item of itemsRes.rows) {
        const valsRes = await pool.query('SELECT * FROM column_values WHERE item_id=$1', [item.id]);
        item.values = {};
        for (const v of valsRes.rows) item.values[v.column_id] = v.value;
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── PUT update board ──────────────────────────────────────────────────────────
router.put('/:id', ...canWrite, async (req, res) => {
  const { id } = req.params;
  const { name, description, visibility } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE boards SET name=$1, description=$2, visibility=$3 WHERE id=$4 RETURNING *',
      [name, description ?? '', visibility ?? 'private', id]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH board email-settings — per-board sender address ─────────────────────
router.patch('/:id/email-settings', ...canWrite, async (req, res) => {
  const { email_from } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE boards SET email_from=$1 WHERE id=$2 RETURNING id, email_from',
      [email_from || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Board not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE board — soft-delete (moves to global trash, 15-day retention) ──────
router.delete('/:id', requireAuth, requireRole('admin'), async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

// ── GET board members ─────────────────────────────────────────────────────────
router.get('/:id/members', requireAuth, async (req, res) => {
  if (!(await canAccessBoard(req.params.id, req.user)))
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
    res.status(500).json({ error: err.message });
  }
});

// ── POST add member — also syncs person columns ───────────────────────────────
router.post('/:id/members', ...canWrite, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

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
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ── DELETE remove member — also syncs person columns ─────────────────────────
router.delete('/:id/members/:userId', ...canWrite, async (req, res) => {
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
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
