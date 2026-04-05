/**
 * printer.js — Thermal printer abstraction layer
 *
 * Wraps node-thermal-printer so the rest of the app never touches the library
 * directly. Supports any generic ESC/POS USB printer.
 *
 * Printer interface: USB  → /dev/usb/lp0  (default)
 * Paper width:       80mm → 48 chars      (default)
 *                    58mm → 32 chars
 */

const { ThermalPrinter, PrinterTypes, CharacterSet, BreakLine } = require('node-thermal-printer');

// ── Config from env ────────────────────────────────────────────────────────────
const PRINTER_INTERFACE  = process.env.PRINTER_INTERFACE  || '/dev/usb/lp0';
const PRINTER_TYPE       = process.env.PRINTER_TYPE       || 'EPSON';
const PRINTER_WIDTH      = parseInt(process.env.PRINTER_WIDTH  || '48', 10);
const PRINTER_CHAR_SET   = process.env.PRINTER_CHAR_SET   || 'PC437_USA';

// Map string config values to library constants
const TYPE_MAP = {
  EPSON:  PrinterTypes.EPSON,
  STAR:   PrinterTypes.STAR,
};

const CHAR_SET_MAP = {
  PC437_USA:    CharacterSet.PC437_USA,
  PC850_MULTILINGUAL: CharacterSet.PC850_MULTILINGUAL,
  PC852_LATIN2: CharacterSet.PC852_LATIN2,
  PC866_CYRILLIC: CharacterSet.PC866_CYRILLIC,
  PC437_INDIA:  CharacterSet.INDIA,
};

/**
 * Create a fresh printer instance for each job.
 * node-thermal-printer is not designed to be reused across requests,
 * so we create + execute + discard per print job.
 */
function createPrinter() {
  return new ThermalPrinter({
    type:         TYPE_MAP[PRINTER_TYPE] || PrinterTypes.EPSON,
    interface:    PRINTER_INTERFACE,
    characterSet: CHAR_SET_MAP[PRINTER_CHAR_SET] || CharacterSet.PC437_USA,
    breakLine:    BreakLine.WORD,
    width:        PRINTER_WIDTH,
    removeSpecialCharacters: false,
    lineCharacter: '-',
  });
}

/**
 * Check if the printer is reachable.
 * Returns { ok: true } or { ok: false, error: string }
 */
async function checkPrinterStatus() {
  const printer = createPrinter();
  try {
    const isConnected = await printer.isPrinterConnected();
    return { ok: isConnected, interface: PRINTER_INTERFACE };
  } catch (err) {
    return { ok: false, interface: PRINTER_INTERFACE, error: err.message };
  }
}

/**
 * Print a structured receipt.
 *
 * @param {object} data
 * @param {object} [data.restaurant]       — restaurant info (name, address, phone, gstin)
 * @param {object} [data.order]            — order info (id, type, table, server, datetime)
 * @param {Array}  data.items              — [{ name, qty, price, note? }]
 * @param {number} [data.subtotal]
 * @param {number} [data.discount]
 * @param {object|number} [data.tax]       — number OR { rate, amount }
 * @param {number} data.total
 * @param {object} [data.payment]          — { method, reference? }
 * @param {string} [data.footer]           — custom footer text
 * @param {number} [data.copies=1]         — number of copies to print
 */
