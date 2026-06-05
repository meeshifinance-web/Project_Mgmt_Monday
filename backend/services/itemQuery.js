// ───────────────────────────────────────────────────────────────────────────
// Server-side item query — typed filter / sort / pagination.
//
// The board GET loads every row; that doesn't scale to thousands. This builds a
// single parameterized SQL query that filters, sorts and paginates IN POSTGRES,
// casting cell values to their real type (number → numeric, date → date) so
// "10" sorts after "9" and dates order chronologically — not as strings.
//
// Safety: column ids are coerced to integers before being embedded; every
// user-supplied value is a bound parameter ($n). Conditions are whitelisted.
// ───────────────────────────────────────────────────────────────────────────

const NUMERIC_RE = "'^-?[0-9]+(\\.[0-9]+)?$'";
const DATE_RE = "'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'";

// A correlated sub-select returning the single cell value for a column.
const cellSub = (cid) => `(SELECT cv.value FROM column_values cv WHERE cv.item_id = i.id AND cv.column_id = ${cid} LIMIT 1)`;

// Build one filter as a SQL boolean fragment, pushing bound params.
function buildFilter(f, params) {
  const cond = String(f.condition || '');
  const isName = String(f.column_id) === 'name';
  const type = f.column_type;

  // ── Item name ──
  if (isName) {
    switch (cond) {
      case 'is':            params.push(f.value); return `i.name = $${params.length}`;
      case 'is_not':        params.push(f.value); return `i.name <> $${params.length}`;
      case 'contains':      params.push('%' + f.value + '%'); return `i.name ILIKE $${params.length}`;
      case 'not_contains':  params.push('%' + f.value + '%'); return `i.name NOT ILIKE $${params.length}`;
      case 'is_empty':      return `(i.name IS NULL OR i.name = '')`;
      case 'is_not_empty':  return `(i.name IS NOT NULL AND i.name <> '')`;
      default: return null;
    }
  }

  const cid = parseInt(f.column_id, 10);
  if (!Number.isInteger(cid)) return null;
  const base = `SELECT 1 FROM column_values cv WHERE cv.item_id = i.id AND cv.column_id = ${cid}`;
  const exists = (extra) => `EXISTS (${base} AND ${extra})`;
  const notExists = (extra) => `NOT EXISTS (${base} AND ${extra})`;

  switch (cond) {
    case 'is_empty':     return `NOT EXISTS (${base} AND cv.value <> '')`;
    case 'is_not_empty': return `EXISTS (${base} AND cv.value <> '')`;

    case 'is': {
      // person columns store a JSON array of names — match membership
      if (type === 'person') { params.push('%"' + f.value + '"%'); return exists(`cv.value ILIKE $${params.length}`); }
      params.push(f.value); return exists(`cv.value = $${params.length}`);
    }
    case 'is_not': {
      if (type === 'person') { params.push('%"' + f.value + '"%'); return notExists(`cv.value ILIKE $${params.length}`); }
      params.push(f.value); return notExists(`cv.value = $${params.length}`);
    }
    case 'contains':     params.push('%' + f.value + '%'); return exists(`cv.value ILIKE $${params.length}`);
    case 'not_contains': params.push('%' + f.value + '%'); return notExists(`cv.value ILIKE $${params.length}`);

    // numeric comparisons (guard against non-numeric strings)
    case 'gt': case 'gte': case 'lt': case 'lte': case 'eq': {
      const op = { gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '=' }[cond];
      params.push(Number(f.value));
      return exists(`cv.value ~ ${NUMERIC_RE} AND cv.value::numeric ${op} $${params.length}`);
    }

    // date comparisons
    case 'before': params.push(f.value); return exists(`cv.value ~ ${DATE_RE} AND cv.value::date < $${params.length}::date`);
    case 'after':  params.push(f.value); return exists(`cv.value ~ ${DATE_RE} AND cv.value::date > $${params.length}::date`);
    case 'on':     params.push(f.value); return exists(`cv.value ~ ${DATE_RE} AND cv.value::date = $${params.length}::date`);
    case 'overdue':   return exists(`cv.value ~ ${DATE_RE} AND cv.value::date < CURRENT_DATE`);
    case 'today':     return exists(`cv.value ~ ${DATE_RE} AND cv.value::date = CURRENT_DATE`);
    case 'this_week': return exists(`cv.value ~ ${DATE_RE} AND cv.value::date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'`);
    case 'next_week': return exists(`cv.value ~ ${DATE_RE} AND cv.value::date BETWEEN CURRENT_DATE + INTERVAL '7 days' AND CURRENT_DATE + INTERVAL '14 days'`);

    default: return null;
  }
}

