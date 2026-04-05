# pos-print-server

Remote thermal printer server for a restaurant POS. Runs on a Raspberry Pi (DietPi), exposes an HTTP API, and is accessed securely from anywhere via **Tailscale**.

```
Your POS (browser/server, anywhere)
        │  POST /print/receipt  { JSON }
        ▼
  Tailscale network  ←── no open ports, no port forwarding
        │
        ▼
  Raspberry Pi  (DietPi + Node.js)
  ├── pos-print-server   (this repo — Express + node-thermal-printer)
  └── USB thermal printer  (generic ESC/POS)
```

---

## Features

- **Generic ESC/POS** — works with any thermal printer (80mm or 58mm paper)
- **Structured receipt API** — send JSON, get a nicely formatted receipt
- **Plain text & raw modes** — full flexibility for custom printing
- **API key auth** — simple shared secret over the already-secure Tailscale tunnel
- **Systemd service** — auto-starts on boot, auto-restarts on crash
- **One-command install** — `setup.sh` handles everything on DietPi

---

## Raspberry Pi Setup

### 1. Flash DietPi

1. Download [DietPi](https://dietpi.com/) for your Pi model
2. Flash with [Balena Etcher](https://etcher.balena.io/)
3. Before first boot, edit `dietpi.txt` on the boot partition:
   ```
   AUTO_SETUP_TIMEZONE=Asia/Kolkata
   AUTO_SETUP_NET_WIFI_COUNTRY_CODE=IN
   AUTO_SETUP_WIFI_SSID=YourWiFiName
   AUTO_SETUP_WIFI_KEY=YourWiFiPassword
   ```
4. Boot the Pi — it'll auto-configure on first run

### 2. Clone this repo on the Pi

```bash
ssh dietpi@<pi-ip>

# Install git if needed
apt-get install -y git

git clone https://github.com/YOUR_USERNAME/pos-print-server.git
cd pos-print-server
```

### 3. Run setup

```bash
sudo bash scripts/setup.sh
```

This single command:
- Installs Node.js 20 LTS
- Installs Tailscale
- Sets up USB printer permissions (udev rule + `lp` group)
- Installs npm dependencies
- Creates `.env` with a randomly generated API key
- Installs and starts the systemd service

### 4. Authenticate Tailscale

```bash
tailscale up
# Open the URL it prints — approve in your Tailscale admin console
# Note your Pi's Tailscale IP:
tailscale ip -4
# → 100.x.x.x  (this is your PRINT_SERVER_URL host)
```

### 5. Verify the printer path

```bash
# Plug in your USB thermal printer, then:
ls /dev/usb/
# → lp0   (most common)

# Edit .env if different:
nano /home/dietpi/pos-print-server/.env
# Set: PRINTER_INTERFACE=/dev/usb/lp0

systemctl restart pos-print-server
```

### 6. Test it

```bash
# Health check
curl http://localhost:3000/health

# Test print (replace YOUR_API_KEY)
curl -X POST http://localhost:3000/print/text \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{"text": "Hello from POS!\nTest print works."}'
```

---

## API Reference

All endpoints except `/health` require the header: `X-API-Key: <your-key>`

### `GET /health`

Liveness + printer status. No auth required.

```json
{
  "status": "ok",
  "printer": "connected",
  "interface": "/dev/usb/lp0",
  "uptime": 3600
}
```

---

### `POST /print/receipt`

Prints a formatted receipt. This is the main endpoint your POS will use.

**Request:**
```json
{
  "restaurant": {
    "name": "Mom's Fresh Pot",
    "address": "Sohna, Gurugram, Haryana",
    "phone": "+91-9876543210",
    "gstin": "06XXXXXX1ZX"
  },
  "order": {
    "id": "ORD-2024-001",
    "type": "Dine In",
    "table": "T-05",
    "server": "Rahul",
    "datetime": "15/01/24 19:30"
  },
  "items": [
    { "name": "Paneer Butter Masala", "qty": 1, "price": 280 },
    { "name": "Butter Naan",          "qty": 2, "price": 45 },
    { "name": "Lassi",                "qty": 1, "price": 80, "note": "sweet" }
  ],
  "subtotal": 450,
  "discount": 0,
  "tax": { "rate": 5, "amount": 22.5 },
  "total": 472.50,
  "payment": { "method": "UPI", "reference": "UPI9876543210" },
  "footer": "Thank you for dining with us!\nVisit again soon!",
  "copies": 1
}
```

**Required fields:** `items[]`, `total`
**All other fields:** optional (restaurant name falls back to `DEFAULT_RESTAURANT_NAME` in `.env`)

**Response:**
```json
{ "success": true, "message": "Receipt printed" }
```

---

### `POST /print/text`

Prints plain text. Useful for kitchen order tickets, test prints, etc.

```json
{
  "text": "KOT #042\n\nTable: T-3\n- Paneer Tikka x2\n- Dal Makhani x1\n\nUrgent!",
  "bold": false,
  "align": "LEFT",
  "cut": true
}
```

---

### `POST /print/raw`

Sends raw ESC/POS hex bytes for advanced use.

```json
{
  "hex": "1b401b6101..."
}
```

---

## POS Integration

Copy `pos-client/print-client.js` into your POS project.

Set two environment variables:
```
PRINT_SERVER_URL=http://100.x.x.x:3000   # your Pi's Tailscale IP
PRINT_API_KEY=your-generated-key-here
```

Replace `window.print()` calls:

```javascript
// BEFORE
function onPrintClick() {
  window.print();  // opens browser dialog
}

// AFTER
import { printReceipt } from './print-client.js';

async function onPrintClick(order) {
  const result = await printReceipt({
    restaurant: { name: "Mom's Fresh Pot", address: "Sohna, Gurugram" },
    order: { id: order.id, type: order.type, table: order.table },
    items: order.items.map(i => ({
      name: i.name,
      qty: i.quantity,
      price: i.unitPrice,
    })),
    subtotal: order.subtotal,
    tax: { rate: 5, amount: order.taxAmount },
    total: order.grandTotal,
    payment: { method: order.paymentMethod },
  });

  if (!result.success) {
    alert('Print failed: ' + result.error);
  }
}
```

---

## Configuration (.env)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `API_KEY` | *(required)* | Shared secret for auth |
| `PRINTER_INTERFACE` | `/dev/usb/lp0` | USB device path |
| `PRINTER_TYPE` | `EPSON` | `EPSON` or `STAR` |
| `PRINTER_WIDTH` | `48` | 48 for 80mm, 32 for 58mm |
| `PRINTER_CHAR_SET` | `PC437_USA` | Character set |
| `DEFAULT_RESTAURANT_NAME` | `My Restaurant` | Fallback name |
| `DEFAULT_FOOTER` | `Thank you!` | Fallback footer |

---

## Service Management

```bash
# Status
systemctl status pos-print-server

# Live logs
journalctl -fu pos-print-server

# Restart (e.g. after .env changes)
systemctl restart pos-print-server

# Stop / disable
systemctl stop pos-print-server
systemctl disable pos-print-server
```

---

## Troubleshooting

**Printer not found (`/dev/usb/lp0` missing)**
```bash
lsusb                    # check if printer is listed
ls /dev/usb/             # check device path
dmesg | grep -i printer  # kernel messages
```

**Permission denied on printer device**
```bash
ls -la /dev/usb/lp0      # check ownership
groups dietpi            # verify 'lp' group membership
# If lp group is missing:
sudo usermod -aG lp dietpi && sudo reboot
```

**Cannot reach from POS**
```bash
tailscale status         # check Tailscale is connected
curl http://100.x.x.x:3000/health   # test from another Tailscale device
```

**403 Forbidden**
- Check `X-API-Key` header matches the key in `/home/dietpi/pos-print-server/.env`
- Note: API key is regenerated each setup — run `cat .env` to see it

---

## Stack

- **[DietPi](https://dietpi.com/)** — lightweight OS for Raspberry Pi
- **[Node.js](https://nodejs.org/)** v20 LTS
- **[Express](https://expressjs.com/)** — HTTP server
- **[node-thermal-printer](https://github.com/Klemen1337/node-thermal-printer)** — ESC/POS library
- **[Tailscale](https://tailscale.com/)** — secure overlay network (no port forwarding needed)
