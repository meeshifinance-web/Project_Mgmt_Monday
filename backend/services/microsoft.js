const axios = require('axios');

const CLIENT_ID = () => process.env.MICROSOFT_CLIENT_ID;
const CLIENT_SECRET = () => process.env.MICROSOFT_CLIENT_SECRET;
const TENANT = () => process.env.MICROSOFT_TENANT_ID || 'common';
const REDIRECT_URI = () =>
  process.env.MICROSOFT_REDIRECT_URI ||
  `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/auth/microsoft/callback`;

function getAuthorizationUrl(state) {
  const params = new URLSearchParams({
    client_id: CLIENT_ID(),
    response_type: 'code',
    redirect_uri: REDIRECT_URI(),
    response_mode: 'query',
    scope: 'openid profile email User.Read',
    state,
  });
  return `https://login.microsoftonline.com/${TENANT()}/oauth2/v2.0/authorize?${params}`;
}

async function exchangeCodeForTokens(code) {
  const res = await axios.post(
    `https://login.microsoftonline.com/${TENANT()}/oauth2/v2.0/token`,
    new URLSearchParams({
      client_id: CLIENT_ID(),
      client_secret: CLIENT_SECRET(),
      code,
      redirect_uri: REDIRECT_URI(),
      grant_type: 'authorization_code',
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return res.data; // { access_token, id_token, ... }
}

async function getUserInfo(accessToken) {
  const res = await axios.get('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const u = res.data;
  return {
    microsoftId: u.id,
    email: (u.mail || u.userPrincipalName || '').toLowerCase(),
    name: u.displayName || u.givenName || '',
  };
}

function isConfigured() {
  return !!(CLIENT_ID() && CLIENT_SECRET());
}

module.exports = { getAuthorizationUrl, exchangeCodeForTokens, getUserInfo, isConfigured };
