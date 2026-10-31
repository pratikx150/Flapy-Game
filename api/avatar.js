const crypto = require('crypto');

function normalizeEmail(value) {
  if (!value || typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function extractEmailFromRequest(req) {
  const url = new URL(req.url || '/', 'https://example.com');
  const params = url.searchParams;

  const direct =
    params.get('email') ||
    params.get('mail') ||
    params.get('user') ||
    params.get('query');

  if (direct) return normalizeEmail(direct);

  const pathParts = url.pathname.split('/').filter(Boolean);
  const lastPart = pathParts[pathParts.length - 1] || '';
  if (lastPart.includes('@')) return normalizeEmail(lastPart);

  return '';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function gravatarUrl(email) {
  const hash = crypto.createHash('md5').update(email.trim().toLowerCase()).digest('hex');
  return `https://www.gravatar.com/avatar/${hash}?s=512&d=mp&r=g`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ success: false, error: 'Only GET requests are allowed.' });
    return;
  }

  const email = extractEmailFromRequest(req);

  if (!email || !isValidEmail(email)) {
    res.status(400).json({
      success: false,
      error: 'Please provide a valid email using ?email=your@email.com or ?mail=your@email.com',
      example: '/api/avatar?email=hello@example.com'
    });
    return;
  }

  const avatar = gravatarUrl(email);

  res.status(200).json({
    success: true,
    email,
    avatar,
    avatar_url: avatar,
    pfp: avatar,
    profile_picture: avatar,
    provider: 'gravatar',
    source: 'email hash'
  });
};
