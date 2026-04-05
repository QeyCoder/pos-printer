/**
 * print.js — All print endpoints
 *
 * Public:
 *   GET  /health          — liveness + printer status
 *
 * Protected (X-API-Key required):
 *   POST /print/receipt   — structured receipt from JSON
 *   POST /print/text      — plain text
 *   POST /print/raw       — raw ESC/POS hex buffer
 */

const router = require('express').Router();
const { requireApiKey } = require('../middleware/auth');
const {
  checkPrinterStatus,
  printReceipt,
  printText,
  printRaw,
} = require('../printer');

// ── GET /health ───────────────────────────────────────────────────────────────
// No auth — useful for monitoring, Tailscale health checks, uptime tools
router.get('/health', async (req, res) => {
  try {
    const printer = await checkPrinterStatus();
    res.json({
      status: 'ok',
      printer: printer.ok ? 'connected' : 'unreachable',
      interface: printer.interface,
      ...(printer.error && { printerError: printer.error }),
      uptime: Math.floor(process.uptime()),
    });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// ── POST /print/receipt ───────────────────────────────────────────────────────
/**
 * Body (JSON):
 * {
 *   "restaurant": {
 *     "name": "Mom's Fresh Pot",
 *     "address": "Sohna, Gurugram",
 *     "phone": "+91-9876543210",
 *     "gstin": "06XXXXXX"          // optional
 *   },
 *   "order": {
 *     "id": "ORD-2024-001",
 *     "type": "Dine In",           // Dine In | Takeaway | Delivery
 *     "table": "T-05",             // optional
 *     "server": "Rahul",           // optional
 *     "datetime": "15/01/24 19:30" // optional, defaults to now if omitted
 *   },
 *   "items": [
 *     { "name": "Paneer Butter Masala", "qty": 1, "price": 280 },
 *     { "name": "Butter Naan", "qty": 2, "price": 45, "note": "extra butter" }
 *   ],
 *   "subtotal": 370,
 *   "discount": 0,
 *   "tax": { "rate": 5, "amount": 18.5 },   // or just a number: "tax": 18.5
 *   "total": 388.50,
 *   "payment": { "method": "UPI", "reference": "UPI123456" },
 *   "footer": "Thank you!\nVisit again!",    // optional
 *   "copies": 1                              // optional, default 1, max 5
 * }
 */
router.post('/print/receipt', requireApiKey, async (req, res) => {
  const data = req.body;

  // Basic validation
  if (!data || !Array.isArray(data.items) || data.items.length === 0) {
    return res.status(400).json({ error: 'items array is required and must not be empty' });
  }
  if (data.total === undefined || data.total === null) {
    return res.status(400).json({ error: 'total is required' });
  }

  // Auto-fill datetime if not provided
  if (data.order && !data.order.datetime) {
    data.order.datetime = formatDatetime(new Date());
  }

  try {
    await printReceipt(data);
    res.json({ success: true, message: 'Receipt printed' });
  } catch (err) {
    console.error('[print/receipt]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /print/text ──────────────────────────────────────────────────────────
/**
 * Body (JSON):
 * {
 *   "text": "Hello!\nLine 2\nLine 3",
 *   "bold": false,          // optional
 *   "align": "LEFT",        // LEFT | CENTER | RIGHT  (optional)
 *   "cut": true             // optional, default true
 * }
 */
router.post('/print/text', requireApiKey, async (req, res) => {
  const { text, bold, align, cut } = req.body;

  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text (string) is required' });
  }

  try {
    await printText(text, { bold, align, cut });
    res.json({ success: true, message: 'Text printed' });
  } catch (err) {
    console.error('[print/text]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /print/raw ───────────────────────────────────────────────────────────
/**
 * For advanced users who generate their own ESC/POS bytes.
 *
 * Body (JSON):
 * {
 *   "hex": "1b401b6101..."   // hex-encoded ESC/POS byte string
 * }
 *
 * OR send as application/octet-stream with raw bytes in the body.
 */
router.post('/print/raw', requireApiKey,
  express_rawBody(),
  async (req, res) => {
    try {
      let rawData;

      if (req.headers['content-type'] === 'application/octet-stream') {
        rawData = req.rawBody; // Buffer
      } else {
        const { hex } = req.body;
        if (!hex || typeof hex !== 'string') {
          return res.status(400).json({ error: 'hex string is required for JSON raw print' });
        }
        rawData = hex;
      }

      await printRaw(rawData);
      res.json({ success: true, message: 'Raw data printed' });
    } catch (err) {
      console.error('[print/raw]', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Middleware to capture raw body for octet-stream requests.
 */
function express_rawBody() {
  return (req, res, next) => {
    if (req.headers['content-type'] === 'application/octet-stream') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        req.rawBody = Buffer.concat(chunks);
        next();
      });
    } else {
      next();
    }
  };
}

function formatDatetime(date) {
  const pad = n => String(n).padStart(2, '0');
  return (
    `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${String(date.getFullYear()).slice(-2)} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

module.exports = router;
