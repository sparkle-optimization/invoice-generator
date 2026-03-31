# ✨ Sparkle Optimization LLC — Invoice Generator

A beautiful, local invoice generator that runs in your browser. 
Create, manage, and export professional invoices to PDF.

## Features

- **Automated invoice numbering** — auto-increments with each invoice
- **Full invoice form** — client details, line items, tax rate, payment instructions, notes
- **PDF export** — pixel-perfect PDF generation via Puppeteer (headless Chrome)
- **Invoice history** — browse, re-download, or delete past invoices
- **Local storage** — invoices and clients stored as JSON files under `data/` on your machine
- **No internet required** after first run (fonts load from Google Fonts)

## Requirements

- Docker

## Quick Start (with Docker)

```bash
docker compose up --build
```

Then open `http://localhost:3000`.

Notes:

- Invoice data is persisted on your machine in `./data` (mounted to `/app/data` in the container)
- Stop with `Ctrl+C` (or run `docker compose down` from another shell)

## Project Structure

```
invoice-generator/
├── server.js          # Express backend + PDF generation
├── package.json
├── start.sh           # One-click startup script
├── data/
│   ├── clients/
│   │   └── <client_id>.json
│   └── invoices/
│       └── yyyy-mm/
│           └── yyyy-mm-XXXX.json
└── public/
    └── index.html     # Web interface
```

## How It Works

- The Express server handles invoice storage (JSON files under `data/`) and PDF generation
- PDFs are rendered using Puppeteer (headless Chrome), so they look exactly like the invoice preview
- Invoice numbers auto-increment from 1001 onwards
- Each stored invoice also gets a monthly file ID in the form `yyyy-mm-XXXX`
- All data lives locally — nothing is sent to any external service
