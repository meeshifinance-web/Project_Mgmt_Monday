/**
 * email-capture-test.js
 *
 * End-to-end test for "create task from inbound email + capture sender
 * email & name into columns" — WITHOUT needing a real mailbox.
 *
 * It sets up a throwaway Email column, Text column and an enabled
 * `email_received → create_item_in_group` automation on your FIRST board,
 * pushes two synthetic emails through the real routeEmail() pipeline, asserts
 * the new items have the sender's email + name captured, then cleans up
 * everything it created (columns, automation, items, email log rows).
 *
 *   Run:  node backend/scripts/email-capture-test.js
 */
require('dotenv').config();
const pool = require('../db');
const { routeEmail } = require('../services/emailRouter');

let pass = 0, fail = 0;
const ck = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name, detail ? '— ' + detail : ''); }
};

const uid = Date.now();
const created = { columns: [], automation: null, items: [], messageIds: [] };

async function cellValue(itemId, columnId) {
  const r = await pool.query(
    'SELECT value FROM column_values WHERE item_id=$1 AND column_id=$2',
    [itemId, columnId]
  );
  return r.rows[0]?.value ?? null;
}

async function main() {
  // ── 1. Pick a board + group to test on ──────────────────────────────────────
  const board = (await pool.query('SELECT id, name FROM boards ORDER BY id LIMIT 1')).rows[0];
  if (!board) throw new Error('No boards exist — create a board first.');
  let group = (await pool.query(
    'SELECT id, name FROM groups WHERE board_id=$1 ORDER BY position, id LIMIT 1', [board.id]
  )).rows[0];
  if (!group) {
    group = (await pool.query(
      'INSERT INTO groups (board_id, name, position) VALUES ($1,$2,1) RETURNING id, name', [board.id, 'Inbox (test)']
    )).rows[0];
  }
  console.log(`\nBoard: "${board.name}" (#${board.id})   Group: "${group.name}" (#${group.id})\n`);

  // ── 2. Create throwaway Email + Text columns ────────────────────────────────
  const posBase = (await pool.query(
    'SELECT COALESCE(MAX(position),0) AS p FROM columns WHERE board_id=$1', [board.id]
  )).rows[0].p;
  const emailCol = (await pool.query(
    `INSERT INTO columns (board_id, title, type, settings, position)
     VALUES ($1,$2,'email','{}',$3) RETURNING id`,
    [board.id, `Sender Email (test ${uid})`, posBase + 1]
  )).rows[0];
  const nameCol = (await pool.query(
    `INSERT INTO columns (board_id, title, type, settings, position)
     VALUES ($1,$2,'text','{}',$3) RETURNING id`,
    [board.id, `Sender Name (test ${uid})`, posBase + 2]
  )).rows[0];
  created.columns.push(emailCol.id, nameCol.id);

  // ── 3. Create the email_received automation that captures both ───────────────
  const actionConfig = {
    group_id: group.id,
    from_email_column_id: emailCol.id,
    from_name_column_id: nameCol.id,
  };
  const auto = (await pool.query(
    `INSERT INTO automations
       (board_id, name, trigger_type, trigger_config, action_type, action_config, conditions, actions, enabled)
     VALUES ($1,$2,'email_received',$3,'create_item_in_group',$4,'[]',$5,true)
     RETURNING id`,
    [
      board.id,
      `Capture sender (test ${uid})`,
      JSON.stringify({ match_field: 'subject', keyword: `CAPTURE${uid}` }), // unique keyword so only OUR emails match
      JSON.stringify(actionConfig),
      JSON.stringify([{ type: 'create_item_in_group', config: actionConfig }]),
    ]
  )).rows[0];
  created.automation = auto.id;
  console.log(`Automation #${auto.id} created (keyword "CAPTURE${uid}").\n`);

  // ── 4. Push synthetic emails through the real pipeline ──────────────────────
  const mkEmail = (over) => ({
    messageId: `<${over.tag}.${uid}@test.local>`,
    inReplyTo: null, references: null,
    from: over.from,
    to: [{ address: 'support@yourcompany.test', name: 'Support' }],
    subject: `[TASK] ${over.subject} CAPTURE${uid}`,
    bodyText: over.body || 'Test body.', bodyHtml: '',
    receivedAt: new Date().toISOString(),
  });

  // Case A: sender sends NO display name → name derived from the address
  const emailA = mkEmail({
    tag: 'a', subject: 'No display name',
    from: { name: '', address: 'jane.doe88@Acme.COM' },
  });
  created.messageIds.push(emailA.messageId);
  const resA = await routeEmail(emailA);
  ck('Case A: item created', resA.action === 'created', JSON.stringify(resA));
  if (resA.itemId) {
    created.items.push(resA.itemId);
    ck('Case A: email captured + lowercased', await cellValue(resA.itemId, emailCol.id) === 'jane.doe88@acme.com',
       `got ${await cellValue(resA.itemId, emailCol.id)}`);
    ck('Case A: name derived from address = "Jane Doe"', await cellValue(resA.itemId, nameCol.id) === 'Jane Doe',
       `got ${await cellValue(resA.itemId, nameCol.id)}`);
  }

  // Case B: sender HAS a display name → that name is kept verbatim
  const emailB = mkEmail({
    tag: 'b', subject: 'With display name',
    from: { name: 'Robert King', address: 'rob.king@vendor.io' },
  });
  created.messageIds.push(emailB.messageId);
  const resB = await routeEmail(emailB);
  ck('Case B: item created', resB.action === 'created', JSON.stringify(resB));
  if (resB.itemId) {
    created.items.push(resB.itemId);
    ck('Case B: email captured', await cellValue(resB.itemId, emailCol.id) === 'rob.king@vendor.io',
       `got ${await cellValue(resB.itemId, emailCol.id)}`);
    ck('Case B: display name kept = "Robert King"', await cellValue(resB.itemId, nameCol.id) === 'Robert King',
       `got ${await cellValue(resB.itemId, nameCol.id)}`);
  }

  console.log(`\n${fail === 0 ? '✅ ALL PASSED' : '❌ SOME FAILED'}  (${pass} passed, ${fail} failed)\n`);
}

async function cleanup() {
  try {
    for (const id of created.items) {
      await pool.query('DELETE FROM column_values WHERE item_id=$1', [id]);
      await pool.query('DELETE FROM item_emails  WHERE item_id=$1', [id]);
      await pool.query('DELETE FROM items        WHERE id=$1', [id]);
    }
    if (created.automation) await pool.query('DELETE FROM automations WHERE id=$1', [created.automation]);
    for (const id of created.columns) {
      await pool.query('DELETE FROM column_values WHERE column_id=$1', [id]);
      await pool.query('DELETE FROM columns       WHERE id=$1', [id]);
    }
    if (created.messageIds.length)
      await pool.query('DELETE FROM email_seen_messages WHERE message_id = ANY($1)', [created.messageIds]);
    console.log('Cleaned up test data.');
  } catch (e) {
    console.warn('Cleanup warning:', e.message);
  }
}

main()
  .catch((e) => { fail++; console.error('\nERROR:', e.message); })
  .finally(async () => { await cleanup(); await pool.end(); process.exit(fail === 0 ? 0 : 1); });
