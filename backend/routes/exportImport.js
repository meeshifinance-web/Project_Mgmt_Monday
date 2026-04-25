const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, canAccessBoard } = require('../middleware/auth');
const XLSX = require('xlsx');

const READ_ONLY_ROLES = ['user'];

// GET /api/boards/:boardId/export — download board as Excel
// Optional query params:
//   item_ids=1,2,3      — only export these items (filters rows)
//   column_ids=4,5,6    — only export these columns (filters columns; preserves order)
router.get('/:boardId/export', requireAuth, async (req, res) => {
  const { boardId } = req.params;

  const parseIdList = (s) => {
    if (!s || typeof s !== 'string') return null;
    const ids = s
      .split(',')
      .map(x => parseInt(x.trim(), 10))
      .filter(n => Number.isInteger(n) && n > 0);
    return ids.length ? ids : null;
  };
  const itemIdFilter = parseIdList(req.query.item_ids);
  const columnIdFilter = parseIdList(req.query.column_ids);

  try {
    const boardRes = await pool.query('SELECT name FROM boards WHERE id=$1', [boardId]);
    if (!boardRes.rows.length) return res.status(404).json({ error: 'Board not found' });

    if (!(await canAccessBoard(boardId, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    const boardName = boardRes.rows[0].name;

    const colParams = [boardId];
    let colSql = 'SELECT id, title, type FROM columns WHERE board_id=$1';
    if (columnIdFilter) {
      colParams.push(columnIdFilter);
      colSql += ` AND id = ANY($${colParams.length}::int[])`;
    }
    colSql += ' ORDER BY position';
    const colRes = await pool.query(colSql, colParams);
    const columns = colRes.rows;

    const groupRes = await pool.query(
      'SELECT id, name FROM groups WHERE board_id=$1 ORDER BY position',
      [boardId]
    );
    const groupMap = {};
    for (const g of groupRes.rows) groupMap[g.id] = g.name;

    const itemParams = [boardId];
    let itemSql = `SELECT i.id, i.name, i.group_id, i.position
       FROM items i
       JOIN groups g ON g.id = i.group_id
       WHERE g.board_id = $1`;
    if (itemIdFilter) {
      itemParams.push(itemIdFilter);
      itemSql += ` AND i.id = ANY($${itemParams.length}::int[])`;
    }
    itemSql += ' ORDER BY i.group_id, i.position';
    const itemRes = await pool.query(itemSql, itemParams);

    const cvParams = [boardId];
    let cvSql = `SELECT cv.item_id, cv.column_id, cv.value
       FROM column_values cv
       JOIN items i ON i.id = cv.item_id
       JOIN groups g ON g.id = i.group_id
       WHERE g.board_id = $1`;
    if (itemIdFilter) {
      cvParams.push(itemIdFilter);
      cvSql += ` AND i.id = ANY($${cvParams.length}::int[])`;
    }
    if (columnIdFilter) {
      cvParams.push(columnIdFilter);
      cvSql += ` AND cv.column_id = ANY($${cvParams.length}::int[])`;
    }
    const cvRes = await pool.query(cvSql, cvParams);
    const cvMap = {};
    for (const cv of cvRes.rows) {
      if (!cvMap[cv.item_id]) cvMap[cv.item_id] = {};
      cvMap[cv.item_id][cv.column_id] = cv.value;
    }

    // Build rows: header + data
    const headers = ['Group', 'Item Name', ...columns.map(c => c.title)];
    const rows = [headers];
    for (const item of itemRes.rows) {
      rows.push([
        groupMap[item.group_id] || '',
        item.name,
        ...columns.map(c => cvMap[item.id]?.[c.id] || ''),
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Board');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const filename = `${boardName.replace(/[^a-z0-9]/gi, '_')}_export.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/boards/:boardId/import — bulk create items from CSV rows
// Body: { rows: [{ Group, 'Item Name', [colTitle]: value, ... }] }
router.post('/:boardId/import', requireAuth, async (req, res) => {
  if (READ_ONLY_ROLES.includes(req.user.role))
    return res.status(403).json({ error: 'Read-only access' });

  const { boardId } = req.params;
  const { rows } = req.body;
  if (!Array.isArray(rows) || rows.length === 0)
    return res.status(400).json({ error: 'No rows provided' });
  if (rows.length > 2000)
    return res.status(400).json({ error: 'Maximum 2000 rows per import' });

  // Verify board exists and user has access before opening a transaction
  try {
    const boardCheck = await pool.query('SELECT id FROM boards WHERE id=$1', [boardId]);
    if (!boardCheck.rows.length) return res.status(404).json({ error: 'Board not found' });
    if (!(await canAccessBoard(boardId, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const groupRes = await client.query(
      'SELECT id, name FROM groups WHERE board_id=$1',
      [boardId]
    );
    const colRes = await client.query(
      'SELECT id, title, type FROM columns WHERE board_id=$1',
      [boardId]
    );

    const groups = groupRes.rows;
    // Exclude person columns from import — their values are JSON arrays and
    // cannot be reliably reconstructed from plain CSV text
    const SKIP_TYPES = new Set(['person', 'formula', 'creation_log']);
    const columns = colRes.rows.filter(c => !SKIP_TYPES.has(c.type));

    const groupByName = {};
    for (const g of groups) groupByName[g.name.toLowerCase()] = g;
    const colByTitle = {};
    for (const c of columns) colByTitle[c.title.toLowerCase()] = c;

    let created = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const itemName = (row['Item Name'] || row['item name'] || row['name'] || '').trim();
      if (!itemName) {
        errors.push(`Row ${i + 2}: missing Item Name`);
        continue;
      }

      const groupName = (row['Group'] || row['group'] || '').trim();
      let groupId = groups[0]?.id; // default to first group

      if (groupName) {
        const found = groupByName[groupName.toLowerCase()];
        if (found) {
          groupId = found.id;
        } else {
          // Auto-create the group
          const posRes = await client.query(
            'SELECT COALESCE(MAX(position),0)+1 AS pos FROM groups WHERE board_id=$1',
            [boardId]
          );
          const newGroup = await client.query(
            'INSERT INTO groups (board_id, name, position) VALUES ($1,$2,$3) RETURNING id, name',
            [boardId, groupName, posRes.rows[0].pos]
          );
          groupId = newGroup.rows[0].id;
          groups.push(newGroup.rows[0]);
          groupByName[groupName.toLowerCase()] = newGroup.rows[0];
        }
      }

      if (!groupId) {
        errors.push(`Row ${i + 2}: no group available — add at least one group to the board first`);
        continue;
      }

      const posRes = await client.query(
        'SELECT COALESCE(MAX(position),0)+1 AS pos FROM items WHERE group_id=$1',
        [groupId]
      );
      const itemRes = await client.query(
        `INSERT INTO items (group_id, name, position, created_by_user_id, created_by_user_name)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [groupId, itemName, posRes.rows[0].pos, req.user.id, req.user.name]
      );
      const itemId = itemRes.rows[0].id;

      for (const [key, val] of Object.entries(row)) {
        const lk = key.toLowerCase();
        if (lk === 'group' || lk === 'item name' || lk === 'name') continue;
        const col = colByTitle[lk];
        if (!col || val === undefined || val === null || String(val).trim() === '') continue;
        await client.query(
          `INSERT INTO column_values (item_id, column_id, value)
           VALUES ($1,$2,$3)
           ON CONFLICT (item_id, column_id) DO UPDATE SET value=EXCLUDED.value`,
          [itemId, col.id, String(val)]
        );
      }

      created++;
    }

    await client.query('COMMIT');
    res.json({ created, errors });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
