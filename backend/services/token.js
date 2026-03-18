const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'changeme_use_strong_secret_32chars';
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
