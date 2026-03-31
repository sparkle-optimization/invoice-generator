# ✨ Sparkle Optimization LLC — Invoice Generator

A beautiful, local invoice generator that runs in your browser. 
Create, manage, and export professional invoices to PDF.

## Features

- **Automated invoice numbering** — auto-increments with each invoice
- **Full invoice form** — client details, line items, tax rate, payment instructions, notes
- **PDF export** — pixel-perfect PDF generation via Puppeteer (headless Chrome)
- **Invoice history** — browse, re-download, or delete past invoices
- **Local storage** — all data stored in `invoices/data.json` on your machine
- **No internet required** after first run (fonts load from Google Fonts)

## Requirements

- Docker

## Quick Start (with Docker)

```bash
docker compose up --build
```

Then open `http://localhost:3000`.

Notes:

- Invoice data is persisted on your machine in `./invoices` (mounted to `/app/invoices` in the container)
- Stop with `Ctrl+C` (or run `docker compose down` from another shell)

## Project Structure

```
invoice-generator/
├── server.js          # Express backend + PDF generation
├── package.json
├── start.sh           # One-click startup script
├── invoices/
│   └── data.json      # Invoice data (auto-created)
└── public/
    └── index.html     # Web interface
```

## How It Works

- The Express server handles invoice storage (JSON file) and PDF generation
- PDFs are rendered using Puppeteer (headless Chrome), so they look exactly like the invoice preview
- Invoice numbers auto-increment from 1001 onwards
- All data lives locally — nothing is sent to any external service
