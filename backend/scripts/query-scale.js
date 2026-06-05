// Scale + correctness test for server-side filter/sort/pagination.
// Seeds a board with N deterministic rows (direct SQL), then exercises the
// /api/items/query endpoint and asserts typed results + measures timing.
require('dotenv').config();
const jwt = require('jsonwebtoken');
const pool = require('./../db');
const http = require('http');

const N = 3000;
const STATUSES = ['Not Started', 'In Progress', 'Done', 'Stuck'];
const OWNERS = ['Alice', 'Bob', 'Carol'];

function api(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: 'localhost', port: 3001, path: '/api' + path, method,
      headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), Authorization: 'Bearer ' + token } },
      resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => { let j; try { j = JSON.parse(d); } catch { j = d; } resolve({ code: resp.statusCode, data: j }); }); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
let pass = 0, fail = 0;
const ok = (c, m) => { (c ? pass++ : fail++); console.log((c ? '  ✅' : '  ❌ FAIL') + ' ' + m); };
const section = s => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 46 - s.length)));

(async () => {
  const admin = (await pool.query("SELECT id,name,role FROM users WHERE role='admin' AND is_active=true LIMIT 1")).rows[0];
  const tok = jwt.sign({ id: admin.id, name: admin.name, role: admin.role }, process.env.JWT_SECRET, { expiresIn: '15m' });

  section('seed ' + N + ' rows');
  const t0 = Date.now();
  const board = (await pool.query(`INSERT INTO boards(name,visibility,created_by) VALUES ($1,'private',$2) RETURNING id`, ['ZZ_Scale_' + Date.now(), admin.id])).rows[0];
  const mkCol = async (title, type) => (await pool.query(`INSERT INTO columns(board_id,title,type,settings,position) VALUES ($1,$2,$3,'{}',0) RETURNING id`, [board.id, title, type])).rows[0].id;
  const scoreCol = await mkCol('Score', 'number');
  const dueCol = await mkCol('Due', 'date');
  const statusCol = await mkCol('Status', 'status');
  const ownerCol = await mkCol('Owner', 'person');
  const group = (await pool.query(`INSERT INTO groups(board_id,name,color,position) VALUES ($1,'All','#0073ea',0) RETURNING id`, [board.id])).rows[0];

  // bulk items
  await pool.query(`INSERT INTO items(group_id,name,position) SELECT $1, 'Task '||g, g FROM generate_series(1,$2) g`, [group.id, N]);
  // deterministic typed values
  await pool.query(`INSERT INTO column_values(item_id,column_id,value) SELECT i.id,$2,i.position::text FROM items i WHERE i.group_id=$1`, [group.id, scoreCol]);
  await pool.query(`INSERT INTO column_values(item_id,column_id,value) SELECT i.id,$2, to_char(DATE '2026-01-01' + (i.position-1), 'YYYY-MM-DD') FROM items i WHERE i.group_id=$1`, [group.id, dueCol]);
  await pool.query(`INSERT INTO column_values(item_id,column_id,value) SELECT i.id,$2, (ARRAY['Not Started','In Progress','Done','Stuck'])[(i.position % 4)+1] FROM items i WHERE i.group_id=$1`, [group.id, statusCol]);
  await pool.query(`INSERT INTO column_values(item_id,column_id,value) SELECT i.id,$2, '["'||(ARRAY['Alice','Bob','Carol'])[(i.position % 3)+1]||'"]' FROM items i WHERE i.group_id=$1`, [group.id, ownerCol]);
  ok(true, `seeded in ${Date.now() - t0}ms`);

  // expected counts (mirror the SQL modulo mapping: idx = position%K, label = arr[idx])
  let doneCount = 0, aliceCount = 0, nameContains = 0, maxDoneHigh = 0;
  for (let p = 1; p <= N; p++) {
    if (STATUSES[p % 4] === 'Done') { doneCount++; if (p > 100) maxDoneHigh = Math.max(maxDoneHigh, p); }
    if (OWNERS[p % 3] === 'Alice') aliceCount++;
    if (('Task ' + p).includes('Task 100')) nameContains++;
  }

  const q = (body) => api('POST', '/items/query', { board_id: board.id, ...body }, tok);

  section('pagination');
  let t = Date.now();
  let r = await q({ page: 1, page_size: 50 });
  const ms = Date.now() - t;
  ok(r.code === 200 && r.data.total === N, `total = ${N} (got ${r.data.total})`);
  ok(r.data.items.length === 50, 'page 1 returns 50 items');
  ok(r.data.hasMore === true, 'hasMore true on page 1');
  ok(ms < 800, `page query < 800ms (took ${ms}ms)`);
  const last = await q({ page: 60, page_size: 50 });
  ok(last.data.items.length === 50 && last.data.hasMore === false, 'last page (60) full, hasMore false');

  section('typed sort');
  r = await q({ sort: { column_id: scoreCol, dir: 'desc', type: 'number' }, page: 1, page_size: 5 });
  ok(r.data.items[0].values[scoreCol] === String(N), `number sort desc → top is ${N} (got ${r.data.items[0].values[scoreCol]})`);
  ok(r.data.items[0].name === 'Task ' + N, 'top row name correct (numeric, not string, ordering)');
  r = await q({ sort: { column_id: scoreCol, dir: 'asc', type: 'number' }, page: 1, page_size: 5 });
  ok(r.data.items[0].values[scoreCol] === '1', 'number sort asc → top is 1');
  // string sort would put "1000" before "2"; numeric must not
  ok(r.data.items.map(i => i.values[scoreCol]).join(',') === '1,2,3,4,5', 'numeric order 1,2,3,4,5 (not lexical)');
  r = await q({ sort: { column_id: dueCol, dir: 'asc', type: 'date' }, page: 1, page_size: 3 });
  ok(r.data.items[0].values[dueCol] === '2026-01-01', 'date sort asc → earliest date first');

  section('typed filter');
  r = await q({ filters: [{ column_id: scoreCol, column_type: 'number', condition: 'gt', value: 2990 }] });
  ok(r.data.total === 10, `Score > 2990 → 10 rows (2991..3000) got ${r.data.total}`);
  r = await q({ filters: [{ column_id: scoreCol, column_type: 'number', condition: 'gte', value: 2990 }] });
  ok(r.data.total === 11, `Score >= 2990 → 11 rows (got ${r.data.total})`);
  r = await q({ filters: [{ column_id: statusCol, column_type: 'status', condition: 'is', value: 'Done' }] });
  ok(r.data.total === doneCount, `Status is Done → ${doneCount} (got ${r.data.total})`);
  r = await q({ filters: [{ column_id: ownerCol, column_type: 'person', condition: 'is', value: 'Alice' }] });
  ok(r.data.total === aliceCount, `Owner is Alice → ${aliceCount} (got ${r.data.total})`);
  r = await q({ filters: [{ column_id: 'name', column_type: 'text', condition: 'contains', value: 'Task 100' }] });
  ok(r.data.total === nameContains, `name contains "Task 100" → ${nameContains} (got ${r.data.total})`);
  r = await q({ filters: [{ column_id: dueCol, column_type: 'date', condition: 'before', value: '2026-01-11' }] });
  ok(r.data.total === 10, `Due before 2026-01-11 → 10 rows (got ${r.data.total})`);

  section('combined filter + sort + page');
  r = await q({
    filters: [
      { column_id: statusCol, column_type: 'status', condition: 'is', value: 'Done' },
      { column_id: scoreCol, column_type: 'number', condition: 'gt', value: 100 },
    ],
    sort: { column_id: scoreCol, dir: 'desc', type: 'number' }, page: 1, page_size: 10,
  });
  const allDoneAndHigh = r.data.items.every(i => i.values[statusCol] === 'Done' && Number(i.values[scoreCol]) > 100);
  const sortedDesc = r.data.items.every((it, k, a) => k === 0 || Number(a[k - 1].values[scoreCol]) >= Number(it.values[scoreCol]));
  ok(allDoneAndHigh, 'every row matches BOTH filters');
  ok(sortedDesc, 'rows sorted by Score desc');
  ok(r.data.items[0].values[scoreCol] === String(maxDoneHigh), `highest Done score at top = ${maxDoneHigh} (got ${r.data.items[0].values[scoreCol]})`);

  section('cleanup');
  await pool.query('DELETE FROM column_values WHERE item_id IN (SELECT i.id FROM items i JOIN groups g ON g.id=i.group_id WHERE g.board_id=$1)', [board.id]);
  await pool.query('DELETE FROM items WHERE group_id IN (SELECT id FROM groups WHERE board_id=$1)', [board.id]);
  await pool.query('DELETE FROM columns WHERE board_id=$1', [board.id]);
  await pool.query('DELETE FROM groups WHERE board_id=$1', [board.id]);
  await pool.query('DELETE FROM boards WHERE id=$1', [board.id]);
  console.log('  deleted scale-test board');

  console.log('\n══════════════════════════════════');
  console.log(`  RESULT: ${pass} passed, ${fail} failed`);
  console.log('══════════════════════════════════');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
