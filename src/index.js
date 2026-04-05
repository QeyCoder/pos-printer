require('dotenv').config();
const { createServer } = require('./server');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = createServer();

app.listen(PORT, HOST, () => {
  console.log(`[pos-print-server] Running on http://${HOST}:${PORT}`);
  console.log(`[pos-print-server] Printer device: ${process.env.PRINTER_INTERFACE || '/dev/usb/lp0'}`);
  console.log(`[pos-print-server] API key auth: enabled`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[pos-print-server] SIGTERM received, shutting down');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[pos-print-server] SIGINT received, shutting down');
  process.exit(0);
});
