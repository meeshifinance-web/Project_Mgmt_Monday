// ───────────────────────────────────────────────────────────────────────────
// Cross-board connection resolver.
//
// A board can carry three related column types:
//   • connect_boards — stores a JSON array of item ids in another (or the same)
//                      board. This is the link.
//   • mirror         — displays a chosen column of the linked items, read-only.
//   • rollup         — aggregates a numeric column of the linked items into one
//                      value (sum / avg / min / max / median / count …).
//
// The browser only ever loads ONE board, so mirror/rollup values — which depend
// on data living in OTHER boards — must be computed on the server. This module
// is called from the board GET after items are assembled; it injects the live
// mirror/rollup values into each item's `values` map and attaches a
// `board.linkedItems` lookup so connect cells can render item names.
// ───────────────────────────────────────────────────────────────────────────

function parseSettings(s) {
  if (!s) return {};
  return typeof s === 'string' ? (() => { try { return JSON.parse(s); } catch { return {}; } })() : s;
}

function parseIds(raw) {
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a.map(n => parseInt(n, 10)).filter(n => Number.isInteger(n) && n > 0) : [];
  } catch { return []; }
}

const round = (n) => Math.round(n * 100) / 100;

function optionColor(meta, val) {
  if (!meta) return null;
  if (['status', 'priority', 'dropdown'].includes(meta.type)) {
    const opt = (meta.settings.options || []).find(o => (o && typeof o === 'object' ? o.label : o) === val);
    return opt && typeof opt === 'object' ? (opt.color || null) : null;
  }
  return null;
}

