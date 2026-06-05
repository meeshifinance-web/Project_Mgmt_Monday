const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { requireAuth, canAccessBoard } = require('../middleware/auth');
const pool = require('../db');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const rand = crypto.randomBytes(16).toString('hex');
    const ext  = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
    cb(null, `${rand}${ext}`);
  },
});

// Upload size cap — configurable via FILE_MAX_MB (default 100 MB, up from 20).
const MAX_MB = Math.max(1, parseInt(process.env.FILE_MAX_MB, 10) || 100);
const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
});
const uploadSingle = upload.single('file');

// GET /api/files/limit — let the client enforce the same cap before uploading.
router.get('/limit', requireAuth, (_req, res) => res.json({ max_mb: MAX_MB }));

// POST /api/files/upload — handles multer errors (e.g. oversize) explicitly
// instead of bubbling a 500, so the client can show a real message.
router.post('/upload', requireAuth, (req, res) => {
  uploadSingle(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File exceeds the ${MAX_MB} MB limit` });
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({
      name:         req.file.filename,
      originalName: req.file.originalname,
      url:          `/api/files/${req.file.filename}`,
      size:         req.file.size,
      mimeType:     req.file.mimetype,
    });
  });
});

// Access control for an individual file. A file is attached to items through
// file-type column values (its random name appears in the cell JSON). The
// requester may touch the file only if they can access at least one board that
// references it. Admins can always access. Files not yet referenced anywhere
// (just uploaded, not yet saved into a cell) are allowed through so the
// upload→save flow isn't broken — the random 128-bit name makes them
// effectively unguessable during that brief window.
// The filename → board-ids resolution is an unindexed LIKE scan over
// column_values, so at scale (a board with 500–1000 attachments, each thumbnail
// firing a request) it would be re-run constantly. Cache the resolution for a
// short TTL so repeat requests for the same file are O(1). Staleness is bounded
// by the TTL, and the actual per-user permission (canAccessBoard) is still
// evaluated live on every request, so revoking board access takes effect at once.
const FILE_BOARDS_TTL = 60 * 1000; // 60s
const fileBoardsCache = new Map(); // filename -> { boardIds, exp }

async function boardsForFile(filename) {
  const now = Date.now();
  const hit = fileBoardsCache.get(filename);
  if (hit && hit.exp > now) return hit.boardIds;
  const { rows } = await pool.query(
    `SELECT DISTINCT c.board_id
       FROM column_values cv
       JOIN columns c ON c.id = cv.column_id
      WHERE c.type = 'file' AND cv.value LIKE '%' || $1 || '%'`,
    [filename]
  );
  const boardIds = rows.map(r => r.board_id);
  // Only cache resolved (referenced) files. An empty result means "not yet
  // attached anywhere" — don't cache it, so access is enforced the instant the
  // file is saved into a board rather than after the TTL.
  if (boardIds.length) {
    if (fileBoardsCache.size > 5000) fileBoardsCache.clear(); // simple bound
    fileBoardsCache.set(filename, { boardIds, exp: now + FILE_BOARDS_TTL });
  }
  return boardIds;
}

async function canAccessFile(filename, user) {
  if (user.role === 'admin') return true;
  const boardIds = await boardsForFile(filename);
  if (boardIds.length === 0) return true; // unreferenced upload (random name, brief window)
  for (const boardId of boardIds) {
    if (await canAccessBoard(boardId, user, pool)) return true;
  }
  return false;
}

// GET /api/files/:filename  — serve the file (auth + board access required)
router.get('/:filename', requireAuth, async (req, res) => {
  const filename = path.basename(req.params.filename); // strip path traversal
  const filePath = path.join(UPLOADS_DIR, filename);
  try {
    if (!(await canAccessFile(filename, req.user)))
      return res.status(403).json({ error: 'Access denied' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (err) return res.status(404).json({ error: 'File not found' });
    // Stored names are random + content-addressed, so a file never changes under
    // a given name. Cache hard in the browser: repeat views (scrolling a board
    // with hundreds of thumbnails) are served from cache with zero server hits.
    res.set('Cache-Control', 'private, max-age=604800, immutable'); // 7 days
    res.sendFile(filePath);
  });
});

// DELETE /api/files/:filename — reports a real result instead of failing silently
router.delete('/:filename', requireAuth, async (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(UPLOADS_DIR, filename);
  try {
    if (!(await canAccessFile(filename, req.user)))
      return res.status(403).json({ error: 'Access denied' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
  fs.unlink(filePath, (err) => {
    if (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
      console.error('[files] delete failed:', err.message);
      return res.status(500).json({ error: 'Failed to delete file' });
    }
    res.json({ success: true });
  });
});

module.exports = router;
