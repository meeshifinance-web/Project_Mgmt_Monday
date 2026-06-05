// Rigorous test for the time-tracking suite: manual entries, live timer
// accumulation, one-timer-per-user enforcement, recompute, timesheet billing.
require('dotenv').config();
const jwt = require('jsonwebtoken');
const pool = require('./../db');
const http = require('http');

function api(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: 'localhost', port: 3001, path: '/api' + path, method,
      headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), Authorization: 'Bearer ' + token } },
      resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => { let j; try { j = JSON.parse(d); } catch { j = d; } resolve({ code: resp.statusCode, data: j }); }); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { (c ? pass++ : fail++); console.log((c ? '  ✅' : '  ❌ FAIL') + ' ' + m); };
const section = s => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 44 - s.length)));

(async () => {
  const admin = (await pool.query("SELECT id,name,role FROM users WHERE role='admin' AND is_active=true LIMIT 1")).rows[0];
  const tok = jwt.sign({ id: admin.id, name: admin.name, role: admin.role }, process.env.JWT_SECRET, { expiresIn: '15m' });

  section('setup');
  const B = (await api('POST', '/boards', { name: 'ZZ_Time_' + Date.now(), visibility: 'private' }, tok)).data;
  const g = B.groups[0];
  const tcol = (await api('POST', '/columns', { board_id: B.id, title: 'Time', type: 'time_tracking' }, tok)).data;
  const A = g.items[0], C = g.items[1];
  ok(!!tcol.id, 'created time_tracking column');

  const cellTotal = async (item) => (await api('GET', `/time/cell/${item.id}/${tcol.id}`, null, tok)).data.total;
  const storedVal = async (item) => {
    const full = (await api('GET', '/boards/' + B.id, null, tok)).data;
    const it = full.groups.flatMap(x => x.items).find(x => x.id === item.id);
    return it.values[tcol.id];
  };

  section('manual entry');
  let r = await api('POST', '/time/manual', { item_id: A.id, column_id: tcol.id, duration_seconds: 3600, billable: true }, tok);
  ok(r.code === 201 && r.data.total === 3600, 'manual 1h → total 3600 (got ' + r.data.total + ')');
  ok(await storedVal(A) === '3600', 'total persisted into column_values for sorting');

  section('live timer accumulation');
  r = await api('POST', '/time/start', { item_id: A.id, column_id: tcol.id }, tok);
  ok(r.code === 201 && !r.data.entry.ended_at, 'timer started (running entry)');
  const cell = (await api('GET', `/time/cell/${A.id}/${tcol.id}`, null, tok)).data;
  ok(cell.running && cell.running.user_id === admin.id, 'GET cell reports my running timer');
  await sleep(2100);
  r = await api('POST', '/time/stop', { item_id: A.id, column_id: tcol.id }, tok);
  const elapsed = r.data.entry.duration_seconds;
  ok(elapsed >= 2 && elapsed <= 4, 'stop captured ~2s elapsed (got ' + elapsed + 's)');
  ok(r.data.total === 3600 + elapsed, 'total accumulated 3600 + timer (got ' + r.data.total + ')');

  section('one running timer per user');
  await api('POST', '/time/start', { item_id: A.id, column_id: tcol.id }, tok); // start on A
  await sleep(1100);
  await api('POST', '/time/start', { item_id: C.id, column_id: tcol.id }, tok); // start on C → A auto-stops
  const aRunning = (await api('GET', `/time/cell/${A.id}/${tcol.id}`, null, tok)).data.running;
  ok(!aRunning, 'starting a new timer auto-stopped the timer on item A');
  ok(await cellTotal(A) > 3600 + elapsed, 'A accumulated the auto-stopped time');
  // stop C to clean running state
  await api('POST', '/time/stop', { item_id: C.id, column_id: tcol.id }, tok);

  section('running indicator + recompute on delete');
  const running = await api('GET', '/time/running', null, tok);
  ok(running.data === null, 'no running timer after stopping all');
  const entries = (await api('GET', `/time/cell/${A.id}/${tcol.id}`, null, tok)).data.entries;
  const before = await cellTotal(A);
  const del = entries.find(e => e.duration_seconds === 3600);
  r = await api('DELETE', '/time/entry/' + del.id, null, tok);
  ok(r.data.total === before - 3600, 'deleting the 1h entry recomputes total (got ' + r.data.total + ')');

  section('timesheet + billing + capacity');
  await api('PUT', `/time/user/${admin.id}/billing`, { hourly_rate: 100, weekly_capacity: 40 }, tok);
  // add a clean 2h billable + 1h non-billable on C
  await api('POST', '/time/manual', { item_id: C.id, column_id: tcol.id, duration_seconds: 7200, billable: true }, tok);
  await api('POST', '/time/manual', { item_id: C.id, column_id: tcol.id, duration_seconds: 3600, billable: false }, tok);
  const ts = (await api('GET', `/time/timesheet?board_id=${B.id}&from=2020-01-01`, null, tok)).data;
  const me = ts.users.find(u => u.user_id === admin.id);
  ok(!!me, 'timesheet lists the user');
  ok(me.billable_hours >= 2, 'billable hours include the 2h entry (got ' + me.billable_hours + ')');
  // cost should equal billable_hours * 100
  ok(Math.abs(me.cost - me.billable_hours * 100) < 0.5, 'cost = billable_hours × rate (got $' + me.cost + ')');
  ok(me.capacity_hours > 0 && me.utilization !== null, 'capacity + utilization computed (' + me.utilization + '%)');
  ok(typeof ts.totals.cost === 'number', 'grand totals present ($' + ts.totals.cost + ')');

  section('cleanup');
  await api('DELETE', '/boards/' + B.id, null, tok);
  await pool.query('UPDATE users SET hourly_rate=0, weekly_capacity=40 WHERE id=$1', [admin.id]);
  console.log('  cleaned up');

  console.log('\n══════════════════════════════════');
  console.log(`  RESULT: ${pass} passed, ${fail} failed`);
  console.log('══════════════════════════════════');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
