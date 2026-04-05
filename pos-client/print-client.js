/**
 * print-client.js — Drop-in replacement for window.print() in your POS
 *
 * USAGE (frontend / browser):
 *   import { printReceipt, printText, checkPrinter } from './print-client.js';
 *
 *   // Where you previously called window.print():
 *   await printReceipt({ ...orderData });
 *
 * USAGE (Node.js / backend):
 *   const { printReceipt } = require('./print-client');
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONFIG — set these in your environment / build config / .env
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Your Raspberry Pi's Tailscale IP  (find it with: tailscale ip -4 on the Pi)
const PRINT_SERVER_URL = process.env.PRINT_SERVER_URL || 'http://100.x.x.x:3000';

// The API key from your Pi's .env file  (keep this in your env, not hardcoded!)
const API_KEY = process.env.PRINT_API_KEY || 'your-api-key-here';

const HEADERS = {
  'Content-Type': 'application/json',
  'X-API-Key': API_KEY,
};

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Print a receipt.
 *
 * @param {object} orderData  — see schema below
 * @returns {Promise<{success: boolean, message?: string, error?: string}>}
 *
 * Schema:
 * {
 *   restaurant: {
 *     name: string,
 *     address?: string,
 *     phone?: string,
 *     gstin?: string,
 *   },
 *   order: {
 *     id: string,
 *     type?: 'Dine In' | 'Takeaway' | 'Delivery',
 *     table?: string,
 *     server?: string,
 *     datetime?: string,  // auto-filled if omitted
 *   },
 *   items: Array<{
 *     name: string,
 *     qty: number,
 *     price: number,
 *     note?: string,
 *   }>,
 *   subtotal?: number,
 *   discount?: number,
 *   tax?: number | { rate: number, amount: number },
 *   total: number,          // REQUIRED
 *   payment?: {
 *     method: string,       // 'Cash' | 'UPI' | 'Card' | etc.
 *     reference?: string,
 *   },
 *   footer?: string,        // custom footer text, supports \n
 *   copies?: number,        // default 1, max 5
 * }
 */
async function printReceipt(orderData) {
  return _post('/print/receipt', orderData);
}

/**
 * Print plain text lines.
 *
 * @param {string} text           — content to print (use \n for new lines)
 * @param {object} [opts]
 * @param {boolean} [opts.bold]
 * @param {'LEFT'|'CENTER'|'RIGHT'} [opts.align]
 * @param {boolean} [opts.cut]    — feed & cut after printing (default true)
 */
async function printText(text, opts = {}) {
  return _post('/print/text', { text, ...opts });
}

/**
 * Check if the print server is reachable and the printer is connected.
 * @returns {Promise<{status: 'ok'|'error', printer: 'connected'|'unreachable', uptime: number}>}
 */
async function checkPrinter() {
  try {
    const res = await fetch(`${PRINT_SERVER_URL}/health`, { method: 'GET' });
    return res.json();
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Example: migrate from window.print()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * BEFORE (old approach):
 *   function handlePrint(order) {
 *     window.print();   // opens browser print dialog
 *   }
 *
 * AFTER (new approach):
 *   async function handlePrint(order) {
 *     const result = await printReceipt(buildReceiptData(order));
 *     if (!result.success) {
 *       alert('Print failed: ' + result.error);
 *     }
 *   }
 *
 *   function buildReceiptData(order) {
 *     return {
 *       restaurant: {
 *         name: "Mom's Fresh Pot",
 *         address: "Sohna, Gurugram",
 *         phone: "+91-9876543210",
 *       },
 *       order: {
 *         id: order.id,
 *         type: order.type,
 *         table: order.tableNumber,
 *       },
 *       items: order.items.map(i => ({
 *         name: i.itemName,
 *         qty: i.quantity,
 *         price: i.unitPrice,
 *       })),
 *       subtotal: order.subtotal,
 *       tax: { rate: 5, amount: order.taxAmount },
 *       total: order.grandTotal,
 *       payment: { method: order.paymentMode },
 *     };
 *   }
 */

// ─────────────────────────────────────────────────────────────────────────────
// Internal helper
// ─────────────────────────────────────────────────────────────────────────────
async function _post(path, body) {
  try {
    const res = await fetch(`${PRINT_SERVER_URL}${path}`, {
      method:  'POST',
      headers: HEADERS,
      body:    JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error(`[print-client] ${path} → ${res.status}`, data);
      return { success: false, error: data.error || `HTTP ${res.status}` };
    }

    return data;
  } catch (err) {
    // Network error — server unreachable
    console.error(`[print-client] Network error:`, err.message);
    return { success: false, error: `Cannot reach print server: ${err.message}` };
  }
}

// Export for both ESM and CommonJS
if (typeof module !== 'undefined') {
  module.exports = { printReceipt, printText, checkPrinter };
}

// ESM export
export { printReceipt, printText, checkPrinter };
