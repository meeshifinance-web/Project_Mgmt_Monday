// Rigorous functional + edge-case test for Connect Boards / Mirror / Rollup.
// Creates throwaway boards, exercises the pipeline, asserts, then cleans up.
require('dotenv').config();
const jwt = require('jsonwebtoken');
const pool = require('./../db');
const http = require('http');

function api(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({
      host: 'localhost', port: 3001, path: '/api' + path, method,
      headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}), Authorization: 'Bearer ' + token },
    }, resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => { let j; try { j = JSON.parse(d); } catch { j = d; } resolve({ code: resp.statusCode, data: j }); }); });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

let pass = 0, fail = 0;
const ok = (cond, msg) => { (cond ? pass++ : fail++); console.log((cond ? '  ✅' : '  ❌ FAIL') + ' ' + msg); };
const section = (s) => console.log('\n── ' + s + ' ' + '─'.repeat(Math.max(0, 50 - s.length)));

(async () => {
  const admin = (await pool.query("SELECT id,name,role FROM users WHERE role='admin' AND is_active=true LIMIT 1")).rows[0];
  const nonAdmin = (await pool.query("SELECT id,name,role FROM users WHERE role <> 'admin' AND is_active=true ORDER BY id LIMIT 1")).rows[0];
  const tok = jwt.sign({ id: admin.id, name: admin.name, role: admin.role }, process.env.JWT_SECRET, { expiresIn: '15m' });

  const trash = { boards: [] };
  const colsOf = (b) => b.columns;
  const itemsOf = (b) => b.groups.flatMap(g => g.items);

  // ── Build target board B ────────────────────────────────────────────────────
  section('setup');
  let r = await api('POST', '/boards', { name: 'ZZ_Target_' + Date.now(), visibility: 'private' }, tok);
  const B = r.data; trash.boards.push(B.id);
  ok(r.code === 201, 'create target board B');
  const bItems = itemsOf(B);                 // 3 default items
  const bStatus = colsOf(B).find(c => c.type === 'status');
  // number col on B
  r = await api('POST', '/columns', { board_id: B.id, title: 'Effort', type: 'number' }, tok);
  const bNum = r.data;
  // set statuses + numbers: item0=Done/10, item1=Stuck/5, item2=(blank)/5
  await api('POST', '/column-values/upsert', { item_id: bItems[0].id, column_id: bStatus.id, value: 'Done' }, tok);
  await api('POST', '/column-values/upsert', { item_id: bItems[1].id, column_id: bStatus.id, value: 'Stuck' }, tok);
  // POST /boards seeds a default status on every item — explicitly clear item2's
  // so the "empty values are skipped" assertions are meaningful.
  await api('POST', '/column-values/upsert', { item_id: bItems[2].id, column_id: bStatus.id, value: '' }, tok);
  await api('POST', '/column-values/upsert', { item_id: bItems[0].id, column_id: bNum.id, value: '10' }, tok);
  await api('POST', '/column-values/upsert', { item_id: bItems[1].id, column_id: bNum.id, value: '5' }, tok);
  await api('POST', '/column-values/upsert', { item_id: bItems[2].id, column_id: bNum.id, value: '5' }, tok);

  // ── Build source board A ────────────────────────────────────────────────────
  r = await api('POST', '/boards', { name: 'ZZ_Source_' + Date.now(), visibility: 'private' }, tok);
  const A = r.data; trash.boards.push(A.id);
  const aItem = itemsOf(A)[0];
  ok(r.code === 201, 'create source board A');

  // ── Connect column validation ───────────────────────────────────────────────
  section('connect: validation & normalisation');
  r = await api('POST', '/columns', { board_id: A.id, title: 'Linked', type: 'connect_boards', settings: { boardId: B.id, allowMultiple: true } }, tok);
  const linkCol = r.data;
  ok(r.code === 201 && linkCol.type === 'connect_boards', 'create connect column (multi)');

  // link all 3 B items, with a duplicate id to test dedupe
  r = await api('POST', '/column-values/upsert', { item_id: aItem.id, column_id: linkCol.id, value: JSON.stringify([bItems[0].id, bItems[1].id, bItems[2].id, bItems[0].id]) }, tok);
  ok(r.code === 200 && JSON.parse(r.data.value.value).length === 3, 'dedupes repeated ids (4→3)');

  // garbage / non-array rejected
  r = await api('POST', '/column-values/upsert', { item_id: aItem.id, column_id: linkCol.id, value: 'not-json' }, tok);
  ok(r.code === 400, 'rejects non-JSON connect value (' + r.code + ')');
  r = await api('POST', '/column-values/upsert', { item_id: aItem.id, column_id: linkCol.id, value: '{"a":1}' }, tok);
  ok(r.code === 400, 'rejects non-array connect value (' + r.code + ')');
  // restore the 3 links (previous rejects didn't change stored value)
  await api('POST', '/column-values/upsert', { item_id: aItem.id, column_id: linkCol.id, value: JSON.stringify([bItems[0].id, bItems[1].id, bItems[2].id]) }, tok);

  // allowMultiple=false keeps only first
  r = await api('POST', '/columns', { board_id: A.id, title: 'LinkedOne', type: 'connect_boards', settings: { boardId: B.id, allowMultiple: false } }, tok);
  const linkOne = r.data;
  r = await api('POST', '/column-values/upsert', { item_id: aItem.id, column_id: linkOne.id, value: JSON.stringify([bItems[0].id, bItems[1].id]) }, tok);
  ok(r.code === 200 && JSON.parse(r.data.value.value).length === 1, 'allowMultiple=false keeps single link');

  // link to a non-existent item id — stored, resolver must not crash
  r = await api('POST', '/columns', { board_id: A.id, title: 'LinkGhost', type: 'connect_boards', settings: { boardId: B.id, allowMultiple: true } }, tok);
  const linkGhost = r.data;
  await api('POST', '/column-values/upsert', { item_id: aItem.id, column_id: linkGhost.id, value: JSON.stringify([999999999]) }, tok);

  // ── Mirror ──────────────────────────────────────────────────────────────────
  section('mirror');
  r = await api('POST', '/columns', { board_id: A.id, title: 'M_Status', type: 'mirror', settings: { connectColumnId: linkCol.id, sourceColumnId: bStatus.id } }, tok);
  const mStatus = r.data;
  r = await api('POST', '/columns', { board_id: A.id, title: 'M_Effort', type: 'mirror', settings: { connectColumnId: linkCol.id, sourceColumnId: bNum.id } }, tok);
  const mNum = r.data;
  // misconfigured: connectColumnId points at a non-connect column
  r = await api('POST', '/columns', { board_id: A.id, title: 'M_Bad', type: 'mirror', settings: { connectColumnId: 9999999, sourceColumnId: bStatus.id } }, tok);
  const mBad = r.data;

  const getA = async () => (await api('GET', '/boards/' + A.id, null, tok)).data;
  let full = await getA();
  let it = itemsOf(full).find(i => i.id === aItem.id);
  const mStatusVal = (() => { try { return JSON.parse(it.values[mStatus.id]); } catch { return null; } })();
  ok(mStatusVal && mStatusVal.items.length === 2 && mStatusVal.type === 'status', 'mirror(status): 2 non-empty statuses (item2 blank skipped)');
  ok((mStatusVal?.items || []).some(x => x.v === 'Done' && x.color === '#00c875'), 'mirror(status): carries option colour');
  const mNumVal = (() => { try { return JSON.parse(it.values[mNum.id]); } catch { return null; } })();
  ok(mNumVal && mNumVal.items.length === 3, 'mirror(number): all 3 values present');
  ok(it.values[mBad.id] === '' , 'mirror through bad connection → empty');
  ok(full.linkedItems && full.linkedItems[bItems[0].id]?.name === bItems[0].name, 'linkedItems resolves cross-board names');
  ok(full.linkedItems[bItems[0].id]?.board_id === B.id, 'linkedItems carries source board id');
  // edit-through-mirror payload
  ok(mStatusVal && mStatusVal.colId === bStatus.id, 'mirror payload carries source colId (for edit-through)');
  ok(mStatusVal && Array.isArray(mStatusVal.opts) && mStatusVal.opts.length > 0, 'mirror payload carries source status options');
  ok((mStatusVal?.items || []).every(x => Number.isInteger(x.id)), 'mirror entries carry linked item id');

  section('mirror: edit-through-mirror');
  const editTarget = mStatusVal.items.find(x => x.v === 'Stuck');
  // the cell writes the new label to the SOURCE item via payload.colId
  let er = await api('POST', '/column-values/upsert', { item_id: editTarget.id, column_id: mStatusVal.colId, value: 'Review' }, tok);
  ok(er.code === 200, 'write via mirror.colId to source item accepted (' + er.code + ')');
  full = await getA(); it = itemsOf(full).find(i => i.id === aItem.id);
  const editedMirror = JSON.parse(it.values[mStatus.id]);
  ok(editedMirror.items.some(x => x.v === 'Review'), 'edit-through-mirror reflects new source value');
  // confirm it actually changed the source board B item
  const bCheck = (await api('GET', '/boards/' + B.id, null, tok)).data.groups.flatMap(g => g.items).find(i => i.id === editTarget.id);
  ok(bCheck.values[bStatus.id] === 'Review', 'source item on board B was updated');

  // ── Mirror live update ──────────────────────────────────────────────────────
  section('mirror: live reflection');
  await api('POST', '/column-values/upsert', { item_id: bItems[0].id, column_id: bStatus.id, value: 'In Progress' }, tok);
  full = await getA(); it = itemsOf(full).find(i => i.id === aItem.id);
  const after = JSON.parse(it.values[mStatus.id]);
  ok(after.items.some(x => x.v === 'In Progress'), 'mirror reflects source status change without touching board A');

  // ── Rollup aggregates ───────────────────────────────────────────────────────
  section('rollup: aggregate functions');
  const mkRollup = async (fn) => {
    const rr = await api('POST', '/columns', { board_id: A.id, title: 'R_' + fn, type: 'rollup', settings: { connectColumnId: linkCol.id, sourceColumnId: bNum.id, fn } }, tok);
    return rr.data;
  };
  const rollups = {};
  for (const fn of ['sum', 'avg', 'min', 'max', 'median', 'count', 'count_filled', 'count_unique']) rollups[fn] = await mkRollup(fn);
  full = await getA(); it = itemsOf(full).find(i => i.id === aItem.id);
  const rv = (fn) => it.values[rollups[fn].id];
  // numbers across the 3 linked B items = [10,5,5]
  ok(rv('sum') === '20', 'rollup sum = 20 (got ' + rv('sum') + ')');
  ok(rv('avg') === '6.67', 'rollup avg = 6.67 (got ' + rv('avg') + ')');
  ok(rv('min') === '5', 'rollup min = 5 (got ' + rv('min') + ')');
  ok(rv('max') === '10', 'rollup max = 10 (got ' + rv('max') + ')');
  ok(rv('median') === '5', 'rollup median = 5 (got ' + rv('median') + ')');
  ok(rv('count') === '3', 'rollup count(links) = 3 (got ' + rv('count') + ')');
  ok(rv('count_filled') === '3', 'rollup count_filled = 3 (got ' + rv('count_filled') + ')');
  ok(rv('count_unique') === '2', 'rollup count_unique = 2 [10,5,5] (got ' + rv('count_unique') + ')');

  // rollup over a non-numeric source (status) with sum → empty; count still works
  let rr = await api('POST', '/columns', { board_id: A.id, title: 'R_badsum', type: 'rollup', settings: { connectColumnId: linkCol.id, sourceColumnId: bStatus.id, fn: 'sum' } }, tok);
  const rBadSum = rr.data;
  rr = await api('POST', '/columns', { board_id: A.id, title: 'R_statcount', type: 'rollup', settings: { connectColumnId: linkCol.id, sourceColumnId: bStatus.id, fn: 'count_filled' } }, tok);
  const rStatCount = rr.data;
  full = await getA(); it = itemsOf(full).find(i => i.id === aItem.id);
  ok(it.values[rBadSum.id] === '', 'rollup sum over non-numeric → empty');
  ok(it.values[rStatCount.id] === '2', 'rollup count_filled over status = 2 (item2 blank) (got ' + it.values[rStatCount.id] + ')');

  // rollup live update
  await api('POST', '/column-values/upsert', { item_id: bItems[2].id, column_id: bNum.id, value: '100' }, tok);
  full = await getA(); it = itemsOf(full).find(i => i.id === aItem.id);
  ok(it.values[rollups['sum'].id] === '115', 'rollup sum live-updates 20→115 (got ' + it.values[rollups['sum'].id] + ')');

  // ── Permission / data-leak check ────────────────────────────────────────────
  section('security: cross-board access');
  if (nonAdmin) {
    const ntok = jwt.sign({ id: nonAdmin.id, name: nonAdmin.name, role: nonAdmin.role }, process.env.JWT_SECRET, { expiresIn: '15m' });
    // non-admin is NOT a member of A → must be blocked
    let nr = await api('GET', '/boards/' + A.id, null, ntok);
    ok(nr.code === 403, 'non-member blocked from board A (' + nr.code + ')');
    // make them a member of A only (not B), then re-check what B data leaks
    await api('POST', '/boards/' + A.id + '/members', { email: (await pool.query('SELECT email FROM users WHERE id=$1', [nonAdmin.id])).rows[0].email }, tok);
    nr = await api('GET', '/boards/' + A.id, null, ntok);
    const li = nr.code === 200 && nr.data.linkedItems && nr.data.linkedItems[bItems[0].id];
    ok(li && li.restricted === true && li.name === '🔒 Restricted',
      'linked names from inaccessible board B are masked for A-only member (got "' + (li && li.name) + '")');
    const picker = await api('GET', '/connections/board/' + B.id + '/items', null, ntok);
    ok(picker.code === 403, 'connect picker on board B blocked for non-member (' + picker.code + ')');
  } else {
    console.log('  (skipped — no non-admin user in DB)');
  }

  // ── Date rollups ────────────────────────────────────────────────────────────
  section('rollup: date aggregates');
  // restore links to all 3 B items (security section left A-only member as a member; links unchanged)
  await api('POST', '/column-values/upsert', { item_id: aItem.id, column_id: linkCol.id, value: JSON.stringify([bItems[0].id, bItems[1].id, bItems[2].id]) }, tok);
  let dr = await api('POST', '/columns', { board_id: B.id, title: 'DueD', type: 'date' }, tok);
  const bDate = dr.data;
  await api('POST', '/column-values/upsert', { item_id: bItems[0].id, column_id: bDate.id, value: '2026-03-10' }, tok);
  await api('POST', '/column-values/upsert', { item_id: bItems[1].id, column_id: bDate.id, value: '2026-01-05' }, tok);
  await api('POST', '/column-values/upsert', { item_id: bItems[2].id, column_id: bDate.id, value: '2026-06-20' }, tok);
  const rEarliest = (await api('POST', '/columns', { board_id: A.id, title: 'R_earliest', type: 'rollup', settings: { connectColumnId: linkCol.id, sourceColumnId: bDate.id, fn: 'earliest' } }, tok)).data;
  const rLatest = (await api('POST', '/columns', { board_id: A.id, title: 'R_latest', type: 'rollup', settings: { connectColumnId: linkCol.id, sourceColumnId: bDate.id, fn: 'latest' } }, tok)).data;
  const rRange = (await api('POST', '/columns', { board_id: A.id, title: 'R_range', type: 'rollup', settings: { connectColumnId: linkCol.id, sourceColumnId: bDate.id, fn: 'range' } }, tok)).data;
  full = await getA(); it = itemsOf(full).find(i => i.id === aItem.id);
  ok(it.values[rEarliest.id] === '2026-01-05', 'rollup earliest date (got ' + it.values[rEarliest.id] + ')');
  ok(it.values[rLatest.id] === '2026-06-20', 'rollup latest date (got ' + it.values[rLatest.id] + ')');
  ok(it.values[rRange.id] === '2026-01-05 → 2026-06-20', 'rollup date range (got ' + it.values[rRange.id] + ')');

  // ── Two-way reciprocal links ────────────────────────────────────────────────
  section('two-way reciprocal link');
  let bFull = (await api('GET', '/boards/' + B.id, null, tok)).data;
  const recipCol = bFull.columns.find(c => c.type === 'connect_boards' && c.settings && c.settings.isReciprocal && c.settings.reciprocalColumnId === linkCol.id);
  ok(!!recipCol, 'reciprocal connect column auto-created on board B');
  const readRecip = async () => {
    const b0 = (await api('GET', '/boards/' + B.id, null, tok)).data.groups.flatMap(g => g.items).find(i => i.id === bItems[0].id);
    try { return JSON.parse(b0.values[recipCol.id] || '[]'); } catch { return []; }
  };
  ok((await readRecip()).includes(aItem.id), 'reciprocal value on B item lists the A item');
  // unlink B item0 on A → reciprocal on B should drop A item
  await api('POST', '/column-values/upsert', { item_id: aItem.id, column_id: linkCol.id, value: JSON.stringify([bItems[1].id, bItems[2].id]) }, tok);
  ok(!(await readRecip()).includes(aItem.id), 'unlinking on A removes the reciprocal link on B');
  // re-link → reappears
  await api('POST', '/column-values/upsert', { item_id: aItem.id, column_id: linkCol.id, value: JSON.stringify([bItems[0].id, bItems[1].id, bItems[2].id]) }, tok);
  ok((await readRecip()).includes(aItem.id), 're-linking on A restores the reciprocal link on B');
  // deleting the A connect column removes the reciprocal column on B
  await api('DELETE', '/columns/' + linkCol.id, null, tok);
  bFull = (await api('GET', '/boards/' + B.id, null, tok)).data;
  ok(!bFull.columns.find(c => c.id === recipCol.id), 'deleting A connect column removes B reciprocal column');

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  section('cleanup');
  for (const id of trash.boards) await api('DELETE', '/boards/' + id, null, tok);
  console.log('  deleted test boards');

  console.log('\n══════════════════════════════════');
  console.log(`  RESULT: ${pass} passed, ${fail} failed`);
  console.log('══════════════════════════════════');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
