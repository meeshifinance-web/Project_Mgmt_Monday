/**
 * emailRouter.js
 *
 * Takes a normalized inbound email and dispatches it against enabled
 * `email_received` automations. On first match → create item in the
 * configured group, assign To-recipients as owners, log the email body
 * as the first item update. On reply (In-Reply-To matches a known
 * Message-ID) → append to the existing item instead.
 *
 * This file is the central dispatcher for the `email_received` trigger
 * (all other triggers are dispatched inline from their route handlers).
 */

const pool = require('../db');

// ── helpers ──────────────────────────────────────────────────────────────────

function cleanSubject(raw) {
  if (!raw) return '(No subject)';
  return String(raw)
    .replace(/^(re|fw|fwd)\s*:\s*/gi, '')   // strip leading Re:/Fw:/Fwd:
    .replace(/\[task\]/gi, '')              // strip [TASK] marker
    .trim() || '(No subject)';
}

function matchesFilter(email, cfg) {
  cfg = cfg || {};
  // Subject filter (keyword / match_field is the existing UI shape)
  const field = (cfg.match_field || 'subject').toLowerCase();
  const kw = (cfg.keyword || '').trim().toLowerCase();
  if (kw) {
    const subj = (email.subject || '').toLowerCase();
    const body = (email.bodyText || email.bodyHtml || '').toLowerCase();
    const target =
      field === 'body'   ? body  :
      field === 'either' ? subj + '\n' + body :
                           subj;
    if (!target.includes(kw)) return false;
  }
  // Optional from_contains filter (director email restriction)
  if (cfg.from_contains) {
    const from = (email.from?.address || '').toLowerCase();
    if (!from.includes(String(cfg.from_contains).toLowerCase())) return false;
  }
  return true;
}

async function findSystemUser() {
  const res = await pool.query(
    `SELECT id, name FROM users WHERE email = 'noreply+bot@ddecor.com' LIMIT 1`
  );
  return res.rows[0] || { id: null, name: 'Email Bot' };
}

async function findExistingThreadItem(email) {
  // Priority 1: in_reply_to matches any item's source_message_id
  if (email.inReplyTo) {
    const r = await pool.query(
      `SELECT i.id, g.board_id
         FROM items i JOIN groups g ON g.id = i.group_id
        WHERE i.source_message_id = $1 LIMIT 1`,
      [email.inReplyTo]
    );
    if (r.rows[0]) return r.rows[0];
  }
  // Priority 2: any token in References header matches
  if (email.references) {
    const refs = email.references.match(/<[^>]+>/g) || [];
    if (refs.length) {
      const r = await pool.query(
        `SELECT i.id, g.board_id
           FROM items i JOIN groups g ON g.id = i.group_id
          WHERE i.source_message_id = ANY($1) LIMIT 1`,
        [refs]
      );
      if (r.rows[0]) return r.rows[0];
    }
  }
  return null;
}

