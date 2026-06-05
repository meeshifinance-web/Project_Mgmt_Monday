// Rigorous test for the dependency engine: auto-shift propagation, critical
// path, cycle safety. Creates a throwaway board, asserts, cleans up.
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
let pass = 0, fail = 0;
const ok = (c, m) => { (c ? pass++ : fail++); console.log((c ? '  ✅' : '  ❌ FAIL') + ' ' + m); };
const section = s => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 48 - s.length)));

(async () => {
  const admin = (await pool.query("SELECT id,name,role FROM users WHERE role='admin' AND is_active=true LIMIT 1")).rows[0];
  const tok = jwt.sign({ id: admin.id, name: admin.name, role: admin.role }, process.env.JWT_SECRET, { expiresIn: '15m' });

  section('setup');
  let r = await api('POST', '/boards', { name: 'ZZ_Dep_' + Date.now(), visibility: 'private' }, tok);
  const board = r.data; ok(r.code === 201, 'create board');
  const groupId = board.groups[0].id;

  // timeline (schedule) column
  const tl = (await api('POST', '/columns', { board_id: board.id, title: 'Schedule', type: 'timeline' }, tok)).data;
  // dependency column referencing the timeline
  const dep = (await api('POST', '/columns', { board_id: board.id, title: 'Depends on', type: 'dependency', settings: { boardId: board.id, scheduleColumnId: tl.id, autoShift: true, lag: 0 } }, tok)).data;

  // 4 tasks A,B,C,D
  const mk = async (name) => (await api('POST', '/items', { group_id: groupId, name }, tok)).data;
  const A = await mk('A'), B = await mk('B'), C = await mk('C'), D = await mk('D');
  const setTL = (it, s, e) => api('POST', '/column-values/upsert', { item_id: it.id, column_id: tl.id, value: `${s} → ${e}` }, tok);
  const setDep = (it, preds) => api('POST', '/column-values/upsert', { item_id: it.id, column_id: dep.id, value: JSON.stringify(preds) }, tok);

  // taut sequential schedule: A→B→{C,D}
  await setTL(A, '2026-01-01', '2026-01-05');
  await setTL(B, '2026-01-06', '2026-01-10');
  await setTL(C, '2026-01-11', '2026-01-12');
  await setTL(D, '2026-01-11', '2026-01-16');
  await setDep(B, [A.id]);
  await setDep(C, [B.id]);
  await setDep(D, [B.id]);
  ok(true, 'created A,B,C,D with chain A→B→{C,D}');

  const getTL = async (id) => {
    const full = (await api('GET', '/boards/' + board.id, null, tok)).data;
    const it = full.groups.flatMap(g => g.items).find(x => x.id === id);
    return it.values[tl.id];
  };

  section('auto-shift on slip');
  // Slip A to end 2026-01-20 → B,C,D must cascade forward (push-only).
  const slip = await api('POST', '/column-values/upsert', { item_id: A.id, column_id: tl.id, value: '2026-01-01 → 2026-01-20' }, tok);
  const shifts = slip.data.dependencyShifts || [];
  ok(shifts.length === 3, 'slip returns 3 dependency shifts (got ' + shifts.length + ')');
  ok(await getTL(B.id) === '2026-01-21 → 2026-01-25', 'B pushed to 01-21→01-25 (span preserved) [' + await getTL(B.id) + ']');
  ok(await getTL(C.id) === '2026-01-26 → 2026-01-27', 'C pushed to 01-26→01-27 [' + await getTL(C.id) + ']');
  ok(await getTL(D.id) === '2026-01-26 → 2026-01-31', 'D pushed to 01-26→01-31 [' + await getTL(D.id) + ']');

  section('push-only (no compression)');
  // Pull A earlier (end 01-03). B currently 01-21; minStart would be 01-04 < 01-21 → no change.
  await api('POST', '/column-values/upsert', { item_id: A.id, column_id: tl.id, value: '2026-01-01 → 2026-01-03' }, tok);
  ok(await getTL(B.id) === '2026-01-21 → 2026-01-25', 'pulling A earlier does NOT compress B (push-only)');

  section('critical path');
  // durations now: A(01-01..01-03)=3, B=5, C=2, D=6. Longest A→B→D=14 vs A→B→C=10.
  const full = (await api('GET', '/boards/' + board.id, null, tok)).data;
  const idName = {}; [A, B, C, D].forEach(t => idName[t.id] = t.name);
  const cp = (full.criticalPath || []).map(id => idName[id] || id);
  ok(JSON.stringify(cp) === JSON.stringify(['A', 'B', 'D']), 'critical path = A→B→D (got ' + JSON.stringify(cp) + ')');
  ok(full.scheduleColumnId === tl.id, 'board exposes scheduleColumnId');

  section('cycle safety');
  await setDep(A, [C.id]); // A←C←B←A  cycle
  const cyc = await api('POST', '/column-values/upsert', { item_id: A.id, column_id: tl.id, value: '2026-01-01 → 2026-01-04' }, tok);
  ok(cyc.code === 200, 'timeline edit under a cycle still succeeds (no crash)');
  ok((cyc.data.dependencyShifts || []).length === 0, 'cycle → no shifts');
  const full2 = (await api('GET', '/boards/' + board.id, null, tok)).data;
  ok(Array.isArray(full2.criticalPath) && full2.criticalPath.length === 0, 'cycle → critical path empty (no crash)');
  await setDep(A, []); // undo cycle

  section('autoShift = false');
  await api('PUT', '/columns/' + dep.id, { title: 'Depends on', settings: { boardId: board.id, scheduleColumnId: tl.id, autoShift: false, lag: 0 } }, tok);
  const before = await getTL(C.id);
  await api('POST', '/column-values/upsert', { item_id: B.id, column_id: tl.id, value: '2026-03-01 → 2026-03-10' }, tok);
  ok(await getTL(C.id) === before, 'autoShift=false → dependents do NOT move');

  section('cleanup');
  await api('DELETE', '/boards/' + board.id, null, tok);
  console.log('  deleted test board');

  console.log('\n══════════════════════════════════');
  console.log(`  RESULT: ${pass} passed, ${fail} failed`);
  console.log('══════════════════════════════════');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
