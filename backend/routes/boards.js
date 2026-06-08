const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireRole, canAccessBoard } = require('../middleware/auth');
const { requireScope } = require('../middleware/apiAuth');

const canWrite = [requireAuth, requireScope('write'), requireRole('admin', 'manager')];

// ── Helpers ───────────────────────────────────────────────────────────────────

// Parse multi-owner value — handles JSON array or legacy single-name string
function parseOwners(val) {
  if (!val) return [];
  let arr;
  try { arr = JSON.parse(val); } catch { return String(val).trim() ? [String(val).trim()] : []; }
  if (!Array.isArray(arr)) arr = arr ? [arr] : [];
  // People are stored as {id,name} objects (id added later); legacy values are
  // plain name strings. Either way, return the names.
  return arr.map(e => (e && typeof e === 'object') ? (e.name || '') : String(e)).filter(Boolean);
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
  { label: 'Done', color: '#00c875' },
  { label: 'Stuck', color: '#e2445c' },
  { label: 'Review', color: '#a25ddc' },
];

// ── GET all accessible boards ─────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.*, (bf.user_id IS NOT NULL) AS is_favorite
         FROM boards b
         LEFT JOIN board_favorites bf
           ON bf.board_id = b.id AND bf.user_id = $2
       WHERE (b.is_deleted IS NULL OR b.is_deleted = false)
         AND ($1 = 'admin'
          OR b.visibility = 'org_wide'
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

// ── POST /:id/favorite — star a board for the current user ───────────────────
router.post('/:id/favorite', requireAuth, async (req, res) => {
  try {
    if (!(await canAccessBoard(req.params.id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });
    await pool.query(
      `INSERT INTO board_favorites (board_id, user_id) VALUES ($1, $2)
       ON CONFLICT (board_id, user_id) DO NOTHING`,
      [req.params.id, req.user.id]
    );
    res.json({ success: true, is_favorite: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── DELETE /:id/favorite — un-star a board for the current user ──────────────
router.delete('/:id/favorite', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM board_favorites WHERE board_id=$1 AND user_id=$2',
      [req.params.id, req.user.id]
    );
    res.json({ success: true, is_favorite: false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET board templates (curated picker list) ────────────────────────────────
router.get('/templates', requireAuth, (req, res) => {
  res.json(require('../services/boardTemplates').listTemplates());
});

// ── GET full board ────────────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const boardRes = await pool.query(
      `SELECT b.*, (bf.user_id IS NOT NULL) AS is_favorite
         FROM boards b
         LEFT JOIN board_favorites bf
           ON bf.board_id = b.id AND bf.user_id = $2
       WHERE b.id = $1 AND (b.is_deleted IS NULL OR b.is_deleted = false)`,
      [id, req.user.id]
    );
    if (!boardRes.rows.length) return res.status(404).json({ error: 'Board not found' });

    const board = boardRes.rows[0];
    if (!(await canAccessBoard(id, req.user, pool)))
      return res.status(403).json({ error: 'You do not have access to this board' });

    const colsRes = await pool.query('SELECT * FROM columns WHERE board_id=$1 ORDER BY position', [id]);
    board.columns = colsRes.rows;

    const groupsRes = await pool.query('SELECT * FROM groups WHERE board_id=$1 ORDER BY position', [id]);
    const groupIds = groupsRes.rows.map(g => g.id);

    // ── Batch load all items for all groups in ONE query ─────────────────────
    const allItemsRes = groupIds.length > 0
      ? await pool.query(
          'SELECT * FROM items WHERE group_id = ANY($1) AND parent_item_id IS NULL ORDER BY position',
          [groupIds]
        )
      : { rows: [] };

    const allItemIds = allItemsRes.rows.map(i => i.id);

    // ── Batch load all column values, comments, subitems ─────────────────────
    const [allValsRes, allCommentsRes, allSubitemsRes] = await Promise.all([
      allItemIds.length > 0
        ? pool.query('SELECT * FROM column_values WHERE item_id = ANY($1)', [allItemIds])
        : Promise.resolve({ rows: [] }),
      allItemIds.length > 0
        ? pool.query(
            'SELECT item_id, COUNT(*) AS count FROM comments WHERE item_id = ANY($1) GROUP BY item_id',
            [allItemIds]
          )
        : Promise.resolve({ rows: [] }),
      allItemIds.length > 0
        ? pool.query(
            'SELECT * FROM items WHERE parent_item_id = ANY($1) ORDER BY position',
            [allItemIds]
          )
        : Promise.resolve({ rows: [] }),
    ]);

    const allSubitemIds = allSubitemsRes.rows.map(s => s.id);
    const allSubValsRes = allSubitemIds.length > 0
      ? await pool.query('SELECT * FROM column_values WHERE item_id = ANY($1)', [allSubitemIds])
      : { rows: [] };

    // ── Build lookup maps ─────────────────────────────────────────────────────
    const valsByItem = {};
    for (const v of allValsRes.rows) {
      if (!valsByItem[v.item_id]) valsByItem[v.item_id] = {};
      valsByItem[v.item_id][v.column_id] = v.value;
    }
    const commentsByItem = {};
    for (const c of allCommentsRes.rows) {
      commentsByItem[c.item_id] = parseInt(c.count) || 0;
    }
    const subitemsByParent = {};
    for (const s of allSubitemsRes.rows) {
      if (!subitemsByParent[s.parent_item_id]) subitemsByParent[s.parent_item_id] = [];
      subitemsByParent[s.parent_item_id].push(s);
    }
    const subValsByItem = {};
    for (const v of allSubValsRes.rows) {
      if (!subValsByItem[v.item_id]) subValsByItem[v.item_id] = {};
      subValsByItem[v.item_id][v.column_id] = v.value;
    }

    // ── Assemble items into groups ────────────────────────────────────────────
    const itemsByGroup = {};
    for (const item of allItemsRes.rows) {
      item.values = valsByItem[item.id] || {};
      item.comment_count = commentsByItem[item.id] || 0;
      const subs = subitemsByParent[item.id] || [];
      for (const sub of subs) {
        sub.values = subValsByItem[sub.id] || {};
        sub.subitems = [];
      }
      item.subitems = subs;
      if (!itemsByGroup[item.group_id]) itemsByGroup[item.group_id] = [];
      itemsByGroup[item.group_id].push(item);
    }

    for (const group of groupsRes.rows) {
      group.items = itemsByGroup[group.id] || [];
    }

    // ── Item-level visibility filter ────────────────────────────────────────
    // Two modes, controlled per-board by boards.enforce_owner_visibility:
    //
    //   STRICT MODE  (enforce_owner_visibility = true):
    //     Only system admins AND designated Board Owners (board_members.is_owner)
    //     see every item. Everyone else — including managers / VPs / AVPs — is
    //     filtered by owner column. Used for confidential boards where
    //     reportees must not see each other's tasks.
    //
    //   LEGACY MODE  (enforce_owner_visibility = false, default):
    //     Admins and managers see everything (backward-compatible).
    //     Regular members are filtered by owner column.
    //
    // In both modes, an item is visible if EVERY active owner column is either
    // empty OR contains the user's name.
    let bypassFilter;
    if (board.enforce_owner_visibility) {
      const ownerRes = await pool.query(
        'SELECT 1 FROM board_members WHERE board_id=$1 AND user_id=$2 AND is_owner=true LIMIT 1',
        [id, req.user.id]
      );
      const isBoardOwner = ownerRes.rows.length > 0;
      bypassFilter = req.user.role === 'admin' || isBoardOwner;
    } else {
      bypassFilter = req.user.role === 'admin' || req.user.role === 'manager';
    }

    if (!bypassFilter) {
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
      `SELECT u.id, u.name, u.email, u.avatar_url, u.role,
              bm.added_at, COALESCE(bm.is_owner, false) AS is_owner
       FROM board_members bm JOIN users u ON u.id = bm.user_id
       WHERE bm.board_id = $1 ORDER BY bm.added_at`,
      [id]
    );
    board.members = membersRes.rows;

    // Resolve cross-board connect/mirror/rollup columns: injects live mirror &
    // rollup values into each item and attaches board.linkedItems for chips.
    try {
      await require('../services/connectionResolver').resolveConnections(pool, board, req.user);
    } catch (connErr) {
      console.error('[connections] resolve failed:', connErr.message);
    }

    // Compute the critical path for the board's dependency column (if any).
    try {
      await require('../services/dependencyEngine').attachCriticalPath(pool, board);
    } catch (depErr) {
      console.error('[dependencies] critical path failed:', depErr.message);
    }

    // Attach live running timers so time-tracking cells can show ticking state.
    try {
      const rt = await pool.query(
        `SELECT item_id, column_id, user_id, user_name, started_at
           FROM time_entries WHERE board_id = $1 AND ended_at IS NULL`,
        [id]
      );
      board.runningTimers = {};
      for (const r of rt.rows) board.runningTimers[`${r.item_id}:${r.column_id}`] = r;
    } catch (tErr) {
      board.runningTimers = {};
    }

    res.json(board);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST create board — with default group, columns and items ─────────────────
router.post('/', ...canWrite, async (req, res) => {
  const { name, description, visibility = 'private', template, spec } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Board name cannot be empty' });
  if (String(name).length > 255) return res.status(400).json({ error: 'Board name too long (max 255)' });
  if (!['private', 'org_wide'].includes(visibility)) return res.status(400).json({ error: 'Invalid visibility' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create board
    const boardRes = await client.query(
      'INSERT INTO boards (name, description, visibility, created_by) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, description || '', visibility, req.user.id]
    );
    const board = boardRes.rows[0];

    // 2. Add creator as first member, marked as a Board Owner so they see
    //    every item even if/when the strict-visibility toggle is enabled.
    await client.query(
      `INSERT INTO board_members (board_id, user_id, added_by, is_owner)
       VALUES ($1,$2,$2,true)
       ON CONFLICT (board_id, user_id) DO UPDATE SET is_owner = true`,
      [board.id, req.user.id]
    );

    // 3. Get creator name (used in Owner column options for private boards)
    const creatorRes = await client.query('SELECT name FROM users WHERE id=$1', [req.user.id]);
    const creatorName = creatorRes.rows[0]?.name || '';

    // 4. Resolve the spec — a curated template, or the default blank board.
    //    item.values are keyed by COLUMN INDEX so a single builder handles both.
    const tpl = (template && template !== 'blank') ? require('../services/boardTemplates').getTemplate(template) : null;
    const { COLUMN_TYPES } = require('../services/columnValidate');
    let columnsSpec, groupsSpec;
    if (spec && Array.isArray(spec.columns) && spec.columns.length) {
      // AI-generated spec — sanitise types + cap sizes.
      columnsSpec = spec.columns
        .filter(c => c && c.title && COLUMN_TYPES.has(c.type))
        .slice(0, 30)
        .map(c => ({
          title: String(c.title).slice(0, 255), type: c.type,
          settings: c.type === 'person' ? { ...(c.settings || {}), options: [creatorName] } : (c.settings || {}),
        }));
      groupsSpec = (Array.isArray(spec.groups) && spec.groups.length ? spec.groups : [{ name: 'Items', color: '#0073ea', items: [] }])
        .slice(0, 15)
        .map(g => ({
          name: String(g.name || 'Group').slice(0, 255), color: g.color || '#0073ea',
          items: (g.items || []).slice(0, 50).map(it => ({ name: String(it.name || 'Item').slice(0, 255), values: it.values || {} })),
        }));
    } else if (tpl) {
      columnsSpec = tpl.columns.map(c => ({
        title: c.title, type: c.type,
        // person columns get the creator as a selectable option
        settings: c.type === 'person' ? { ...(c.settings || {}), options: [creatorName] } : (c.settings || {}),
      }));
      groupsSpec = tpl.groups;
    } else {
      columnsSpec = [
        { title: 'Status', type: 'status', settings: { options: DEFAULT_STATUS_OPTIONS } },
        { title: 'Owner', type: 'person', settings: { options: [creatorName] } },
        { title: 'Due Date', type: 'date', settings: {} },
      ];
      groupsSpec = [{ name: 'Group 1', color: '#0073ea', items: [
        { name: 'Item 1', values: { 0: 'In Progress' } },
        { name: 'Item 2', values: { 0: 'Done' } },
        { name: 'Item 3', values: { 0: 'Stuck' } },
      ] }];
    }

    // 5. Create the columns
    const createdCols = [];
    for (let i = 0; i < columnsSpec.length; i++) {
      const spec = columnsSpec[i];
      const r = await client.query(
        'INSERT INTO columns (board_id, title, type, settings, position) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [board.id, spec.title, spec.type, JSON.stringify(spec.settings || {}), i]
      );
      createdCols.push(r.rows[0]);
    }

    // 6. Create the groups + starter items (item values keyed by column index)
    board.groups = [];
    for (let gi = 0; gi < groupsSpec.length; gi++) {
      const g = groupsSpec[gi];
      const grpRes = await client.query(
        'INSERT INTO groups (board_id, name, color, position) VALUES ($1,$2,$3,$4) RETURNING *',
        [board.id, g.name, g.color || '#0073ea', gi]
      );
      const grp = grpRes.rows[0];
      const items = [];
      const grpItems = g.items || [];
      for (let ii = 0; ii < grpItems.length; ii++) {
        const it = grpItems[ii];
        const itemRes = await client.query(
          'INSERT INTO items (group_id, name, position, created_by_user_id, created_by_user_name) VALUES ($1,$2,$3,$4,$5) RETURNING *',
          [grp.id, it.name, ii, req.user.id, creatorName]
        );
        const item = itemRes.rows[0];
        item.values = {};
        for (let ci = 0; ci < createdCols.length; ci++) {
          const col = createdCols[ci];
          const raw = it.values ? it.values[ci] : undefined;
          const val = (raw !== undefined && raw !== null) ? String(raw) : '';
          await client.query(
            'INSERT INTO column_values (item_id, column_id, value) VALUES ($1,$2,$3)',
            [item.id, col.id, val]
          );
          item.values[col.id] = val;
        }
        item.subitems = [];
        items.push(item);
      }
      board.groups.push({ ...grp, items });
    }

    await client.query('COMMIT');

    board.columns = createdCols;
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
  const { name, description, visibility, item_name, enforce_owner_visibility } = req.body;
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Board name cannot be empty' });
  if (visibility !== undefined && !['private', 'org_wide'].includes(visibility))
    return res.status(400).json({ error: 'Invalid visibility' });
  try {
    if (!(await canAccessBoard(id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    // COALESCE on enforce_owner_visibility so old clients that omit the field
    // don't accidentally turn off strict visibility on a confidential board.
    const { rows } = await pool.query(
      `UPDATE boards
          SET name=$1, description=$2, visibility=$3, item_name=$4,
              enforce_owner_visibility = COALESCE($5, enforce_owner_visibility)
        WHERE id=$6 RETURNING *`,
      [name, description ?? '', visibility ?? 'private', item_name ?? 'Item',
       typeof enforce_owner_visibility === 'boolean' ? enforce_owner_visibility : null, id]
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
// Admins can delete any board; managers can only delete boards they created.
router.delete('/:id', requireAuth, requireScope('full'), requireRole('admin', 'manager'), async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const whereClause = isAdmin
      ? 'id = $3 AND (is_deleted IS NULL OR is_deleted = false)'
      : 'id = $3 AND (is_deleted IS NULL OR is_deleted = false) AND created_by = $1';

    const { rows } = await pool.query(
      `UPDATE boards
       SET is_deleted = true, deleted_at = NOW(),
           deleted_by_user_id = $1, deleted_by_user_name = $2
       WHERE ${whereClause}
       RETURNING id`,
      [req.user.id, req.user.name, req.params.id]
    );
    if (!rows.length) {
      // Distinguish between board not found vs. manager not owning it
      if (!isAdmin) {
        const { rows: exists } = await pool.query(
          'SELECT id FROM boards WHERE id=$1 AND (is_deleted IS NULL OR is_deleted = false)',
          [req.params.id]
        );
        if (exists.length) return res.status(403).json({ error: 'You can only delete boards you created' });
      }
      return res.status(404).json({ error: 'Board not found' });
    }
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
      `SELECT u.id, u.name, u.email, u.avatar_url, u.role,
              bm.added_at, COALESCE(bm.is_owner, false) AS is_owner
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

// ── PATCH toggle a member's Board Owner flag ──────────────────────────────────
// Board Owners (in addition to system admins) bypass the per-item visibility
// filter when boards.enforce_owner_visibility = true. Multi-owner is supported
// — any number of members on a board can carry the flag.
router.patch('/:id/members/:userId', ...canWrite, async (req, res) => {
  const { is_owner } = req.body;
  if (typeof is_owner !== 'boolean') {
    return res.status(400).json({ error: 'is_owner (boolean) is required' });
  }
  try {
    if (!(await canAccessBoard(req.params.id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    const { rows } = await pool.query(
      `UPDATE board_members SET is_owner=$1
        WHERE board_id=$2 AND user_id=$3
        RETURNING user_id, is_owner`,
      [is_owner, req.params.id, req.params.userId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Member not found on this board' });
    res.json(rows[0]);
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
