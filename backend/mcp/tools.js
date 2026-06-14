// ───────────────────────────────────────────────────────────────────────────
// Simplix MCP tool definitions.
//
// Each tool is a thin, well-described wrapper over the loopback REST client.
// The model reads the `description` + zod `inputSchema` to decide when/how to
// call a tool; the handler validates inputs, enforces the API key's board
// allow-list, performs the action via the user's own permissions, and returns
// a compact, paginated, size-capped result.
//
// Access model (defence in depth):
//   1. assertBoardAllowed()  — honours the API key's board_ids restriction.
//   2. canAccessBoard (REST) — board membership / org-wide / admin.
//   3. owner-visibility (REST board load) — per-item filtering for reads.
//   4. requireScope (REST)   — read / write / full gating for writes.
// A tool can therefore never reach data the user themselves cannot reach.
// ───────────────────────────────────────────────────────────────────────────

const { z } = require('zod');
const { callApi } = require('./loopback');
const {
  ToolError, ok, fail, truncate, clampPageSize,
  columnIndex, renderItemValues, renderCellValue, TEXT_TRUNC,
} = require('./format');

const { COLUMN_TYPES } = require('../services/columnValidate');
const COLUMN_TYPE_LIST = [...COLUMN_TYPES].join(', ');

// Hard caps so a single tool call can't fan out into a stampede of writes.
const MAX_VALUES_PER_ITEM = 50;
const MAX_ASSIGNEES = 50;

// ── Shared guards / helpers ────────────────────────────────────────────────────

// Enforce the API key's board allow-list before any board-scoped operation.
function assertBoardAllowed(ctx, boardId) {
  const ids = ctx.key && ctx.key.board_ids;
  if (Array.isArray(ids) && ids.length && !ids.includes(Number(boardId))) {
    throw new ToolError(
      `Your API key isn't authorized for board ${boardId}. It is limited to board(s): ${ids.join(', ')}.`
    );
  }
}

// Translate a raw access error from the board-load route into a clear,
// honest message that names the board (per the project's "clear errors" rule).
function boardAccessError(boardId, err) {
  if (err instanceof ToolError) {
    if (err.status === 403)
      return new ToolError(`You don't have access to board ${boardId} — you're not a member and it isn't org-wide. Ask a board owner to add you.`);
    if (err.status === 404)
      return new ToolError(`No board found with id ${boardId} (it may have been deleted).`);
  }
  return err;
}

// Load a board with all access + per-item visibility already applied by the
// REST layer. Returns the full board object (groups → visible items, columns,
// members). This is the same payload the web UI loads when opening a board.
async function loadBoard(ctx, boardId) {
  assertBoardAllowed(ctx, boardId);
  try {
    return await callApi(ctx.auth, 'get', `/boards/${Number(boardId)}`);
  } catch (err) {
    throw boardAccessError(boardId, err);
  }
}

// Flatten a board's visible top-level items (with their group name attached).
function flattenItems(board) {
  const items = [];
  for (const g of board.groups || []) {
    for (const it of g.items || []) {
      items.push({ ...it, _group_name: g.name, _group_id: g.id });
    }
  }
  return items;
}

// Wrap a handler so any thrown ToolError (or unexpected error) becomes a clean
// MCP error result instead of crashing the request.
function runTool(handler) {
  return async (args) => {
    try {
      return await handler(args || {});
    } catch (err) {
      if (err instanceof ToolError) return fail(err.message);
      console.error('[mcp tool] unexpected error:', err);
      const ref = Math.random().toString(36).slice(2, 8);
      return fail(`Simplix hit an internal error handling this request (ref: ${ref}). Nothing was changed.`);
    }
  };
}

// ── Tool registration ──────────────────────────────────────────────────────────

