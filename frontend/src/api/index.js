import axios from 'axios';

const api = axios.create({ baseURL: '/api', withCredentials: true });

// Attach JWT on every request
api.interceptors.request.use(config => {
  const token = localStorage.getItem('wb_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Routes that should never trigger a redirect on 401 — public pages where
// the visitor is expected to be unauthenticated (forms, login, password reset, etc.)
const PUBLIC_PATH_PREFIXES = [
  '/form/', '/login', '/register', '/forgot-password',
  '/reset-password', '/auth/callback',
];

function isPublicPath(pathname) {
  return PUBLIC_PATH_PREFIXES.some(p => pathname === p || pathname.startsWith(p));
}

// On 401: clear token, but only redirect when we're on a *protected* page
// and the failing call was not the silent /auth/me bootstrap probe.
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      const url = error.config?.url || '';
      const isAuthMeProbe = url.endsWith('/auth/me');
      const onPublicPage  = isPublicPath(window.location.pathname);

      // Always clear stale credentials so the app doesn't loop on a bad token.
      localStorage.removeItem('wb_token');
      delete api.defaults.headers.common['Authorization'];

      // Don't redirect when:
      //   • the visitor is already on a public page (e.g. a public form link), or
      //   • this 401 was just the AuthProvider's /auth/me bootstrap probe.
      if (!onPublicPage && !isAuthMeProbe && window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;

// ── AI builders (natural language) ──────────────────────────────────────────────
export const aiBoard      = (prompt) => api.post('/ai/board', { prompt }).then(r => r.data);
export const aiFormula    = (prompt, columns) => api.post('/ai/formula', { prompt, columns }).then(r => r.data);
export const aiAutomation = (boardId, prompt) => api.post('/ai/automation', { board_id: boardId, prompt }).then(r => r.data);
export const aiAsk        = (question) => api.post('/ai/ask', { question }).then(r => r.data);
export const aiDigest     = (params) => api.get('/ai/digest', { params }).then(r => r.data);

// ── Boards ────────────────────────────────────────────────────────────────────
export const getBoards = () => api.get('/boards');
export const getBoard = (id) => api.get(`/boards/${id}`);
export const createBoard = (data) => api.post('/boards', data);
export const updateBoard = (id, data) => api.put(`/boards/${id}`, data);
export const updateBoardEmailSettings = (id, emailFrom) => api.patch(`/boards/${id}/email-settings`, { email_from: emailFrom });
export const deleteBoard = (id) => api.delete(`/boards/${id}`);
export const cloneBoard = (id, data) => api.post(`/boards/${id}/clone`, data).then(r => r.data);
export const favoriteBoard   = (id) => api.post(`/boards/${id}/favorite`);
export const unfavoriteBoard = (id) => api.delete(`/boards/${id}/favorite`);

// ── Board members ─────────────────────────────────────────────────────────────
export const getBoardMembers = (boardId) => api.get(`/boards/${boardId}/members`);
export const addBoardMember = (boardId, email) => api.post(`/boards/${boardId}/members`, { email });
export const removeBoardMember = (boardId, userId) => api.delete(`/boards/${boardId}/members/${userId}`);
export const setBoardMemberOwner = (boardId, userId, isOwner) =>
  api.patch(`/boards/${boardId}/members/${userId}`, { is_owner: isOwner });

// ── Groups ────────────────────────────────────────────────────────────────────
export const createGroup = (data) => api.post('/groups', data);
export const updateGroup = (id, data) => api.put(`/groups/${id}`, data);
export const deleteGroup = (id) => api.delete(`/groups/${id}`);
export const reorderGroups = (boardId, orderedIds) => api.patch('/groups/reorder', { board_id: boardId, ordered_ids: orderedIds });
export const duplicateGroup = (id) => api.post(`/groups/${id}/duplicate`).then(r => r.data);
export const moveGroupItems = (id, targetGroupId) => api.post(`/groups/${id}/move-items`, { target_group_id: targetGroupId }).then(r => r.data);

// ── Items ─────────────────────────────────────────────────────────────────────
export const createItem = (data) => api.post('/items', data);
export const updateItem = (id, data) => api.put(`/items/${id}`, data);
export const deleteItem = (id) => api.delete(`/items/${id}`);
export const copyItem   = (id) => api.post(`/items/${id}/copy`);
export const moveItem   = (id, data) => api.patch(`/items/${id}/move`, data);

// ── Columns ───────────────────────────────────────────────────────────────────
export const createColumn = (data) => api.post('/columns', data);
export const updateColumn = (id, data) => api.put(`/columns/${id}`, data);
export const deleteColumn = (id) => api.delete(`/columns/${id}`);
export const duplicateColumn = (id) => api.post(`/columns/${id}/duplicate`).then(r => r.data);
export const reorderColumns = (boardId, orderedIds) => api.patch('/columns/reorder', { board_id: boardId, ordered_ids: orderedIds });

// ── Server-side item query (typed filter / sort / pagination) ──────────────────
// Scales boards to thousands of rows: filtering, sorting and pagination run in
// SQL with typed casts. Returns { items, total, page, pageSize, hasMore }.
export const queryItems = (params) => api.post('/items/query', params).then(r => r.data);

// ── Time tracking ───────────────────────────────────────────────────────────────
export const timeStart   = (item_id, column_id) => api.post('/time/start', { item_id, column_id }).then(r => r.data);
export const timeStop    = (item_id, column_id) => api.post('/time/stop', { item_id, column_id }).then(r => r.data);
export const timeManual  = (data) => api.post('/time/manual', data).then(r => r.data);
export const timeCell    = (itemId, columnId) => api.get(`/time/cell/${itemId}/${columnId}`).then(r => r.data);
export const timeEditEntry   = (id, data) => api.put(`/time/entry/${id}`, data).then(r => r.data);
export const timeDeleteEntry = (id) => api.delete(`/time/entry/${id}`).then(r => r.data);
export const timeRunning = () => api.get('/time/running').then(r => r.data);
export const getTimesheet = (params) => api.get('/time/timesheet', { params }).then(r => r.data);
export const setUserBilling = (id, data) => api.put(`/time/user/${id}/billing`, data).then(r => r.data);

// ── Column values ─────────────────────────────────────────────────────────────
export const upsertColumnValue = (data) => api.post('/column-values/upsert', data);
export const bulkUpsertColumnValue = (data) => api.post('/column-values/bulk-upsert', data);

// ── Connections (Connect Boards / Mirror / Rollup) ──────────────────────────────
export const searchConnectItems = (boardId, q, exclude) =>
  api.get(`/connections/board/${boardId}/items`, { params: { q, exclude: (exclude || []).join(',') } }).then(r => r.data);
export const getConnectionColumns = (boardId) =>
  api.get(`/connections/board/${boardId}/columns`).then(r => r.data);
export const resolveConnectItems = (ids) =>
  api.get('/connections/items', { params: { ids: (ids || []).join(',') } }).then(r => r.data);

// ── Automations ───────────────────────────────────────────────────────────────
export const getAutomations = (boardId) => api.get(`/automations/board/${boardId}`);
export const createAutomation = (data) => api.post('/automations', data);
export const updateAutomation = (id, data) => api.put(`/automations/${id}`, data);
export const deleteAutomation = (id) => api.delete(`/automations/${id}`);

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authLogin = (email, password) => api.post('/auth/login', { email, password });
export const authRegister = (data) => api.post('/auth/register', data);
export const authMfaVerify = (temp_token, code) => api.post('/auth/mfa/verify-login', { temp_token, code });
export const authForgotPassword = (email) => api.post('/auth/forgot-password', { email });
export const authResetPassword = (token, password) => api.post('/auth/reset-password', { token, password });
export const getMe = () => api.get('/auth/me');
export const updateMe = (data) => api.put('/auth/me', data);
export const changePassword = (current_password, new_password) => api.put('/auth/me/password', { current_password, new_password });
export const setupMfa = () => api.post('/auth/mfa/setup');
export const enableMfa = (code) => api.post('/auth/mfa/enable', { code });
export const disableMfa = (password) => api.post('/auth/mfa/disable', { password });
export const getUsers = () => api.get('/auth/users');
export const searchUsers = (q) => api.get('/auth/users/search', { params: { q } });
export const adminCreateUser = (data) => api.post('/auth/admin/create-user', data);
export const adminResetPassword = (id, password) => api.put(`/auth/admin/users/${id}/reset-password`, { password });
export const updateUserRole = (id, role) => api.put(`/auth/users/${id}/role`, { role });
export const setUserActive = (id, is_active) => api.put(`/auth/users/${id}/active`, { is_active });
export const deleteUser = (id) => api.delete(`/auth/users/${id}`);
export const getActivityLogs = (boardId, params) => api.get(`/activity-logs/board/${boardId}`, { params });
export const getItemActivityLogs = (itemId) => api.get(`/activity-logs/item/${itemId}`);
export const getAuditLogs = (params) => api.get('/activity-logs/audit', { params }).then(r => r.data);
export const getAuditMeta = () => api.get('/activity-logs/audit/meta').then(r => r.data);

// ── Comments ───────────────────────────────────────────────────────────────────
export const getComments   = (itemId) => api.get(`/comments/item/${itemId}`);
export const getItemEmails = (itemId) => api.get(`/items/${itemId}/emails`);
export const createComment = (data) => api.post('/comments', data);
export const deleteComment = (id) => api.delete(`/comments/${id}`);

// ── Notifications ──────────────────────────────────────────────────────────────
export const getNotifications = () => api.get('/notifications');
export const getUnreadNotificationCount = () => api.get('/notifications/unread-count');
export const markNotificationRead = (id) => api.patch(`/notifications/${id}/read`);
export const markAllNotificationsRead = () => api.patch('/notifications/read-all');

// ── Email Poller (admin) ───────────────────────────────────────────────────────
export const getEmailStatus  = ()  => api.get('/email/status');
export const triggerEmailPoll = () => api.post('/email/trigger');

// ── Global Trash (boards + folders) ───────────────────────────────────────────
export const getGlobalTrash            = ()        => api.get('/global-trash');
export const restoreTrashedBoard       = (id)      => api.post(`/global-trash/boards/${id}/restore`);
export const restoreTrashedFolder      = (id)      => api.post(`/global-trash/folders/${id}/restore`);
export const permanentDeleteBoard      = (id)      => api.delete(`/global-trash/boards/${id}`);
export const permanentDeleteFolder     = (id)      => api.delete(`/global-trash/folders/${id}`);
export const emptyGlobalTrash          = ()        => api.delete('/global-trash/empty');

// ── Trash / Recycle Bin ────────────────────────────────────────────────────────
export const getTrashItems    = (boardId)  => api.get(`/trash/board/${boardId}`);
export const restoreTrashItem = (id)       => api.post(`/trash/${id}/restore`);
export const deleteTrashItem  = (id)       => api.delete(`/trash/${id}`);
export const emptyTrash       = (boardId)  => api.delete(`/trash/board/${boardId}/empty`);

// ── Forms ──────────────────────────────────────────────────────────────────────
export const getForms       = (boardId)        => api.get(`/boards/${boardId}/forms`);
export const createForm     = (boardId, data)  => api.post(`/boards/${boardId}/forms`, data);
export const getForm        = (id)             => api.get(`/forms/${id}`);
export const updateForm     = (id, data)       => api.put(`/forms/${id}`, data);
export const deleteForm     = (id)             => api.delete(`/forms/${id}`);
export const saveFormFields = (id, fields)     => api.put(`/forms/${id}/fields`, { fields });
export const shareForm      = (id, data)       => api.post(`/forms/${id}/share`, data);
export const getFormQr      = (id)             => api.get(`/forms/${id}/qr`);

// ── Export / Import ────────────────────────────────────────────────────────────
export const exportBoard = (boardId, opts = {}) => {
  const params = {};
  if (opts.itemIds && opts.itemIds.length) params.item_ids = opts.itemIds.join(',');
  if (opts.columnIds && opts.columnIds.length) params.column_ids = opts.columnIds.join(',');
  return api.get(`/boards/${boardId}/export`, { responseType: 'blob', params });
};
export const importBoardRows = (boardId, rows) => api.post(`/boards/${boardId}/import`, { rows });

// ── Folders ────────────────────────────────────────────────────────────────────
export const getFolders = () => api.get('/folders');
export const createFolder = (name, parent_folder_id = null) =>
  api.post('/folders', { name, parent_folder_id });
export const updateFolder = (id, name) => api.put(`/folders/${id}`, { name });
export const deleteFolder = (id) => api.delete(`/folders/${id}`);
export const moveBoardToFolder = (boardId, folder_id) => api.patch(`/folders/board/${boardId}`, { folder_id });
export const moveFolderToParent = (id, parent_folder_id) =>
  api.patch(`/folders/${id}/parent`, { parent_folder_id });

// ── Board Views ────────────────────────────────────────────────────────────────
export const getBoardViews = (boardId) =>
  api.get(`/views/board/${boardId}`).then(r => r.data);
export const createView = (data) =>
  api.post('/views', data).then(r => r.data);
export const updateView = (id, data) =>
  api.put(`/views/${id}`, data).then(r => r.data);
export const deleteView = (id) =>
  api.delete(`/views/${id}`).then(r => r.data);
export const reorderViews = (board_id, view_ids) =>
  api.post('/views/reorder', { board_id, view_ids }).then(r => r.data);

// ── API Keys (admin only) ──────────────────────────────────────────────────────
export const getApiKeys    = ()           => api.get('/keys').then(r => r.data);
export const generateApiKey = (data)     => api.post('/keys', data).then(r => r.data);
export const revokeApiKey  = (id)        => api.delete(`/keys/${id}`).then(r => r.data);
export const renameApiKey  = (id, name)  => api.put(`/keys/${id}/rename`, { name }).then(r => r.data);

// ── My Work ───────────────────────────────────────────────────────────────────
export const getMyWork = () => api.get('/my-work').then(r => r.data);

// ── Files ──────────────────────────────────────────────────────────────────────
export const uploadFile = (file, onProgress) => {
  const fd = new FormData();
  fd.append('file', file);
  return api.post('/files/upload', fd, {
    onUploadProgress: onProgress
      ? (e) => { if (e.total) onProgress(Math.round((e.loaded * 100) / e.total)); }
      : undefined,
  }).then(r => r.data);
};
export const deleteFile = (filename) => api.delete(`/files/${filename}`).then(r => r.data);

// ── Dashboards ────────────────────────────────────────────────────────────────
export const getDashboards          = ()            => api.get('/dashboards').then(r => r.data);
export const createDashboard        = (data)        => api.post('/dashboards', data).then(r => r.data);
export const updateDashboard        = (id, data)    => api.put(`/dashboards/${id}`, data).then(r => r.data);
export const deleteDashboard        = (id)          => api.delete(`/dashboards/${id}`).then(r => r.data);
export const getDashboardWidgets    = (id)          => api.get(`/dashboards/${id}/widgets`).then(r => r.data);
export const createDashboardWidget  = (id, data)    => api.post(`/dashboards/${id}/widgets`, data).then(r => r.data);
export const updateDashboardWidget  = (id, wid, data) => api.put(`/dashboards/${id}/widgets/${wid}`, data).then(r => r.data);
export const deleteDashboardWidget  = (id, wid)     => api.delete(`/dashboards/${id}/widgets/${wid}`).then(r => r.data);
export const getDashboardSnapshots  = (boardId, days) => api.get('/dashboards/snapshots', { params: { board_id: boardId, days } }).then(r => r.data);
export const getDashboardSchedule   = (id)          => api.get(`/dashboards/${id}/schedule`).then(r => r.data);
export const setDashboardSchedule   = (id, data)    => api.put(`/dashboards/${id}/schedule`, data).then(r => r.data);
export const sendDashboardNow       = (id)          => api.post(`/dashboards/${id}/send-now`).then(r => r.data);
// Sharing — who can view a dashboard (owner-only management)
export const getDashboardShareUsers = ()            => api.get('/dashboards/users').then(r => r.data);
export const getDashboardShares     = (id)          => api.get(`/dashboards/${id}/shares`).then(r => r.data);
export const setDashboardShares     = (id, userIds) => api.put(`/dashboards/${id}/shares`, { user_ids: userIds }).then(r => r.data);

// Public form endpoints (no auth header needed — use plain fetch)
export const getPublicForm    = (slug) => fetch(`/api/public/forms/${slug}`).then(r => r.json());
export const submitPublicForm = (slug, data) =>
  fetch(`/api/public/forms/${slug}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(r => r.json());
export const uploadPublicFormFile = (slug, file) => {
  const fd = new FormData();
  fd.append('file', file);
  return fetch(`/api/public/forms/${slug}/upload`, {
    method: 'POST',
    body: fd,
  }).then(r => r.json());
};

// ── Date Cascade ──────────────────────────────────────────────────────────────
export const getCascadeTemplates   = (boardId)           => api.get(`/date-cascade/templates/${boardId}`).then(r => r.data);
export const saveCascadeTemplates  = (boardId, steps)    => api.post(`/date-cascade/templates/${boardId}`, { steps }).then(r => r.data);
export const updateCascadeStep     = (boardId, stepId, data) => api.put(`/date-cascade/templates/${boardId}/step/${stepId}`, data).then(r => r.data);
export const deleteCascadeTemplates = (boardId)          => api.delete(`/date-cascade/templates/${boardId}`).then(r => r.data);

export const getCascadeRules       = (boardId)           => api.get(`/date-cascade/rules/${boardId}`).then(r => r.data);
export const createCascadeRule     = (boardId, data)     => api.post(`/date-cascade/rules/${boardId}`, data).then(r => r.data);
export const updateCascadeRule     = (ruleId, data)      => api.put(`/date-cascade/rules/${ruleId}`, data).then(r => r.data);
export const deleteCascadeRule     = (ruleId)            => api.delete(`/date-cascade/rules/${ruleId}`).then(r => r.data);

export const triggerDateCascade    = (data)              => api.post('/date-cascade/trigger', data).then(r => r.data);
export const getCascadeLogs        = (boardId, itemId)   => api.get(itemId ? `/date-cascade/logs/${boardId}/${itemId}` : `/date-cascade/logs/${boardId}`).then(r => r.data);
export const overrideCascadeMeta   = (item_id, column_id) => api.patch('/date-cascade/meta/override', { item_id, column_id }).then(r => r.data);
