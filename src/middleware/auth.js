/**
 * API key authentication middleware.
 * Expects the header:  X-API-Key: <your-secret>
 *
 * The key is read from process.env.API_KEY at startup.
 * If API_KEY is not set the server will refuse to start (see validation in printer.js).
 */

const API_KEY = process.env.API_KEY;

if (!API_KEY || API_KEY === 'change-me-to-a-long-random-secret') {
  console.error(
    '[FATAL] API_KEY is not set or is still the default value.\n' +
    '        Copy .env.example to .env and set a strong API_KEY before starting.'
  );
  process.exit(1);
}

function requireApiKey(req, res, next) {
  const provided = req.headers['x-api-key'];

  if (!provided) {
    return res.status(401).json({ error: 'Missing X-API-Key header' });
  }

  // Constant-time comparison to avoid timing attacks
  if (!timingSafeEqual(provided, API_KEY)) {
    console.warn(`[auth] Rejected request from ${req.ip} — invalid API key`);
    return res.status(403).json({ error: 'Invalid API key' });
  }

  next();
}

/**
 * Poor-man's constant-time string comparison (no crypto module needed).
 * Ensures we don't leak key length via early exit.
 */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

module.exports = { requireApiKey };
