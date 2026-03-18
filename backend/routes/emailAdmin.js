const express = require('express');
const router  = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const { triggerPoll, getPollerStatus } = require('../services/emailPoller');

// GET /api/email/status  — any authenticated user can see the status
router.get('/status', requireAuth, (req, res) => {
  res.json(getPollerStatus());
});

// POST /api/email/trigger  — admin/manager only, runs a poll immediately
router.post('/trigger', requireAuth, requireRole('admin', 'manager'), async (req, res) => {
  const status = getPollerStatus();
  if (!status.enabled) {
    return res.status(400).json({ error: 'Email poller is not configured' });
  }
  try {
    await triggerPoll();
    res.json({ success: true, ...getPollerStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message, ...getPollerStatus() });
  }
});

module.exports = router;