function buildOrderBy(sort) {
  if (!sort || !sort.column_id) return 'i.position ASC, i.id ASC';
  const dir = String(sort.dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  if (String(sort.column_id) === 'name') return `i.name ${dir} NULLS LAST, i.id ASC`;
  const cid = parseInt(sort.column_id, 10);
  if (!Number.isInteger(cid)) return 'i.position ASC, i.id ASC';
  const sub = cellSub(cid);
  if (sort.type === 'number' || sort.type === 'rating' || sort.type === 'progress')
    return `(CASE WHEN ${sub} ~ ${NUMERIC_RE} THEN ${sub}::numeric END) ${dir} NULLS LAST, i.id ASC`;
  if (sort.type === 'date')
    return `(CASE WHEN ${sub} ~ ${DATE_RE} THEN ${sub}::date END) ${dir} NULLS LAST, i.id ASC`;
  return `NULLIF(lower(${sub}), '') ${dir} NULLS LAST, i.id ASC`;
}

// Build the WHERE clause shared by the count + page queries.
function buildWhere({ boardId, filters = [], search = '', groupId = null }) {
  const params = [boardId];
  const where = ['g.board_id = $1', 'i.parent_item_id IS NULL'];
  if (groupId) { params.push(parseInt(groupId, 10)); where.push(`i.group_id = $${params.length}`); }
  if (search) { params.push('%' + search + '%'); where.push(`i.name ILIKE $${params.length}`); }
  for (const f of (filters || [])) {
    const frag = buildFilter(f, params);
    if (frag) where.push(frag);
  }
  return { whereSql: where.join(' AND '), params };
}

async function queryItems(pool, opts) {
  const page = Math.max(1, parseInt(opts.page, 10) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(opts.pageSize, 10) || 50));
  const offset = (page - 1) * pageSize;

  const { whereSql, params } = buildWhere(opts);
  const orderBy = buildOrderBy(opts.sort);

  const countSql = `SELECT COUNT(*)::int AS total FROM items i JOIN groups g ON g.id = i.group_id WHERE ${whereSql}`;
  const total = (await pool.query(countSql, params)).rows[0].total;

  const pageParams = params.slice();
  pageParams.push(pageSize); const limIdx = pageParams.length;
  pageParams.push(offset);   const offIdx = pageParams.length;
  const pageSql = `
    SELECT i.id, i.name, i.group_id, i.position, i.created_at,
           i.created_by_user_name
      FROM items i JOIN groups g ON g.id = i.group_id
     WHERE ${whereSql}
     ORDER BY ${orderBy}
     LIMIT $${limIdx} OFFSET $${offIdx}`;
  const itemsRes = await pool.query(pageSql, pageParams);
  const items = itemsRes.rows;

  // attach column values for just this page
  const ids = items.map(i => i.id);
  if (ids.length) {
    const valsRes = await pool.query('SELECT item_id, column_id, value FROM column_values WHERE item_id = ANY($1)', [ids]);
    const byItem = {};
    for (const v of valsRes.rows) (byItem[v.item_id] = byItem[v.item_id] || {})[v.column_id] = v.value;
    for (const it of items) it.values = byItem[it.id] || {};
  }

  return { items, total, page, pageSize, hasMore: offset + items.length < total };
}

module.exports = { queryItems, buildWhere, buildOrderBy, buildFilter };