async function appendToExistingItem(itemId, boardId, email) {
  await pool.query(
    `INSERT INTO item_emails
       (item_id, board_id, direction, from_address, from_name,
        to_address, subject, body_text, body_html,
        message_id, in_reply_to, "references", received_at)
     VALUES ($1,$2,'incoming',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      itemId, boardId,
      email.from?.address || '',
      email.from?.name    || '',
      (email.to || []).map(t => t.address).join(', '),
      email.subject || '',
      email.bodyText || '',
      email.bodyHtml || '',
      email.messageId || null,
      email.inReplyTo || null,
      email.references || null,
      email.receivedAt || new Date().toISOString(),
    ]
  );
  return { action: 'appended', itemId };
}

async function createItemFromEmail({ automation, email, systemUser }) {
  const cfg = typeof automation.action_config === 'string'
    ? JSON.parse(automation.action_config)
    : (automation.action_config || {});

  const groupId = cfg.group_id;
  if (!groupId) throw new Error(`automation ${automation.id} has no group_id in action_config`);

  // Verify group belongs to this automation's board
  const gRes = await pool.query('SELECT board_id FROM groups WHERE id=$1', [groupId]);
  if (!gRes.rows.length) throw new Error(`group ${groupId} not found`);
  const boardId = gRes.rows[0].board_id;

  const itemName = cleanSubject(email.subject);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const posRes = await client.query(
      'SELECT COALESCE(MAX(position),0)+1 AS pos FROM items WHERE group_id=$1 AND parent_item_id IS NULL',
      [groupId]
    );
    const insertRes = await client.query(
      `INSERT INTO items
         (group_id, name, position, created_by_user_id, created_by_user_name, source_message_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [groupId, itemName, posRes.rows[0].pos, systemUser.id, systemUser.name, email.messageId || null]
    );
    const item = insertRes.rows[0];

    // Assign To-recipients to owner column (if configured)
    if (cfg.owner_column_id && Array.isArray(email.to) && email.to.length) {
      const toEmails = email.to.map(t => String(t.address || '').toLowerCase()).filter(Boolean);
      if (toEmails.length) {
        const uRes = await client.query(
          `SELECT name FROM users
            WHERE LOWER(email) = ANY($1) AND is_active = true`,
          [toEmails]
        );
        const names = uRes.rows.map(r => r.name);
        if (names.length) {
          await client.query(
            `INSERT INTO column_values (item_id, column_id, value)
             VALUES ($1,$2,$3)
             ON CONFLICT (item_id, column_id) DO UPDATE SET value=EXCLUDED.value`,
            [item.id, cfg.owner_column_id, JSON.stringify(names)]
          );
        }
      }
    }

    // Default status if configured
    if (cfg.status_column_id && cfg.status_value) {
      await client.query(
        `INSERT INTO column_values (item_id, column_id, value)
         VALUES ($1,$2,$3)
         ON CONFLICT (item_id, column_id) DO UPDATE SET value=EXCLUDED.value`,
        [item.id, cfg.status_column_id, cfg.status_value]
      );
    }

    // Store the email itself so the body is visible in the Updates tab
    await client.query(
      `INSERT INTO item_emails
         (item_id, board_id, direction, from_address, from_name,
          to_address, subject, body_text, body_html,
          message_id, in_reply_to, "references", received_at)
       VALUES ($1,$2,'incoming',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        item.id, boardId,
        email.from?.address || '',
        email.from?.name    || '',
        (email.to || []).map(t => t.address).join(', '),
        email.subject || '',
        email.bodyText || '',
        email.bodyHtml || '',
        email.messageId || null,
        email.inReplyTo || null,
        email.references || null,
        email.receivedAt || new Date().toISOString(),
      ]
    );

    // Activity log
    try {
      await client.query(
        `INSERT INTO activity_logs (board_id,user_id,user_name,item_id,item_name,action,field,old_value,new_value)
         VALUES ($1,$2,$3,$4,$5,'item_created','source',NULL,'email')`,
        [boardId, systemUser.id, systemUser.name, item.id, itemName]
      );
    } catch (_) { /* non-fatal */ }

    await client.query('COMMIT');
    return { action: 'created', itemId: item.id, boardId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Main entry — route a single inbound email.
 * Returns { action: 'created'|'appended'|'skipped', itemId?, boardId?, reason? }.
 * Never throws — caller (poller) expects a resolved promise.
 */
async function routeEmail(email) {
  try {
    // Dedup: already processed?
    if (email.messageId) {
      const seen = await pool.query(
        'SELECT 1 FROM email_seen_messages WHERE message_id = $1',
        [email.messageId]
      );
      if (seen.rows.length) return { action: 'skipped', reason: 'duplicate' };
    }

    // Threading: append to existing item if this is a reply
    const existing = await findExistingThreadItem(email);
    if (existing) {
      const out = await appendToExistingItem(existing.id, existing.board_id, email);
      if (email.messageId) {
        await pool.query(
          `INSERT INTO email_seen_messages (message_id, mailbox, result)
           VALUES ($1,$2,'appended') ON CONFLICT (message_id) DO NOTHING`,
          [email.messageId, process.env.EMAIL_M365_MAILBOX || null]
        );
      }
      return out;
    }

    // Match against enabled email_received automations across all boards
    const autoRes = await pool.query(
      "SELECT * FROM automations WHERE trigger_type='email_received' AND enabled=true"
    );
    if (!autoRes.rows.length) return { action: 'skipped', reason: 'no_rules' };

    const systemUser = await findSystemUser();

    for (const auto of autoRes.rows) {
      const tcfg = typeof auto.trigger_config === 'string'
        ? JSON.parse(auto.trigger_config)
        : (auto.trigger_config || {});
      if (!matchesFilter(email, tcfg)) continue;
      if (auto.action_type !== 'create_item_in_group') continue;

      const out = await createItemFromEmail({ automation: auto, email, systemUser });
      if (email.messageId) {
        await pool.query(
          `INSERT INTO email_seen_messages (message_id, mailbox, result)
           VALUES ($1,$2,'created') ON CONFLICT (message_id) DO NOTHING`,
          [email.messageId, process.env.EMAIL_M365_MAILBOX || null]
        );
      }
      return out;
    }

    // No rule matched
    if (email.messageId) {
      await pool.query(
        `INSERT INTO email_seen_messages (message_id, mailbox, result)
         VALUES ($1,$2,'skipped') ON CONFLICT (message_id) DO NOTHING`,
        [email.messageId, process.env.EMAIL_M365_MAILBOX || null]
      );
    }
    return { action: 'skipped', reason: 'no_match' };
  } catch (err) {
    console.error('[emailRouter] error:', err.message);
    if (email?.messageId) {
      try {
        await pool.query(
          `INSERT INTO email_seen_messages (message_id, mailbox, result)
           VALUES ($1,$2,'error') ON CONFLICT (message_id) DO NOTHING`,
          [email.messageId, process.env.EMAIL_M365_MAILBOX || null]
        );
      } catch (_) {}
    }
    return { action: 'skipped', reason: 'error', error: err.message };
  }
}

module.exports = { routeEmail };