function registerTools(server, ctx, options = {}) {
  const reg = (name, def, handler) =>
    server.registerTool(name, def, runTool(handler));

  // ── whoami ──────────────────────────────────────────────────────────────────
  reg('whoami', {
    title: 'Who am I',
    description: 'Return the current Simplix user, role, and what this API key is allowed to do (scope and board restrictions). Call this first if you are unsure what you can access.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    const ids = ctx.key && ctx.key.board_ids;
    return ok({
      user: { id: ctx.user.id, name: ctx.user.name, email: ctx.user.email, role: ctx.user.role },
      api_key: {
        scope: ctx.key.scope,
        scope_meaning: { read: 'read only', write: 'read + create/edit', full: 'read + write + delete' }[ctx.key.scope],
        board_restriction: Array.isArray(ids) && ids.length ? ids : 'all boards this user can access',
      },
    });
  });

  // ── list_boards ──────────────────────────────────────────────────────────────
  reg('list_boards', {
    title: 'List boards',
    description: 'List the boards the current user can access (optionally filtered by a name search). Returns compact board summaries. Use get_board_schema to see a board\'s columns and groups.',
    inputSchema: {
      search: z.string().optional().describe('Case-insensitive substring to match against board names.'),
      page: z.number().int().positive().optional().describe('1-based page number (default 1).'),
      page_size: z.number().int().positive().optional().describe('Results per page (default 25, max 50).'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ search, page, page_size }) => {
    let boards = await callApi(ctx.auth, 'get', '/boards');
    const ids = ctx.key && ctx.key.board_ids;
    if (Array.isArray(ids) && ids.length) boards = boards.filter(b => ids.includes(b.id));
    if (search) {
      const q = String(search).toLowerCase();
      boards = boards.filter(b => (b.name || '').toLowerCase().includes(q));
    }
    const ps = clampPageSize(page_size);
    const pg = Math.max(1, parseInt(page, 10) || 1);
    const total = boards.length;
    const start = (pg - 1) * ps;
    const slice = boards.slice(start, start + ps).map(b => ({
      id: b.id,
      name: b.name,
      visibility: b.visibility,
      description: truncate(b.description, TEXT_TRUNC),
      favorite: !!b.is_favorite,
    }));
    return ok({ total, page: pg, page_size: ps, has_more: start + slice.length < total, boards: slice });
  });

  // ── get_board_schema ─────────────────────────────────────────────────────────
  reg('get_board_schema', {
    title: 'Get board schema',
    description: 'Get a board\'s structure: its columns (id, title, type, and any choice options) and its groups (id, name, item count). You need column ids and group ids from here before creating or updating items.',
    inputSchema: {
      board_id: z.number().int().positive().describe('The board id (from list_boards).'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ board_id }) => {
    const board = await loadBoard(ctx, board_id);
    const columns = (board.columns || []).map(c => {
      const s = typeof c.settings === 'string' ? safeParse(c.settings) : (c.settings || {});
      const out = { id: c.id, title: c.title, type: c.type };
      if (Array.isArray(s.options) && s.options.length) {
        out.options = s.options.map(o => (o && typeof o === 'object') ? (o.label ?? o.name ?? '') : o).filter(Boolean);
      }
      return out;
    });
    const groups = (board.groups || []).map(g => ({ id: g.id, name: g.name, item_count: (g.items || []).length }));
    return ok({
      board: { id: board.id, name: board.name, visibility: board.visibility, item_name: board.item_name || 'Item' },
      columns,
      groups,
      member_count: (board.members || []).length,
    });
  });

  // ── list_items ───────────────────────────────────────────────────────────────
  reg('list_items', {
    title: 'List / search items',
    description: 'List the items on a board that the current user is allowed to see, with their column values rendered as readable text. Optionally filter by group or search item names. Results are paginated to stay compact.',
    inputSchema: {
      board_id: z.number().int().positive().describe('The board id.'),
      group_id: z.number().int().positive().optional().describe('Only return items in this group.'),
      search: z.string().optional().describe('Case-insensitive substring to match against item names.'),
      page: z.number().int().positive().optional().describe('1-based page number (default 1).'),
      page_size: z.number().int().positive().optional().describe('Results per page (default 25, max 50).'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ board_id, group_id, search, page, page_size }) => {
    const board = await loadBoard(ctx, board_id);
    const colIdx = columnIndex(board.columns);
    let items = flattenItems(board);
    if (group_id) items = items.filter(i => i._group_id === Number(group_id));
    if (search) {
      const q = String(search).toLowerCase();
      items = items.filter(i => (i.name || '').toLowerCase().includes(q));
    }
    const ps = clampPageSize(page_size);
    const pg = Math.max(1, parseInt(page, 10) || 1);
    const total = items.length;
    const start = (pg - 1) * ps;
    const slice = items.slice(start, start + ps).map(i => ({
      id: i.id,
      name: i.name,
      group: i._group_name,
      values: renderItemValues(i.values, colIdx),
      subitem_count: (i.subitems || []).length,
    }));
    return ok({ board_id: Number(board_id), total, page: pg, page_size: ps, has_more: start + slice.length < total, items: slice });
  });

  // ── get_item ─────────────────────────────────────────────────────────────────
  reg('get_item', {
    title: 'Get item details',
    description: 'Get one item in full: every non-empty column value, its group, and its subitems. Returns a clear error if the item does not exist on that board or the user cannot see it.',
    inputSchema: {
      board_id: z.number().int().positive().describe('The board the item belongs to.'),
      item_id: z.number().int().positive().describe('The item id.'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ board_id, item_id }) => {
    const board = await loadBoard(ctx, board_id);
    const colIdx = columnIndex(board.columns);
    const items = flattenItems(board);
    const found = items.find(i => i.id === Number(item_id));
    if (!found) {
      // Also check subitems before declaring not-found.
      for (const i of items) {
        const sub = (i.subitems || []).find(s => s.id === Number(item_id));
        if (sub) {
          return ok({
            id: sub.id, name: sub.name, parent_item_id: i.id, parent_name: i.name,
            values: renderItemValues(sub.values, colIdx),
          });
        }
      }
      throw new ToolError(`No item with id ${item_id} on board ${board_id}, or you don't have access to it.`);
    }
    return ok({
      id: found.id,
      name: found.name,
      board_id: Number(board_id),
      group: found._group_name,
      group_id: found._group_id,
      created_by: found.created_by_user_name || null,
      created_at: found.created_at || null,
      comment_count: found.comment_count || 0,
      values: renderItemValues(found.values, colIdx),
      subitems: (found.subitems || []).map(s => ({ id: s.id, name: s.name, values: renderItemValues(s.values, colIdx) })),
    });
  });

  // ── list_board_members ───────────────────────────────────────────────────────
  reg('list_board_members', {
    title: 'List board members',
    description: 'List the members of a board (id, name, email, role). Use these ids with assign_people.',
    inputSchema: { board_id: z.number().int().positive().describe('The board id.') },
    annotations: { readOnlyHint: true },
  }, async ({ board_id }) => {
    assertBoardAllowed(ctx, board_id);
    let members;
    try {
      members = await callApi(ctx.auth, 'get', `/boards/${Number(board_id)}/members`);
    } catch (err) { throw boardAccessError(board_id, err); }
    return ok({ board_id: Number(board_id), members: members.map(m => ({ id: m.id, name: m.name, email: m.email, role: m.role, is_owner: !!m.is_owner })) });
  });

  // ── list_users ───────────────────────────────────────────────────────────────
  reg('list_users', {
    title: 'List / search users',
    description: 'Find users in the account by name or email (minimum 3 characters). Admins may omit the query to list everyone. Use this to discover who to assign work to.',
    inputSchema: {
      query: z.string().optional().describe('Name or email substring (min 3 chars). Required for non-admins.'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ query }) => {
    const q = (query || '').trim();
    if ((ctx.user.role === 'admin' || ctx.user.role === 'superadmin') && !q) {
      const users = await callApi(ctx.auth, 'get', '/auth/users');
      return ok({ count: users.length, users: users.slice(0, 100).map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role })) });
    }
    if (q.length < 3) throw new ToolError('Provide a search query of at least 3 characters (name or email).');
    const users = await callApi(ctx.auth, 'get', '/auth/users/search', { params: { q } });
    return ok({ count: users.length, users: users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role })) });
  });

  // ── get_updates ──────────────────────────────────────────────────────────────
  reg('get_updates', {
    title: 'Get item updates/comments',
    description: 'Read the updates (comments) posted on an item, oldest first.',
    inputSchema: {
      board_id: z.number().int().positive().describe('The board the item belongs to.'),
      item_id: z.number().int().positive().describe('The item id.'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ board_id, item_id }) => {
    assertBoardAllowed(ctx, board_id);
    let comments;
    try {
      comments = await callApi(ctx.auth, 'get', `/comments/item/${Number(item_id)}`);
    } catch (err) { throw boardAccessError(board_id, err); }
    return ok({
      item_id: Number(item_id),
      count: comments.length,
      updates: comments.slice(-50).map(c => ({ id: c.id, author: c.user_name, body: truncate(c.body, 500), at: c.created_at, reply_to: c.parent_id || null })),
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Write tools — all gated by the key's scope at the REST layer.
  // ════════════════════════════════════════════════════════════════════════════

  // ── create_item ──────────────────────────────────────────────────────────────
  reg('create_item', {
    title: 'Create item',
    description: 'Create a new item (row) in a group on a board, optionally setting column values in the same call. Get group_id and column ids from get_board_schema first. Requires write scope.',
    inputSchema: {
      board_id: z.number().int().positive().describe('The board id.'),
      group_id: z.number().int().positive().describe('The group to create the item in.'),
      name: z.string().min(1).max(255).describe('The item name/title.'),
      values: z.array(z.object({
        column_id: z.number().int().positive(),
        value: z.string().describe('The value as text. For status/dropdown use an exact option label; date is YYYY-MM-DD.'),
      })).max(MAX_VALUES_PER_ITEM).optional().describe('Optional column values to set on the new item.'),
    },
  }, async ({ board_id, group_id, name, values }) => {
    const board = await loadBoard(ctx, board_id); // validates access + lets us check group/columns
    const group = (board.groups || []).find(g => g.id === Number(group_id));
    if (!group) throw new ToolError(`Group ${group_id} is not on board ${board_id}.`);
    const colIdx = columnIndex(board.columns);
    for (const v of (values || [])) {
      if (!colIdx[v.column_id]) throw new ToolError(`Column ${v.column_id} is not on board ${board_id}.`);
    }

    const item = await callApi(ctx.auth, 'post', '/items', { data: { group_id: Number(group_id), name } });

    const applied = [];
    const failedValues = [];
    for (const v of (values || [])) {
      try {
        await callApi(ctx.auth, 'post', '/column-values/upsert', { data: { item_id: item.id, column_id: v.column_id, value: v.value } });
        applied.push(colIdx[v.column_id].title);
      } catch (err) {
        failedValues.push({ column: colIdx[v.column_id].title, reason: err.message });
      }
    }
    const result = { created: true, item: { id: item.id, name: item.name, group: group.name }, values_set: applied };
    if (failedValues.length) result.values_failed = failedValues;
    return ok(result);
  });

  // ── update_item ──────────────────────────────────────────────────────────────
  reg('update_item', {
    title: 'Update item column values',
    description: 'Set one or more column values on an existing item (e.g. change status, due date, text). Values are validated by column type and a clear error is returned per failed column. Requires write scope.',
    inputSchema: {
      board_id: z.number().int().positive().describe('The board the item belongs to.'),
      item_id: z.number().int().positive().describe('The item id.'),
      values: z.array(z.object({
        column_id: z.number().int().positive(),
        value: z.string().describe('New value as text. Empty string clears the cell. status/dropdown = exact option label; date = YYYY-MM-DD.'),
      })).min(1).max(MAX_VALUES_PER_ITEM).describe('The column values to set.'),
    },
  }, async ({ board_id, item_id, values }) => {
    assertBoardAllowed(ctx, board_id);
    const applied = [];
    const failed = [];
    for (const v of values) {
      try {
        await callApi(ctx.auth, 'post', '/column-values/upsert', { data: { item_id: Number(item_id), column_id: v.column_id, value: v.value } });
        applied.push(v.column_id);
      } catch (err) {
        failed.push({ column_id: v.column_id, reason: err.message });
      }
    }
    if (!applied.length) throw new ToolError(`No values were updated. ${failed.map(f => `column ${f.column_id}: ${f.reason}`).join('; ')}`);
    const result = { updated: true, item_id: Number(item_id), columns_updated: applied };
    if (failed.length) result.columns_failed = failed;
    return ok(result);
  });

  // ── rename_item ──────────────────────────────────────────────────────────────
  reg('rename_item', {
    title: 'Rename item',
    description: 'Change an item\'s name/title. Requires write scope.',
    inputSchema: {
      board_id: z.number().int().positive(),
      item_id: z.number().int().positive(),
      name: z.string().min(1).max(255).describe('The new item name.'),
    },
  }, async ({ board_id, item_id, name }) => {
    assertBoardAllowed(ctx, board_id);
    const updated = await callApi(ctx.auth, 'put', `/items/${Number(item_id)}`, { data: { name } });
    return ok({ renamed: true, item: { id: updated.id, name: updated.name } });
  });

  // ── move_item ────────────────────────────────────────────────────────────────
  reg('move_item', {
    title: 'Move item to another group',
    description: 'Move an item to a different group on the same board (optionally at a position). Requires write scope.',
    inputSchema: {
      board_id: z.number().int().positive(),
      item_id: z.number().int().positive(),
      group_id: z.number().int().positive().describe('Target group id (must be on the same board).'),
      position: z.number().int().nonnegative().optional().describe('0-based position within the target group (default: end).'),
    },
  }, async ({ board_id, item_id, group_id, position }) => {
    assertBoardAllowed(ctx, board_id);
    await callApi(ctx.auth, 'patch', `/items/${Number(item_id)}/move`, {
      data: { group_id: Number(group_id), position: position == null ? 9999 : Number(position) },
    });
    return ok({ moved: true, item_id: Number(item_id), group_id: Number(group_id) });
  });

  // ── delete_item ──────────────────────────────────────────────────────────────
  reg('delete_item', {
    title: 'Delete item',
    description: 'Delete an item (moves it to the board trash, 15-day retention). Requires FULL scope.',
    inputSchema: {
      board_id: z.number().int().positive(),
      item_id: z.number().int().positive(),
    },
    annotations: { destructiveHint: true },
  }, async ({ board_id, item_id }) => {
    assertBoardAllowed(ctx, board_id);
    await callApi(ctx.auth, 'delete', `/items/${Number(item_id)}`);
    return ok({ deleted: true, item_id: Number(item_id), note: 'Moved to trash (recoverable for 15 days).' });
  });

  // ── assign_people ────────────────────────────────────────────────────────────
  reg('assign_people', {
    title: 'Assign people to an item',
    description: 'Set the assignees on a person/owner column of an item. Provide the person column id and the user ids to assign (they must be members of the board). Replaces the current assignees. Requires write scope.',
    inputSchema: {
      board_id: z.number().int().positive(),
      item_id: z.number().int().positive(),
      column_id: z.number().int().positive().describe('The id of a person-type column (from get_board_schema).'),
      user_ids: z.array(z.number().int().positive()).max(MAX_ASSIGNEES).describe('User ids to assign (empty list clears assignees). Must be board members.'),
    },
  }, async ({ board_id, item_id, column_id, user_ids }) => {
    const board = await loadBoard(ctx, board_id);
    const col = (board.columns || []).find(c => c.id === Number(column_id));
    if (!col) throw new ToolError(`Column ${column_id} is not on board ${board_id}.`);
    if (col.type !== 'person') throw new ToolError(`Column "${col.title}" is type "${col.type}", not a person column. assign_people only works on person columns.`);

    const memberById = new Map((board.members || []).map(m => [m.id, m]));
    const people = [];
    for (const uid of user_ids) {
      const m = memberById.get(Number(uid));
      if (!m) throw new ToolError(`User ${uid} is not a member of board ${board_id}. Add them to the board first, or pick from list_board_members.`);
      people.push({ id: m.id, name: m.name });
    }
    const value = people.length ? JSON.stringify(people) : '';
    await callApi(ctx.auth, 'post', '/column-values/upsert', { data: { item_id: Number(item_id), column_id: Number(column_id), value } });
    return ok({ assigned: true, item_id: Number(item_id), column: col.title, assignees: people.map(p => p.name) });
  });

  // ── create_update ────────────────────────────────────────────────────────────
  reg('create_update', {
    title: 'Post an update/comment',
    description: 'Post an update (comment) on an item. Requires write scope.',
    inputSchema: {
      board_id: z.number().int().positive(),
      item_id: z.number().int().positive(),
      body: z.string().min(1).max(5000).describe('The comment text.'),
    },
  }, async ({ board_id, item_id, body }) => {
    assertBoardAllowed(ctx, board_id);
    const c = await callApi(ctx.auth, 'post', '/comments', { data: { item_id: Number(item_id), body } });
    return ok({ posted: true, update_id: c.id, item_id: Number(item_id) });
  });

  // ── create_group ─────────────────────────────────────────────────────────────
  reg('create_group', {
    title: 'Create group',
    description: 'Create a new group (section) on a board. Requires write scope.',
    inputSchema: {
      board_id: z.number().int().positive(),
      name: z.string().min(1).max(255),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe('Optional hex colour like #0073ea.'),
    },
  }, async ({ board_id, name, color }) => {
    assertBoardAllowed(ctx, board_id);
    const g = await callApi(ctx.auth, 'post', '/groups', { data: { board_id: Number(board_id), name, color } });
    return ok({ created: true, group: { id: g.id, name: g.name } });
  });

  // ── create_column ────────────────────────────────────────────────────────────
  reg('create_column', {
    title: 'Create column',
    description: `Add a new column to a board. Valid types: ${COLUMN_TYPE_LIST}. For status/dropdown columns pass settings.options. Requires write scope.`,
    inputSchema: {
      board_id: z.number().int().positive(),
      title: z.string().min(1).max(255),
      type: z.string().describe(`Column type. One of: ${COLUMN_TYPE_LIST}.`),
      settings: z.record(z.string(), z.any()).optional().describe('Optional type-specific settings, e.g. { "options": ["Low","High"] } for dropdown.'),
    },
  }, async ({ board_id, title, type, settings }) => {
    assertBoardAllowed(ctx, board_id);
    if (!COLUMN_TYPES.has(type)) throw new ToolError(`Unknown column type "${type}". Valid types: ${COLUMN_TYPE_LIST}.`);
    const c = await callApi(ctx.auth, 'post', '/columns', { data: { board_id: Number(board_id), title, type, settings: settings || {} } });
    return ok({ created: true, column: { id: c.id, title: c.title, type: c.type } });
  });

  // ── create_board ─────────────────────────────────────────────────────────────
  reg('create_board', {
    title: 'Create board',
    description: 'Create a new board with default columns and a starter group. Requires write scope. Not available to board-restricted API keys.',
    inputSchema: {
      name: z.string().min(1).max(255),
      description: z.string().max(2000).optional(),
      visibility: z.enum(['private', 'org_wide']).optional().describe('private (members only) or org_wide (everyone). Default private.'),
    },
  }, async ({ name, description, visibility }) => {
    const ids = ctx.key && ctx.key.board_ids;
    if (Array.isArray(ids) && ids.length)
      throw new ToolError('This API key is restricted to specific boards and cannot create new boards.');
    const b = await callApi(ctx.auth, 'post', '/boards', { data: { name, description: description || '', visibility: visibility || 'private' } });
    return ok({ created: true, board: { id: b.id, name: b.name, visibility: b.visibility } });
  });

  // ── update_board ─────────────────────────────────────────────────────────────
  reg('update_board', {
    title: 'Update board settings',
    description: 'Rename a board or change its description/visibility. Requires write scope.',
    inputSchema: {
      board_id: z.number().int().positive(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().max(2000).optional(),
      visibility: z.enum(['private', 'org_wide']).optional(),
    },
  }, async ({ board_id, name, description, visibility }) => {
    assertBoardAllowed(ctx, board_id);
    const cur = await loadBoard(ctx, board_id);
    const b = await callApi(ctx.auth, 'put', `/boards/${Number(board_id)}`, { data: {
      name: name ?? cur.name, description: description ?? cur.description ?? '',
      visibility: visibility ?? cur.visibility, item_name: cur.item_name ?? 'Item',
    } });
    return ok({ updated: true, board: { id: b.id, name: b.name, visibility: b.visibility } });
  });

  // ── delete_group ─────────────────────────────────────────────────────────────
  reg('delete_group', {
    title: 'Delete group',
    description: 'Delete a group (section) and all its items from a board. Requires FULL scope. Cannot be undone.',
    inputSchema: { board_id: z.number().int().positive(), group_id: z.number().int().positive() },
    annotations: { destructiveHint: true },
  }, async ({ board_id, group_id }) => {
    assertBoardAllowed(ctx, board_id);
    await callApi(ctx.auth, 'delete', `/groups/${Number(group_id)}`);
    return ok({ deleted: true, group_id: Number(group_id) });
  });

  // ── delete_column ────────────────────────────────────────────────────────────
  reg('delete_column', {
    title: 'Delete column',
    description: 'Delete a column from a board (removes its values on every item). Requires write scope. Cannot be undone.',
    inputSchema: { board_id: z.number().int().positive(), column_id: z.number().int().positive() },
    annotations: { destructiveHint: true },
  }, async ({ board_id, column_id }) => {
    assertBoardAllowed(ctx, board_id);
    await callApi(ctx.auth, 'delete', `/columns/${Number(column_id)}`);
    return ok({ deleted: true, column_id: Number(column_id) });
  });

  // ── create_subitem ───────────────────────────────────────────────────────────
  reg('create_subitem', {
    title: 'Create subitem',
    description: 'Create a subitem nested under a parent item. Optionally set column values. Requires write scope.',
    inputSchema: {
      board_id: z.number().int().positive(),
      parent_item_id: z.number().int().positive(),
      name: z.string().min(1).max(255),
      values: z.array(z.object({ column_id: z.number().int().positive(), value: z.string() })).max(MAX_VALUES_PER_ITEM).optional(),
    },
  }, async ({ board_id, parent_item_id, name, values }) => {
    const board = await loadBoard(ctx, board_id);
    const parent = flattenItems(board).find(i => i.id === Number(parent_item_id));
    if (!parent) throw new ToolError(`No item with id ${parent_item_id} on board ${board_id}.`);
    const item = await callApi(ctx.auth, 'post', '/items', { data: { group_id: parent._group_id, name, parent_item_id: Number(parent_item_id) } });
    const applied = [];
    for (const v of (values || [])) {
      try { await callApi(ctx.auth, 'post', '/column-values/upsert', { data: { item_id: item.id, column_id: v.column_id, value: v.value } }); applied.push(v.column_id); } catch { /* skip */ }
    }
    return ok({ created: true, subitem: { id: item.id, name: item.name, parent_item_id: Number(parent_item_id) }, values_set: applied });
  });

  // ── duplicate_item / duplicate_group / duplicate_board ────────────────────────
  reg('duplicate_item', {
    title: 'Duplicate item',
    description: 'Make a copy of an item (with its column values) in the same group. Requires write scope.',
    inputSchema: { board_id: z.number().int().positive(), item_id: z.number().int().positive() },
  }, async ({ board_id, item_id }) => {
    assertBoardAllowed(ctx, board_id);
    const n = await callApi(ctx.auth, 'post', `/items/${Number(item_id)}/copy`);
    return ok({ duplicated: true, new_item: { id: n.id, name: n.name } });
  });

  reg('duplicate_group', {
    title: 'Duplicate group',
    description: 'Copy a group with all its items and values into the same board. Requires write scope.',
    inputSchema: { board_id: z.number().int().positive(), group_id: z.number().int().positive() },
  }, async ({ board_id, group_id }) => {
    assertBoardAllowed(ctx, board_id);
    const g = await callApi(ctx.auth, 'post', `/groups/${Number(group_id)}/duplicate`);
    return ok({ duplicated: true, new_group: { id: g.id, name: g.name } });
  });

  reg('duplicate_board', {
    title: 'Duplicate board',
    description: 'Clone an entire board (columns, groups and items) into a new board. Requires write scope.',
    inputSchema: { board_id: z.number().int().positive(), name: z.string().min(1).max(255).optional() },
  }, async ({ board_id, name }) => {
    assertBoardAllowed(ctx, board_id);
    const r = await callApi(ctx.auth, 'post', `/boards/${Number(board_id)}/clone`, { data: name ? { name } : {} });
    const b = r.board || r;
    return ok({ duplicated: true, new_board: { id: b.id, name: b.name } });
  });

  // ── add_board_member / remove_board_member ────────────────────────────────────
  reg('add_board_member', {
    title: 'Add board member',
    description: 'Add a user (by email) as a member of a board. Requires write scope.',
    inputSchema: { board_id: z.number().int().positive(), email: z.string().email() },
  }, async ({ board_id, email }) => {
    assertBoardAllowed(ctx, board_id);
    const r = await callApi(ctx.auth, 'post', `/boards/${Number(board_id)}/members`, { data: { email } });
    return ok({ added: true, member: r.member ? { id: r.member.id, name: r.member.name, email: r.member.email } : null });
  });

  reg('remove_board_member', {
    title: 'Remove board member',
    description: 'Remove a member from a board by user id. Requires write scope.',
    inputSchema: { board_id: z.number().int().positive(), user_id: z.number().int().positive() },
  }, async ({ board_id, user_id }) => {
    assertBoardAllowed(ctx, board_id);
    await callApi(ctx.auth, 'delete', `/boards/${Number(board_id)}/members/${Number(user_id)}`);
    return ok({ removed: true, user_id: Number(user_id) });
  });

  // ── get_board_activity ───────────────────────────────────────────────────────
  reg('get_board_activity', {
    title: 'Get board activity log',
    description: 'Read recent activity (who changed what) on a board. Read-only.',
    inputSchema: {
      board_id: z.number().int().positive(),
      limit: z.number().int().positive().max(100).optional().describe('Max entries (default 30, max 100).'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ board_id, limit }) => {
    assertBoardAllowed(ctx, board_id);
    let logs;
    try { logs = await callApi(ctx.auth, 'get', `/activity-logs/board/${Number(board_id)}`); }
    catch (err) { throw boardAccessError(board_id, err); }
    const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 30));
    const rows = (Array.isArray(logs) ? logs : []).slice(0, lim).map(l => ({
      at: l.created_at, who: l.user_name, action: l.action, item: l.item_name || undefined,
      field: l.field || undefined, from: l.old_value || undefined, to: l.new_value || undefined,
    }));
    return ok({ board_id: Number(board_id), count: rows.length, activity: rows });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Automations
  // ════════════════════════════════════════════════════════════════════════════
  reg('list_automations', {
    title: 'List automations',
    description: 'List the automation recipes configured on a board (id, name, trigger, enabled). Read-only.',
    inputSchema: { board_id: z.number().int().positive() },
    annotations: { readOnlyHint: true },
  }, async ({ board_id }) => {
    assertBoardAllowed(ctx, board_id);
    let rows;
    try { rows = await callApi(ctx.auth, 'get', `/automations/board/${Number(board_id)}`); }
    catch (err) { throw boardAccessError(board_id, err); }
    return ok({ board_id: Number(board_id), automations: (rows || []).map(a => ({
      id: a.id, name: a.name, trigger_type: a.trigger_type, enabled: a.enabled,
    })) });
  });

  reg('create_automation', {
    title: 'Create automation',
    description: 'Create an automation recipe on a board. trigger_type is e.g. "item_created" or "status_change". '
      + 'trigger_config holds the trigger details (e.g. {"column_id":697,"to_value":"Done"} for status_change). '
      + 'actions is a list like [{"type":"notify","config":{"message":"Done!"}}]. conditions (optional) is a list of '
      + '{"column_id","operator","value"} that must all pass. Requires write scope.',
    inputSchema: {
      board_id: z.number().int().positive(),
      name: z.string().min(1).max(255),
      trigger_type: z.string().describe('e.g. "item_created", "status_change".'),
      trigger_config: z.record(z.string(), z.any()).optional(),
      actions: z.array(z.record(z.string(), z.any())).optional(),
      conditions: z.array(z.record(z.string(), z.any())).optional(),
      enabled: z.boolean().optional(),
    },
  }, async ({ board_id, name, trigger_type, trigger_config, actions, conditions, enabled }) => {
    assertBoardAllowed(ctx, board_id);
    const a = await callApi(ctx.auth, 'post', '/automations', { data: {
      board_id: Number(board_id), name, trigger_type,
      trigger_config: trigger_config || {}, actions: actions || [], conditions: conditions || [],
      enabled: enabled === undefined ? true : enabled,
    } });
    return ok({ created: true, automation: { id: a.id, name: a.name, enabled: a.enabled } });
  });

  reg('set_automation_enabled', {
    title: 'Enable/disable an automation',
    description: 'Turn an automation on or off without changing its recipe. Requires write scope.',
    inputSchema: { board_id: z.number().int().positive(), automation_id: z.number().int().positive(), enabled: z.boolean() },
  }, async ({ board_id, automation_id, enabled }) => {
    assertBoardAllowed(ctx, board_id);
    // Fetch the current recipe so the PUT preserves it (PUT overwrites all fields).
    let list;
    try { list = await callApi(ctx.auth, 'get', `/automations/board/${Number(board_id)}`); }
    catch (err) { throw boardAccessError(board_id, err); }
    const cur = (list || []).find(a => a.id === Number(automation_id));
    if (!cur) throw new ToolError(`No automation with id ${automation_id} on board ${board_id}.`);
    const a = await callApi(ctx.auth, 'put', `/automations/${Number(automation_id)}`, { data: {
      name: cur.name, trigger_type: cur.trigger_type, trigger_config: cur.trigger_config,
      conditions: cur.conditions || [], actions: cur.actions || [], enabled,
    } });
    return ok({ updated: true, automation: { id: a.id, name: a.name, enabled: a.enabled } });
  });

  reg('delete_automation', {
    title: 'Delete automation',
    description: 'Delete an automation recipe from a board. Requires write scope.',
    inputSchema: { board_id: z.number().int().positive(), automation_id: z.number().int().positive() },
    annotations: { destructiveHint: true },
  }, async ({ board_id, automation_id }) => {
    assertBoardAllowed(ctx, board_id);
    await callApi(ctx.auth, 'delete', `/automations/${Number(automation_id)}`);
    return ok({ deleted: true, automation_id: Number(automation_id) });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Dashboards (user-owned; not board-restricted)
  // ════════════════════════════════════════════════════════════════════════════
  reg('list_dashboards', {
    title: 'List dashboards',
    description: 'List dashboards the current user can see (owned or shared). Read-only.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    const rows = await callApi(ctx.auth, 'get', '/dashboards');
    return ok({ dashboards: (rows || []).map(d => ({ id: d.id, name: d.name, widgets: d.widget_count, is_owner: d.is_owner })) });
  });

  reg('create_dashboard', {
    title: 'Create dashboard',
    description: 'Create a new (empty) dashboard owned by the current user. Add widgets with add_dashboard_widget. Requires write scope.',
    inputSchema: { name: z.string().min(1).max(255) },
  }, async ({ name }) => {
    const d = await callApi(ctx.auth, 'post', '/dashboards', { data: { name } });
    return ok({ created: true, dashboard: { id: d.id, name: d.name } });
  });

  reg('rename_dashboard', {
    title: 'Rename dashboard',
    description: 'Rename a dashboard you own. Requires write scope.',
    inputSchema: { dashboard_id: z.number().int().positive(), name: z.string().min(1).max(255) },
  }, async ({ dashboard_id, name }) => {
    const d = await callApi(ctx.auth, 'put', `/dashboards/${Number(dashboard_id)}`, { data: { name } });
    return ok({ updated: true, dashboard: { id: d.id, name: d.name } });
  });

  reg('delete_dashboard', {
    title: 'Delete dashboard',
    description: 'Delete a dashboard you own. Requires write scope. Cannot be undone.',
    inputSchema: { dashboard_id: z.number().int().positive() },
    annotations: { destructiveHint: true },
  }, async ({ dashboard_id }) => {
    await callApi(ctx.auth, 'delete', `/dashboards/${Number(dashboard_id)}`);
    return ok({ deleted: true, dashboard_id: Number(dashboard_id) });
  });

  reg('add_dashboard_widget', {
    title: 'Add a dashboard widget',
    description: 'Add a widget to a dashboard you own. type is the widget type (e.g. "chart", "numbers", "battery"); '
      + 'config holds widget-specific settings such as which board/column to chart. Requires write scope.',
    inputSchema: {
      dashboard_id: z.number().int().positive(),
      type: z.string().describe('Widget type, e.g. "chart", "numbers", "battery".'),
      title: z.string().max(255).optional(),
      config: z.record(z.string(), z.any()).optional(),
    },
  }, async ({ dashboard_id, type, title, config }) => {
    const w = await callApi(ctx.auth, 'post', `/dashboards/${Number(dashboard_id)}/widgets`, { data: { type, title: title || '', config: config || {} } });
    return ok({ added: true, widget: { id: w.id, type: w.type, title: w.title } });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Editing helpers + cross-board search + trash
  // ════════════════════════════════════════════════════════════════════════════

  // ── update_column ────────────────────────────────────────────────────────────
  reg('update_column', {
    title: 'Update column',
    description: 'Rename a column or change its settings (e.g. edit a status/dropdown column\'s options). Pass settings like {"options":["Low","Med","High"]}. Requires write scope.',
    inputSchema: {
      board_id: z.number().int().positive(),
      column_id: z.number().int().positive(),
      title: z.string().min(1).max(255).optional(),
      settings: z.record(z.string(), z.any()).optional().describe('Type-specific settings to replace, e.g. { "options": [...] }.'),
    },
  }, async ({ board_id, column_id, title, settings }) => {
    assertBoardAllowed(ctx, board_id);
    const data = {};
    if (title !== undefined) data.title = title;
    if (settings !== undefined) data.settings = settings;
    if (!Object.keys(data).length) throw new ToolError('Provide a new title and/or settings to update.');
    const c = await callApi(ctx.auth, 'put', `/columns/${Number(column_id)}`, { data });
    return ok({ updated: true, column: { id: c.id, title: c.title, type: c.type } });
  });

  // ── rename_group ─────────────────────────────────────────────────────────────
  reg('rename_group', {
    title: 'Rename / recolor group',
    description: 'Change a group\'s name and/or color. Requires write scope.',
    inputSchema: {
      board_id: z.number().int().positive(),
      group_id: z.number().int().positive(),
      name: z.string().min(1).max(255).optional(),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    },
  }, async ({ board_id, group_id, name, color }) => {
    assertBoardAllowed(ctx, board_id);
    const board = await loadBoard(ctx, board_id);
    const g = (board.groups || []).find(x => x.id === Number(group_id));
    if (!g) throw new ToolError(`Group ${group_id} is not on board ${board_id}.`);
    const r = await callApi(ctx.auth, 'put', `/groups/${Number(group_id)}`, { data: { name: name ?? g.name, color: color ?? g.color } });
    return ok({ updated: true, group: { id: r.id, name: r.name, color: r.color } });
  });

  // ── reorder_groups / reorder_columns ──────────────────────────────────────────
  reg('reorder_groups', {
    title: 'Reorder groups',
    description: 'Set the top-to-bottom order of a board\'s groups. Provide ALL group ids in the desired order. Requires write scope.',
    inputSchema: { board_id: z.number().int().positive(), ordered_group_ids: z.array(z.number().int().positive()).min(1) },
  }, async ({ board_id, ordered_group_ids }) => {
    assertBoardAllowed(ctx, board_id);
    await callApi(ctx.auth, 'patch', '/groups/reorder', { data: { board_id: Number(board_id), ordered_ids: ordered_group_ids } });
    return ok({ reordered: true, board_id: Number(board_id), order: ordered_group_ids });
  });

  reg('reorder_columns', {
    title: 'Reorder columns',
    description: 'Set the left-to-right order of a board\'s columns. Provide ALL column ids in the desired order. Requires write scope.',
    inputSchema: { board_id: z.number().int().positive(), ordered_column_ids: z.array(z.number().int().positive()).min(1) },
  }, async ({ board_id, ordered_column_ids }) => {
    assertBoardAllowed(ctx, board_id);
    await callApi(ctx.auth, 'patch', '/columns/reorder', { data: { board_id: Number(board_id), ordered_ids: ordered_column_ids } });
    return ok({ reordered: true, board_id: Number(board_id), order: ordered_column_ids });
  });

  // ── bulk_update_items ─────────────────────────────────────────────────────────
  reg('bulk_update_items', {
    title: 'Bulk-set a column value',
    description: 'Set the SAME value on one column across many items at once (max 100). Faster than calling update_item repeatedly. Requires write scope.',
    inputSchema: {
      board_id: z.number().int().positive(),
      item_ids: z.array(z.number().int().positive()).min(1).max(100),
      column_id: z.number().int().positive(),
      value: z.string().describe('The value to set on every listed item (empty string clears it).'),
    },
  }, async ({ board_id, item_ids, column_id, value }) => {
    assertBoardAllowed(ctx, board_id);
    const r = await callApi(ctx.auth, 'post', '/column-values/bulk-upsert', { data: { item_ids, column_id: Number(column_id), value } });
    return ok({ updated: r.updated, skipped: r.skipped, total: r.total });
  });

  // ── search (across boards) ─────────────────────────────────────────────────────
  reg('search', {
    title: 'Search items across boards',
    description: 'Search items by name or cell value across ALL boards the user can access (or one board if board_id is given). Minimum 2 characters. Read-only.',
    inputSchema: {
      query: z.string().min(2).describe('Text to search for (min 2 chars).'),
      board_id: z.number().int().positive().optional().describe('Restrict the search to a single board.'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ query, board_id }) => {
    let groups = await callApi(ctx.auth, 'get', '/search', { params: { q: query } });
    if (!Array.isArray(groups)) groups = [];
    const ids = ctx.key && ctx.key.board_ids;
    if (Array.isArray(ids) && ids.length) groups = groups.filter(g => ids.includes(g.board_id));
    if (board_id) groups = groups.filter(g => g.board_id === Number(board_id));
    const results = groups.map(g => ({ board_id: g.board_id, board: g.board_name, items: (g.items || []).slice(0, 25).map(i => ({ id: i.id, name: i.name, group: i.group_name })) }));
    const totalItems = results.reduce((n, g) => n + g.items.length, 0);
    return ok({ query, boards_matched: results.length, items_matched: totalItems, results });
  });

  // ── list_trash / restore_item ─────────────────────────────────────────────────
  reg('list_trash', {
    title: 'List a board\'s trash',
    description: 'List deleted items still recoverable in a board\'s trash (15-day retention). Read-only.',
    inputSchema: { board_id: z.number().int().positive() },
    annotations: { readOnlyHint: true },
  }, async ({ board_id }) => {
    assertBoardAllowed(ctx, board_id);
    let rows;
    try { rows = await callApi(ctx.auth, 'get', `/trash/board/${Number(board_id)}`); }
    catch (err) { throw boardAccessError(board_id, err); }
    return ok({ board_id: Number(board_id), trash: (rows || []).map(t => ({
      trash_id: t.id, name: t.name, group: t.group_name, deleted_by: t.deleted_by_user_name, days_left: t.days_left,
    })) });
  });

  reg('restore_item', {
    title: 'Restore item from trash',
    description: 'Restore a deleted item from a board\'s trash back into the board. Get trash_id from list_trash. Requires write scope.',
    inputSchema: { board_id: z.number().int().positive(), trash_id: z.number().int().positive() },
  }, async ({ board_id, trash_id }) => {
    assertBoardAllowed(ctx, board_id);
    // Confirm the trash item really belongs to this (access-checked) board.
    let rows;
    try { rows = await callApi(ctx.auth, 'get', `/trash/board/${Number(board_id)}`); }
    catch (err) { throw boardAccessError(board_id, err); }
    if (!(rows || []).some(t => t.id === Number(trash_id)))
      throw new ToolError(`No trashed item with id ${trash_id} on board ${board_id}.`);
    const r = await callApi(ctx.auth, 'post', `/trash/${Number(trash_id)}/restore`);
    return ok({ restored: true, item: { id: r.item && r.item.id, name: r.item && r.item.name } });
  });

  // ── Dynamic API tool (opt-in, gated) ──────────────────────────────────────────
  // Mirrors monday.com's "Dynamic API Tools": exposes the full REST surface for
  // power use. OFF by default; only registered when MCP_ENABLE_DYNAMIC_API=true
  // AND the key has full scope. Still runs through the user's permissions.
  if (options.dynamic) {
    // Safety denylist — even with full access, the raw tool must not be a path to
    // privilege escalation or account takeover. Account/role/password/key/SMTP
    // management stays off-limits (read-only listing of users is fine).
    const isBlocked = (method, path) => {
      const p = path.split('?')[0].toLowerCase();
      const m = method.toUpperCase();
      if (/^\/keys/.test(p)) return true;                                  // API-key management
      if (/^\/auth\//.test(p) && m !== 'GET') return true;                 // no user/role/password/MFA changes
      if (/^\/email/.test(p) && m !== 'GET') return true;                  // no SMTP/email-admin changes
      return false;
    };
    reg('simplix_api_request', {
      title: 'Raw Simplix API request (advanced)',
      description: 'Advanced: call any Simplix REST endpoint under /api directly, as the current user, when no dedicated tool fits. Path must start with /. All normal permission checks apply. Account/user/key/email-admin management is blocked for safety.',
      inputSchema: {
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
        path: z.string().regex(/^\/[A-Za-z0-9/_\-?=&.%]*$/).describe('Path under /api, e.g. "/boards/12" or "/items/query".'),
        body: z.record(z.string(), z.any()).optional().describe('JSON request body for POST/PUT/PATCH.'),
      },
    }, async ({ method, path, body }) => {
      if (isBlocked(method, path))
        throw new ToolError(`For safety, the raw API tool can't ${method} ${path.split('?')[0]} (account/key/email-admin management). Use the Simplix UI for that.`);
      const data = await callApi(ctx.auth, method.toLowerCase(), path, { data: body });
      return ok(data);
    });
  }
}

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

module.exports = { registerTools };