async function resolveConnections(pool, board, user) {
  const cols = board.columns || [];
  const connectCols = cols.filter(c => c.type === 'connect_boards');
  const mirrorCols = cols.filter(c => c.type === 'mirror');
  const rollupCols = cols.filter(c => c.type === 'rollup');
  // Dependency columns also reference items (same board) — resolve their names too.
  const depCols = cols.filter(c => c.type === 'dependency');
  if (!connectCols.length && !mirrorCols.length && !rollupCols.length && !depCols.length) return;

  // Flatten items + subitems — connect columns can live on either.
  const allRows = [];
  for (const g of board.groups || []) {
    for (const it of g.items || []) {
      allRows.push(it);
      for (const sub of it.subitems || []) allRows.push(sub);
    }
  }

  // 1. Collect every linked item id referenced by any connect cell.
  const linkedIdSet = new Set();
  for (const it of allRows) {
    for (const cc of connectCols) {
      for (const id of parseIds(it.values?.[cc.id])) linkedIdSet.add(id);
    }
    for (const dc of depCols) {
      for (const id of parseIds(it.values?.[dc.id])) linkedIdSet.add(id);
    }
  }
  const linkedIds = [...linkedIdSet];

  // 2. Resolve linked item names + their owning board (for chip display).
  const linkedItems = {};
  if (linkedIds.length) {
    const r = await pool.query(
      `SELECT i.id, i.name, g.board_id, b.name AS board_name
         FROM items i
         JOIN groups g ON g.id = i.group_id
         JOIN boards b ON b.id = g.board_id
        WHERE i.id = ANY($1)`,
      [linkedIds]
    );
    for (const row of r.rows) {
      linkedItems[row.id] = { id: row.id, name: row.name, board_id: row.board_id, board_name: row.board_name };
    }
  }
  board.linkedItems = linkedItems;

  // ── Access masking ──────────────────────────────────────────────────────────
  // A viewer may link to (or have inherited links to) items on boards they
  // cannot themselves open. Mask the NAME of those items so a connect column
  // can't be used to enumerate another board's contents. Mirror VALUES are kept
  // — surfacing a chosen field is the deliberate purpose of a mirror column.
  if (user && linkedIds.length) {
    const boardIds = [...new Set(Object.values(linkedItems).map(li => li.board_id))];
    let accessible;
    if (user.role === 'admin') {
      accessible = new Set(boardIds);
    } else {
      const r = await pool.query(
        `SELECT b.id FROM boards b
          WHERE b.id = ANY($1)
            AND (b.is_deleted IS NULL OR b.is_deleted = false)
            AND ( b.visibility = 'org_wide'
               OR EXISTS (SELECT 1 FROM board_members bm WHERE bm.board_id = b.id AND bm.user_id = $2) )`,
        [boardIds, user.id]
      );
      accessible = new Set(r.rows.map(x => x.id));
    }
    for (const li of Object.values(linkedItems)) {
      if (!accessible.has(li.board_id)) { li.name = '🔒 Restricted'; li.board_name = null; li.restricted = true; }
    }
  }

  // Nothing to compute if there are no mirror/rollup columns.
  if (!mirrorCols.length && !rollupCols.length) return;

  // 3. Fetch metadata for every source column referenced by mirror/rollup.
  const srcColIds = [...new Set(
    [...mirrorCols, ...rollupCols]
      .map(c => parseInt(parseSettings(c.settings).sourceColumnId, 10))
      .filter(Number.isInteger)
  )];
  const srcColMeta = {};
  if (srcColIds.length) {
    const r = await pool.query('SELECT id, type, settings, title FROM columns WHERE id = ANY($1)', [srcColIds]);
    for (const row of r.rows) {
      srcColMeta[row.id] = { id: row.id, type: row.type, settings: parseSettings(row.settings), title: row.title };
    }
  }

  // 4. Fetch the source-column values of all linked items in one query.
  const valByItemCol = {};
  if (linkedIds.length && srcColIds.length) {
    const r = await pool.query(
      'SELECT item_id, column_id, value FROM column_values WHERE item_id = ANY($1) AND column_id = ANY($2)',
      [linkedIds, srcColIds]
    );
    for (const row of r.rows) {
      (valByItemCol[row.item_id] = valByItemCol[row.item_id] || {})[row.column_id] = row.value;
    }
  }

  const connectById = new Map(connectCols.map(c => [String(c.id), c]));

  // 5. Compute mirror + rollup values per item.
  for (const it of allRows) {
    it.values = it.values || {};

    for (const mc of mirrorCols) {
      const st = parseSettings(mc.settings);
      const connCol = connectById.get(String(st.connectColumnId));
      const srcId = parseInt(st.sourceColumnId, 10);
      const srcMeta = srcColMeta[srcId];
      const ids = connCol ? parseIds(it.values[connCol.id]) : [];
      const entries = ids.map(id => {
        const v = valByItemCol[id]?.[srcId] ?? '';
        return { id, name: linkedItems[id]?.name || `#${id}`, v, color: optionColor(srcMeta, v), restricted: !!linkedItems[id]?.restricted };
      }).filter(e => e.v !== '' && e.v != null);
      if (entries.length) {
        // colId + opts let the client edit the source value straight from the
        // mirror cell (monday-style edit-through-mirror) for status-like columns.
        const payload = { type: srcMeta?.type || 'text', colId: srcId, items: entries };
        if (['status', 'priority', 'dropdown'].includes(srcMeta?.type)) payload.opts = srcMeta.settings.options || [];
        it.values[mc.id] = JSON.stringify(payload);
      } else {
        it.values[mc.id] = '';
      }
    }

    for (const rc of rollupCols) {
      const st = parseSettings(rc.settings);
      const connCol = connectById.get(String(st.connectColumnId));
      const srcId = parseInt(st.sourceColumnId, 10);
      const srcMeta = srcColMeta[srcId];
      const fn = st.fn || 'sum';
      const ids = connCol ? parseIds(it.values[connCol.id]) : [];
      const raws = ids.map(id => valByItemCol[id]?.[srcId]).filter(v => v !== undefined && v !== null && v !== '');

      let out = '';
      if (fn === 'count') {
        out = String(ids.length);
      } else if (fn === 'count_filled') {
        out = String(raws.length);
      } else if (fn === 'count_unique') {
        out = String(new Set(raws).size);
      } else if (['earliest', 'latest', 'range'].includes(fn)) {
        // Date aggregation — timeline columns anchor on their start date.
        const dates = raws.map(v => {
          let s = String(v);
          if (srcMeta?.type === 'timeline') s = s.split('→')[0].trim();
          return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
        }).filter(Boolean).sort();
        if (dates.length) {
          if (fn === 'earliest') out = dates[0];
          else if (fn === 'latest') out = dates[dates.length - 1];
          else out = dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} → ${dates[dates.length - 1]}`;
        }
      } else {
        const nums = raws.map(Number).filter(Number.isFinite);
        if (nums.length) {
          if (fn === 'sum') out = String(round(nums.reduce((a, b) => a + b, 0)));
          else if (fn === 'avg') out = String(round(nums.reduce((a, b) => a + b, 0) / nums.length));
          else if (fn === 'min') out = String(Math.min(...nums));
          else if (fn === 'max') out = String(Math.max(...nums));
          else if (fn === 'median') {
            const s = [...nums].sort((a, b) => a - b);
            const m = Math.floor(s.length / 2);
            out = String(round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2));
          }
        }
      }
      it.values[rc.id] = out;
    }
  }
}

module.exports = { resolveConnections };
