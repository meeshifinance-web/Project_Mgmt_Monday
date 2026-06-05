/**
 * Comprehensive per-column-type verification. Spins up a throwaway board with
 * one column of every type, exercises valid + invalid input through the real
 * API (validation, clamping, normalisation, clearing), then deletes the board.
 *   node backend/scripts/column-verify.js
 */
const ax = require('axios');
const B = 'http://localhost:3001/api';
let pass = 0, fail = 0;
const ck = (n, c, d = '') => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.log('  ❌', n, d); } };

async function main() {
  const r = await ax.post(`${B}/auth/login`, { email: 'admin@simplixart.com', password: 'Admin@1234' }, { validateStatus: () => true });
  const A = ax.create({ baseURL: B, headers: { Authorization: `Bearer ${r.data.token}` }, validateStatus: () => true });

  // throwaway board
  const board = (await A.post('/boards', { name: 'ZZ Column Verify', visibility: 'private' })).data;
  const bid = board.id;
  const itemId = board.groups[0].items[0].id;
  const col = {};
  const add = async (title, type, settings = {}) => {
    const c = (await A.post('/columns', { board_id: bid, title, type, settings })).data;
    col[type] = c.id; return c;
  };
  // add one column of each remaining type (board already has status/person/date)
  for (const [t, s] of [
    ['dropdown', { options: ['Low', 'High'] }], ['text', {}], ['number', {}], ['file', {}],
    ['checkbox', {}], ['priority', { options: [{ label: 'Low' }, { label: 'High' }] }],
    ['timeline', {}], ['rating', {}], ['long_text', {}], ['link', {}], ['email', {}],
    ['phone', {}], ['progress', {}], ['tags', {}], ['color_picker', {}],
    ['time_tracking', {}], ['location', {}], ['creation_log', {}],
    ['formula', { formula: '{Number} * 2' }],
  ]) await add(t.charAt(0).toUpperCase() + t.slice(1), t, s);
  // capture the auto-created columns too
  for (const c of (await A.get(`/boards/${bid}`)).data.columns) col[c.type] = col[c.type] || c.id;

  const set = (type, value) => A.post('/column-values/upsert', { item_id: itemId, column_id: col[type], value });
  const okVal = async (type, value, expect) => { const res = await set(type, value); return res.status === 200 && (expect === undefined || res.data.value.value === expect); };
  const rej = async (type, value) => (await set(type, value)).status === 400;

  console.log('\n— Validation / normalisation —');
  // number
  ck('number accepts 42.5', await okVal('number', '42.5', '42.5'));
  ck('number rejects "banana"', await rej('number', 'banana'));
  ck('number rejects Infinity', await rej('number', 'Infinity'));
  ck('number rejects NaN', await rej('number', 'NaN'));
  // date
  ck('date accepts valid', await okVal('date', '2026-06-15', '2026-06-15'));
  ck('date rejects impossible 2026-02-30', await rej('date', '2026-02-30'));
  ck('date rejects 2026-13-01', await rej('date', '2026-13-01'));
  // email
  ck('email accepts a@b.com', await okVal('email', 'a@b.com'));
  ck('email rejects "nope"', await rej('email', 'nope'));
  // phone (10-digit cap)
  ck('phone accepts 10 digits', await okVal('phone', '9820011223'));
  ck('phone rejects 11 digits', await rej('phone', '98200112234'));
  ck('phone rejects letters', await rej('phone', 'callme'));
  // rating clamp
  ck('rating 999 → 5', await okVal('rating', '999', '5'));
  ck('rating -2 → 0', await okVal('rating', '-2', '0'));
  ck('rating 3 → 3', await okVal('rating', '3', '3'));
  // progress clamp
  ck('progress 5000 → 100', await okVal('progress', '5000', '100'));
  ck('progress -5 → 0', await okVal('progress', '-5', '0'));
  ck('progress 50 → 50', await okVal('progress', '50', '50'));
  // checkbox
  ck('checkbox "true" → true', await okVal('checkbox', 'true', 'true'));
  ck('checkbox garbage → false', await okVal('checkbox', 'zzz', 'false'));
  // color_picker
  ck('color #ff0000 accepted', await okVal('color_picker', '#ff0000', '#ff0000'));
  ck('color "red" rejected', await rej('color_picker', 'red'));
  // link
  ck('link javascript: rejected (XSS)', await rej('link', 'javascript:alert(1)'));
  ck('link bare host → https://', await okVal('link', 'example.com', 'https://example.com'));
  ck('link full url kept', await okVal('link', 'https://x.com/y', 'https://x.com/y'));
  // timeline
  ck('timeline valid range accepted', await okVal('timeline', '2026-05-01 → 2026-06-01'));
  ck('timeline end<start rejected', await rej('timeline', '2026-06-01 → 2026-05-01'));
  // tags dedup
  ck('tags de-duped "a, a, b" → "a, b"', await okVal('tags', 'a, a, b', 'a, b'));

  console.log('\n— Clearing (every type accepts empty) —');
  for (const t of ['number', 'date', 'email', 'phone', 'rating', 'progress', 'checkbox', 'color_picker', 'link', 'timeline', 'tags', 'text', 'long_text'])
    ck(`${t} clears to empty`, await okVal(t, '', ''));

  console.log('\n— Pass-through types accept values —');
  ck('text accepts value', await okVal('text', 'hello world'));
  ck('long_text accepts value', await okVal('long_text', 'a long note'));
  ck('status accepts a label', await okVal('status', 'Done'));
  ck('dropdown accepts JSON array', await okVal('dropdown', JSON.stringify(['High'])));
  ck('person accepts JSON array', await okVal('person', JSON.stringify(['Admin'])));
  ck('file accepts JSON', await okVal('file', JSON.stringify([{ name: 'x.txt', url: '/api/files/x.txt' }])));
  ck('location accepts text', await okVal('location', 'Mumbai HQ'));
  ck('time_tracking accepts text', await okVal('time_tracking', '3h 20m'));
  ck('priority accepts label', await okVal('priority', 'High'));

  console.log('\n— Length caps —');
  ck('text > 5000 chars rejected', await rej('text', 'x'.repeat(5001)));
  ck('long_text accepts 6000 (cap 20000)', await okVal('long_text', 'y'.repeat(6000)));
  ck('long_text > 20000 rejected', await rej('long_text', 'z'.repeat(20001)));

  console.log('\n— Column create guards —');
  ck('unknown column type rejected', (await A.post('/columns', { board_id: bid, title: 'X', type: 'bogus' })).status === 400);
  ck('empty column title rejected', (await A.post('/columns', { board_id: bid, title: '  ', type: 'text' })).status === 400);

  // cleanup
  await A.delete(`/boards/${bid}`);
  console.log(`\n══════════════\nPASS ${pass}   FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(2); });
