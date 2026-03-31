const jwt = require('jsonwebtoken');
const crypto = require('crypto');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('FATAL: JWT_SECRET env var must be set and be at least 32 characters long');
}
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '24h';

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { signToken, verifyToken, generateResetToken };
