const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireAuth, canAccessBoard } = require('../middleware/auth');
const { requireScope } = require('../middleware/apiAuth');
const { notifyCommentRecipients } = require('../services/commentEmail');

// Helper: create notifications for an array of user IDs
async function createNotifications(notifications) {
  if (!notifications.length) return;
  for (const n of notifications) {
    try {
      await pool.query(
        `INSERT INTO notifications (user_id, from_user_id, from_user_name, item_id, item_name, board_id, board_name, comment_id, message)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [n.user_id, n.from_user_id, n.from_user_name, n.item_id, n.item_name, n.board_id, n.board_name, n.comment_id, n.message]
      );
    } catch { /* don't fail the whole request */ }
  }
}

// Helper: resolve board_id from an item (used for access checks)
async function boardIdFromItem(itemId) {
  const res = await pool.query(
    `SELECT g.board_id FROM items i JOIN groups g ON g.id = i.group_id WHERE i.id = $1`,
    [itemId]
  );
  return res.rows[0]?.board_id ?? null;
}

// GET all comments for an item (flat list — client nests them)
router.get('/item/:itemId', requireAuth, async (req, res) => {
  try {
    const board_id = await boardIdFromItem(req.params.itemId);
    if (board_id === null) return res.status(404).json({ error: 'Item not found' });

    if (!(await canAccessBoard(board_id, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    const { rows } = await pool.query(
      `SELECT * FROM comments WHERE item_id=$1 ORDER BY created_at ASC`,
      [req.params.itemId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST a new comment (supports parent_id for replies, and mentions array)
router.post('/', requireAuth, requireScope('write'), async (req, res) => {
  const { item_id, board_id, body, parent_id, mentions = [] } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Comment body required' });
  const COMMENT_MAX = 5000;
  if (body.length > COMMENT_MAX)
    return res.status(400).json({ error: `Comment too long (max ${COMMENT_MAX} characters)` });

  try {
    // Resolve board from the item (do not trust board_id from the request body)
    const resolvedBoardId = await boardIdFromItem(item_id);
    if (resolvedBoardId === null) return res.status(404).json({ error: 'Item not found' });

    if (!(await canAccessBoard(resolvedBoardId, req.user, pool)))
      return res.status(403).json({ error: 'Access denied' });

    // Validate @mentions: keep only real, active users who can actually see this
    // board. Previously a mention of a non-existent user id was accepted and
    // created a dangling notification.
    let validMentions = [];
    const mentionIds = (Array.isArray(mentions) ? mentions : []).map(Number).filter(Number.isInteger);
    if (mentionIds.length) {
      const ures = await pool.query('SELECT id, role FROM users WHERE id = ANY($1) AND is_active = true', [mentionIds]);
      for (const u of ures.rows) {
        if (await canAccessBoard(resolvedBoardId, { id: u.id, role: u.role }, pool)) validMentions.push(u.id);
      }
    }

    // Fetch item name + board name for notification messages
    const itemRow = await pool.query('SELECT name FROM items WHERE id=$1', [item_id]);
    const itemName = itemRow.rows[0]?.name || 'an item';
    const boardRow = await pool.query('SELECT name FROM boards WHERE id=$1', [resolvedBoardId]);
    const boardName = boardRow.rows[0]?.name || 'a board';

    // Insert comment
    const { rows } = await pool.query(
      `INSERT INTO comments (item_id, board_id, user_id, user_name, body, parent_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [item_id, resolvedBoardId, req.user.id, req.user.name, body.trim(), parent_id || null]
    );
    const comment = rows[0];

    // Build notifications list
    const notifBatch = [];
    const notifiedUserIds = new Set();

    // 1. @mention notifications
    for (const mentionedUserId of validMentions) {
      if (mentionedUserId === req.user.id) continue; // don't notify yourself
      if (notifiedUserIds.has(mentionedUserId)) continue;
      notifiedUserIds.add(mentionedUserId);
      notifBatch.push({
        user_id: mentionedUserId,
        from_user_id: req.user.id,
        from_user_name: req.user.name,
        item_id,
        item_name: itemName,
        board_id: resolvedBoardId,
        board_name: boardName,
        comment_id: comment.id,
        message: `${req.user.name} mentioned you in "${itemName}"`,
      });
    }

    // 2. Reply notification — notify the parent comment's author
    if (parent_id) {
      const parentRow = await pool.query('SELECT user_id, user_name FROM comments WHERE id=$1', [parent_id]);
      const parentAuthorId = parentRow.rows[0]?.user_id;
      if (parentAuthorId && parentAuthorId !== req.user.id && !notifiedUserIds.has(parentAuthorId)) {
        notifiedUserIds.add(parentAuthorId);
        notifBatch.push({
          user_id: parentAuthorId,
          from_user_id: req.user.id,
          from_user_name: req.user.name,
          item_id,
          item_name: itemName,
          board_id: resolvedBoardId,
          board_name: boardName,
          comment_id: comment.id,
          message: `${req.user.name} replied to your comment on "${itemName}"`,
        });
      }
    }

    await createNotifications(notifBatch);

    // ── Email the same people we just notified in-app (mentions + reply author).
    // Fire-and-forget so the POST stays fast; no-ops cleanly if SMTP is off.
    if (notifBatch.length) {
      const reasonById = new Map();
      for (const n of notifBatch) {
        reasonById.set(n.user_id, n.message.includes('replied') ? 'reply' : 'mention');
      }
      const ids = [...reasonById.keys()];
      const usersQ = pool.query(
        `SELECT id, name, email FROM users
          WHERE id = ANY($1) AND is_active = true AND email IS NOT NULL AND email <> ''`,
        [ids]
      );
      const groupQ = pool.query(
        `SELECT g.name FROM items i JOIN groups g ON g.id = i.group_id WHERE i.id = $1`,
        [item_id]
      );
      Promise.all([usersQ, groupQ]).then(([ures, gres]) => {
        const recipients = ures.rows.map(u => ({ id: u.id, name: u.name, email: u.email, reason: reasonById.get(u.id) }));
        if (!recipients.length) return;
        return notifyCommentRecipients({
          recipients,
          actorName: req.user.name,
          itemId: parseInt(item_id),
          boardId: resolvedBoardId,
          itemName,
          boardName,
          groupName: gres.rows[0]?.name || '',
          commentBody: body.trim(),
        });
      }).catch(err => console.error('[CommentEmail] async error:', err.message));
    }

    res.json(comment);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE a comment (author or admin only); also removes replies
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM comments WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    await pool.query('DELETE FROM comments WHERE id=$1 OR parent_id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
