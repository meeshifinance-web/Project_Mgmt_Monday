import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

// Attach JWT on every request
api.interceptors.request.use(config => {
  const token = localStorage.getItem('wb_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401: clear token and redirect to login
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      localStorage.removeItem('wb_token');
      delete api.defaults.headers.common['Authorization'];
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;

// ── Boards ────────────────────────────────────────────────────────────────────
export const getBoards = () => api.get('/boards');
export const getBoard = (id) => api.get(`/boards/${id}`);
export const createBoard = (data) => api.post('/boards', data);
export const updateBoard = (id, data) => api.put(`/boards/${id}`, data);
export const updateBoardEmailSettings = (id, emailFrom) => api.patch(`/boards/${id}/email-settings`, { email_from: emailFrom });
export const deleteBoard = (id) => api.delete(`/boards/${id}`);
export const cloneBoard = (id, data) => api.post(`/boards/${id}/clone`, data).then(r => r.data);

// ── Board members ─────────────────────────────────────────────────────────────
export const getBoardMembers = (boardId) => api.get(`/boards/${boardId}/members`);
export const addBoardMember = (boardId, email) => api.post(`/boards/${boardId}/members`, { email });
export const removeBoardMember = (boardId, userId) => api.delete(`/boards/${boardId}/members/${userId}`);

// ── Groups ────────────────────────────────────────────────────────────────────
export const createGroup = (data) => api.post('/groups', data);
export const updateGroup = (id, data) => api.put(`/groups/${id}`, data);
export const deleteGroup = (id) => api.delete(`/groups/${id}`);
export const reorderGroups = (boardId, orderedIds) => api.patch('/groups/reorder', { board_id: boardId, ordered_ids: orderedIds });

// ── Items ─────────────────────────────────────────────────────────────────────
export const createItem = (data) => api.post('/items', data);
export const updateItem = (id, data) => api.put(`/items/${id}`, data);
export const deleteItem = (id) => api.delete(`/items/${id}`);
export const moveItem   = (id, data) => api.patch(`/items/${id}/move`, data);

// ── Columns ───────────────────────────────────────────────────────────────────
export const createColumn = (data) => api.post('/columns', data);
export const updateColumn = (id, data) => api.put(`/columns/${id}`, data);
export const deleteColumn = (id) => api.delete(`/columns/${id}`);
export const reorderColumns = (boardId, orderedIds) => api.patch('/columns/reorder', { board_id: boardId, ordered_ids: orderedIds });

// ── Column values ─────────────────────────────────────────────────────────────
export const upsertColumnValue = (data) => api.post('/column-values/upsert', data);

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
export const getActivityLogs = (boardId) => api.get(`/activity-logs/board/${boardId}`);
export const getItemActivityLogs = (itemId) => api.get(`/activity-logs/item/${itemId}`);

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

// ── Export / Import ────────────────────────────────────────────────────────────
export const exportBoard = (boardId) => api.get(`/boards/${boardId}/export`, { responseType: 'blob' });
export const importBoardRows = (boardId, rows) => api.post(`/boards/${boardId}/import`, { rows });

// ── Folders ────────────────────────────────────────────────────────────────────
export const getFolders = () => api.get('/folders');
export const createFolder = (name) => api.post('/folders', { name });
export const updateFolder = (id, name) => api.put(`/folders/${id}`, { name });
export const deleteFolder = (id) => api.delete(`/folders/${id}`);
export const moveBoardToFolder = (boardId, folder_id) => api.patch(`/folders/board/${boardId}`, { folder_id });

// ── Board Views ────────────────────────────────────────────────────────────────
export const getBoardViews = (boardId) =>
  api.get(`/views/board/${boardId}`).then(r => r.data);
export const createView = (data) =>
  api.post('/views', data).then(r => r.data);
export const updateView = (id, data) =>
  api.put(`/views/${id}`, data).then(r => r.data);
export const deleteView = (id) =>
  api.delete(`/views/${id}`).then(r => r.data);

// Public form endpoints (no auth header needed — use plain fetch)
export const getPublicForm    = (slug) => fetch(`/api/public/forms/${slug}`).then(r => r.json());
export const submitPublicForm = (slug, data) =>
  fetch(`/api/public/forms/${slug}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(r => r.json());