async function printReceipt(data) {
  const copies = Math.min(parseInt(data.copies || 1, 10), 5); // max 5 copies

  for (let copy = 0; copy < copies; copy++) {
    const printer = createPrinter();

    try {
      // ── Header ──────────────────────────────────────────────────────────────
      const restaurant = data.restaurant || {};
      const restaurantName = restaurant.name || process.env.DEFAULT_RESTAURANT_NAME || 'Restaurant';

      printer.alignCenter();
      printer.setTextSize(1, 1);
      printer.bold(true);
      printer.println(restaurantName.toUpperCase());
      printer.bold(false);
      printer.setTextNormal();

      if (restaurant.address) printer.println(restaurant.address);
      if (restaurant.phone)   printer.println(`Tel: ${restaurant.phone}`);
      if (restaurant.gstin)   printer.println(`GSTIN: ${restaurant.gstin}`);

      printer.drawLine();

      // ── Order info ──────────────────────────────────────────────────────────
      const order = data.order || {};
      printer.alignLeft();

      if (order.id)       printer.println(`Order #: ${order.id}`);
      if (order.datetime) printer.println(`Date   : ${order.datetime}`);
      if (order.type)     printer.println(`Type   : ${order.type}`);
      if (order.table)    printer.println(`Table  : ${order.table}`);
      if (order.server)   printer.println(`Server : ${order.server}`);

      if (order.id || order.datetime || order.type || order.table) {
        printer.drawLine();
      }

      // ── Items ───────────────────────────────────────────────────────────────
      printer.alignLeft();
      printer.bold(true);
      printer.tableCustom([
        { text: 'Item',  align: 'LEFT',  width: 0.55 },
        { text: 'Qty',   align: 'CENTER', width: 0.10 },
        { text: 'Price', align: 'RIGHT',  width: 0.15 },
        { text: 'Amt',   align: 'RIGHT',  width: 0.20 },
      ]);
      printer.bold(false);
      printer.drawLine();

      const items = data.items || [];
      for (const item of items) {
        const qty   = Number(item.qty   || 1);
        const price = Number(item.price || 0);
        const amt   = qty * price;

        printer.tableCustom([
          { text: item.name,          align: 'LEFT',   width: 0.55 },
          { text: String(qty),        align: 'CENTER', width: 0.10 },
          { text: formatAmount(price), align: 'RIGHT',  width: 0.15 },
          { text: formatAmount(amt),  align: 'RIGHT',  width: 0.20 },
        ]);

        if (item.note) {
          printer.println(`  * ${item.note}`);
        }
      }

      printer.drawLine();

      // ── Totals ──────────────────────────────────────────────────────────────
      if (data.subtotal !== undefined) {
        printTotalRow(printer, 'Subtotal', data.subtotal);
      }

      if (data.discount) {
        printTotalRow(printer, 'Discount', -Math.abs(data.discount));
      }

      if (data.tax !== undefined) {
        if (typeof data.tax === 'object') {
          const label = data.tax.rate ? `Tax (${data.tax.rate}%)` : 'Tax';
          printTotalRow(printer, label, data.tax.amount);
        } else {
          printTotalRow(printer, 'Tax', data.tax);
        }
      }

      printer.drawLine();
      printer.bold(true);
      printer.setTextSize(1, 0);
      printTotalRow(printer, 'TOTAL', data.total);
      printer.bold(false);
      printer.setTextNormal();
      printer.drawLine();

      // ── Payment ─────────────────────────────────────────────────────────────
      if (data.payment) {
        const method = data.payment.method || 'Cash';
        printer.alignLeft();
        printer.println(`Payment : ${method}`);
        if (data.payment.reference) {
          printer.println(`Ref     : ${data.payment.reference}`);
        }
        printer.newLine();
      }

      // ── Footer ──────────────────────────────────────────────────────────────
      const footer = data.footer || process.env.DEFAULT_FOOTER || 'Thank you!';
      printer.alignCenter();
      footer.split('\n').forEach(line => printer.println(line));

      // Copy indicator for multiple copies
      if (copies > 1) {
        printer.newLine();
        printer.println(`--- Copy ${copy + 1} of ${copies} ---`);
      }

      // Feed and cut
      printer.newLine();
      printer.newLine();
      printer.cut();

      await printer.execute();

    } catch (err) {
      throw new Error(`Printer error (copy ${copy + 1}): ${err.message}`);
    }
  }
}

/**
 * Print plain text lines.
 * @param {string}   text      — newline-separated text content
 * @param {object}   [opts]
 * @param {boolean}  [opts.cut=true]   — cut after printing
 * @param {boolean}  [opts.bold=false]
 * @param {string}   [opts.align='LEFT']
 */
async function printText(text, opts = {}) {
  const printer = createPrinter();

  try {
    const align  = (opts.align || 'LEFT').toUpperCase();
    if (align === 'CENTER') printer.alignCenter();
    else if (align === 'RIGHT') printer.alignRight();
    else printer.alignLeft();

    if (opts.bold) printer.bold(true);

    const lines = text.split('\n');
    for (const line of lines) {
      printer.println(line);
    }

    if (opts.bold) printer.bold(false);

    if (opts.cut !== false) {
      printer.newLine();
      printer.newLine();
      printer.cut();
    }

    await printer.execute();
  } catch (err) {
    throw new Error(`Printer error: ${err.message}`);
  }
}

/**
 * Send a raw ESC/POS byte buffer directly.
 * @param {Buffer|string} rawData — Buffer or hex string (e.g. "1b401b61011b45...")
 */
async function printRaw(rawData) {
  const printer = createPrinter();

  try {
    const buffer = Buffer.isBuffer(rawData)
      ? rawData
      : Buffer.from(rawData.replace(/\s/g, ''), 'hex');

    printer.raw(buffer);
    await printer.execute();
  } catch (err) {
    throw new Error(`Printer error: ${err.message}`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatAmount(num) {
  return Number(num).toFixed(2);
}

function printTotalRow(printer, label, value) {
  printer.tableCustom([
    { text: label,              align: 'LEFT',  width: 0.55 },
    { text: formatAmount(value), align: 'RIGHT', width: 0.45 },
  ]);
}

module.exports = {
  checkPrinterStatus,
  printReceipt,
  printText,
  printRaw,
  PRINTER_WIDTH,
};
