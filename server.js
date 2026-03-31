/* SPDX-FileCopyrightText: Copyright (c) 2026 Sparkle Optimization LLC. All rights reserved. */
/* SPDX-License-Identifier: Apache-2.0 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_DIR = path.join(__dirname, 'data');
const INVOICES_DIR = path.join(DATA_DIR, 'invoices');
const CLIENTS_DIR = path.join(DATA_DIR, 'clients');
const LEGACY_DATA_FILE = path.join(__dirname, 'invoices', 'data.json');
const DEFAULT_LAST_INVOICE_NUMBER = 1000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

ensureStorageDirs();

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function ensureStorageDirs() {
  ensureDirectory(DATA_DIR);
  ensureDirectory(INVOICES_DIR);
  ensureDirectory(CLIENTS_DIR);
}

function ensureDataShape(data) {
  const normalized = data && typeof data === 'object' ? data : {};

  if (!Number.isFinite(Number(normalized.lastInvoiceNumber))) {
    normalized.lastInvoiceNumber = DEFAULT_LAST_INVOICE_NUMBER;
  } else {
    normalized.lastInvoiceNumber = parseInt(normalized.lastInvoiceNumber, 10);
  }

  if (!Array.isArray(normalized.invoices)) {
    normalized.invoices = [];
  }

  if (!Array.isArray(normalized.clients)) {
    normalized.clients = [];
  }

  return normalized;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function normalizeClientProfile(profile) {
  return {
    name: String(profile?.name || '').trim(),
    email: String(profile?.email || '').trim(),
    address: String(profile?.address || '').trim()
  };
}

function getClientFingerprint(profile) {
  return [profile.name, profile.email, profile.address]
    .map(value => value.trim().toLowerCase())
    .join('|');
}

function isSafeFileId(value) {
  return /^[A-Za-z0-9_-]+$/.test(String(value || ''));
}

function toMonthKey(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}/.test(value)) {
    return value.slice(0, 7);
  }

  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 7);
  }

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function listJsonFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  return entries.flatMap(entry => {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      return listJsonFiles(entryPath);
    }
    return path.extname(entry.name) === '.json' ? [entryPath] : [];
  });
}

function getInvoiceFilePath(invoiceId, invoiceDate) {
  const monthMatch = /^(\d{4}-\d{2})-\d{4}$/.exec(String(invoiceId || ''));
  const monthKey = monthMatch ? monthMatch[1] : toMonthKey(invoiceDate);
  const monthDir = path.join(INVOICES_DIR, monthKey);
  ensureDirectory(monthDir);
  return path.join(monthDir, `${invoiceId}.json`);
}

function getClientFilePath(clientId) {
  return path.join(CLIENTS_DIR, `${clientId}.json`);
}

function normalizeStoredClient(client, fallbackId) {
  const timestamp = new Date().toISOString();
  const normalized = normalizeClientProfile(client);

  return {
    ...client,
    ...normalized,
    id: String(client?.id || fallbackId || '').trim(),
    createdAt: client?.createdAt || timestamp,
    updatedAt: client?.updatedAt || client?.createdAt || timestamp
  };
}

function normalizeStoredInvoice(invoice, fallbackId) {
  const invoiceId = String(invoice?.invoiceId || invoice?.id || fallbackId || '').trim();

  return {
    ...invoice,
    id: invoiceId,
    invoiceId
  };
}

function getInvoiceSortValue(invoice) {
  const timestamp = new Date(invoice.createdAt || invoice.invoiceDate || 0).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function readClients() {
  ensureStorageDirs();

  return listJsonFiles(CLIENTS_DIR)
    .map(filePath => normalizeStoredClient(readJsonFile(filePath), path.basename(filePath, '.json')))
    .filter(client => client.id)
    .sort((left, right) => new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime());
}

function readInvoices() {
  ensureStorageDirs();

  return listJsonFiles(INVOICES_DIR)
    .map(filePath => normalizeStoredInvoice(readJsonFile(filePath), path.basename(filePath, '.json')))
    .filter(invoice => invoice.invoiceNumber)
    .sort((left, right) => {
      const timeDiff = getInvoiceSortValue(right) - getInvoiceSortValue(left);
      if (timeDiff !== 0) {
        return timeDiff;
      }

      return String(right.invoiceNumber).localeCompare(String(left.invoiceNumber), undefined, { numeric: true });
    });
}

function computeLastInvoiceNumber(invoices) {
  return invoices.reduce((highest, invoice) => {
    const invoiceNumber = parseInt(invoice.invoiceNumber, 10);
    if (!Number.isFinite(invoiceNumber)) {
      return highest;
    }
    return Math.max(highest, invoiceNumber);
  }, DEFAULT_LAST_INVOICE_NUMBER);
}

function readData() {
  migrateLegacyDataIfNeeded();
  const invoices = readInvoices();
  const clients = readClients();

  return {
    lastInvoiceNumber: computeLastInvoiceNumber(invoices),
    invoices,
    clients
  };
}

function writeInvoice(invoice) {
  const normalizedInvoice = normalizeStoredInvoice(invoice, invoice.invoiceId || invoice.id);
  writeJsonFile(getInvoiceFilePath(normalizedInvoice.invoiceId, normalizedInvoice.invoiceDate), normalizedInvoice);
  return normalizedInvoice;
}

function writeClient(client) {
  const normalizedClient = normalizeStoredClient(client, client.id);
  writeJsonFile(getClientFilePath(normalizedClient.id), normalizedClient);
  return normalizedClient;
}

function generateInvoiceId(invoiceDate) {
  const monthKey = toMonthKey(invoiceDate);
  const monthDir = path.join(INVOICES_DIR, monthKey);
  ensureDirectory(monthDir);

  const nextSequence = listJsonFiles(monthDir).reduce((highest, filePath) => {
    const match = /-(\d{4})\.json$/.exec(path.basename(filePath));
    if (!match) {
      return highest;
    }
    return Math.max(highest, parseInt(match[1], 10));
  }, 0) + 1;

  return `${monthKey}-${String(nextSequence).padStart(4, '0')}`;
}

function generateClientId() {
  const nextSequence = listJsonFiles(CLIENTS_DIR).reduce((highest, filePath) => {
    const match = /^client-(\d{4})\.json$/.exec(path.basename(filePath));
    if (!match) {
      return highest;
    }
    return Math.max(highest, parseInt(match[1], 10));
  }, 0) + 1;

  return `client-${String(nextSequence).padStart(4, '0')}`;
}

function upsertClientProfile(profile) {
  const clientProfile = normalizeClientProfile(profile);

  if (!clientProfile.name) {
    return null;
  }

  const existingClient = readClients().find(client => {
    return getClientFingerprint(normalizeClientProfile(client)) === getClientFingerprint(clientProfile);
  });

  if (existingClient) {
    return writeClient({
      ...existingClient,
      ...clientProfile,
      updatedAt: new Date().toISOString()
    });
  }

  const timestamp = new Date().toISOString();
  return writeClient({
    id: generateClientId(),
    ...clientProfile,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function findInvoiceRecordByNumber(invoiceNumber) {
  return listJsonFiles(INVOICES_DIR).reduce((found, filePath) => {
    if (found) {
      return found;
    }

    const invoice = normalizeStoredInvoice(readJsonFile(filePath), path.basename(filePath, '.json'));
    if (String(invoice.invoiceNumber) !== String(invoiceNumber)) {
      return null;
    }

    return { invoice, filePath };
  }, null);
}

function migrateLegacyDataIfNeeded() {
  ensureStorageDirs();

  if (!fs.existsSync(LEGACY_DATA_FILE)) {
    return;
  }

  if (listJsonFiles(INVOICES_DIR).length > 0 || listJsonFiles(CLIENTS_DIR).length > 0) {
    return;
  }

  const legacyData = ensureDataShape(readJsonFile(LEGACY_DATA_FILE));
  const sequenceByMonth = new Map();

  const invoices = [...legacyData.invoices].sort((left, right) => {
    const monthCompare = toMonthKey(left.invoiceDate || left.createdAt).localeCompare(toMonthKey(right.invoiceDate || right.createdAt));
    if (monthCompare !== 0) {
      return monthCompare;
    }

    const numberDiff = (parseInt(left.invoiceNumber, 10) || 0) - (parseInt(right.invoiceNumber, 10) || 0);
    if (numberDiff !== 0) {
      return numberDiff;
    }

    return new Date(left.createdAt || left.invoiceDate || 0).getTime() - new Date(right.createdAt || right.invoiceDate || 0).getTime();
  });

  invoices.forEach(invoice => {
    const monthKey = toMonthKey(invoice.invoiceDate || invoice.createdAt);
    const nextSequence = (sequenceByMonth.get(monthKey) || 0) + 1;
    sequenceByMonth.set(monthKey, nextSequence);

    writeInvoice({
      ...invoice,
      invoiceId: `${monthKey}-${String(nextSequence).padStart(4, '0')}`,
      createdAt: invoice.createdAt || new Date().toISOString()
    });
  });

  legacyData.clients.forEach(client => {
    const legacyId = isSafeFileId(client?.id) ? String(client.id) : generateClientId();
    writeClient({
      ...client,
      id: legacyId
    });
  });
}

// Get next invoice number + all invoices
app.get('/api/invoices', (req, res) => {
  const data = readData();
  res.json(data);
});

// Save a new invoice
app.post('/api/invoices', (req, res) => {
  const invoice = { ...req.body };
  const shouldSaveClientProfile = Boolean(invoice.saveClientProfile);
  let savedClient = null;

  if (shouldSaveClientProfile) {
    savedClient = upsertClientProfile(invoice.clientProfile);
  }

  delete invoice.saveClientProfile;
  delete invoice.clientProfile;

  invoice.invoiceId = generateInvoiceId(invoice.invoiceDate);
  invoice.id = invoice.invoiceId;
  invoice.createdAt = new Date().toISOString();

  if (savedClient) {
    invoice.clientProfileId = savedClient.id;
  }

  const storedInvoice = writeInvoice(invoice);
  res.json({ success: true, invoice: storedInvoice, clientProfile: savedClient, clients: readClients() });
});

// Get single invoice by invoice number
app.get('/api/invoices/:number', (req, res) => {
  const invoiceRecord = findInvoiceRecordByNumber(req.params.number);
  if (!invoiceRecord) return res.status(404).json({ error: 'Not found' });
  res.json(invoiceRecord.invoice);
});

// Delete invoice
app.delete('/api/invoices/:number', (req, res) => {
  const invoiceRecord = findInvoiceRecordByNumber(req.params.number);
  if (!invoiceRecord) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(invoiceRecord.filePath);
  res.json({ success: true });
});

// Generate PDF using Puppeteer
app.post('/api/invoices/pdf', async (req, res) => {
  let browser;
  try {
    const puppeteer = require('puppeteer');
    const invoice = req.body;

    // Build the HTML for the PDF
    const html = generateInvoiceHTML(invoice);

    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'Letter',
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      printBackground: true
    });

    await browser.close();

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Invoice-${invoice.invoiceNumber}.pdf"`,
      'Content-Length': pdfBuffer.length
    });
    res.send(pdfBuffer);
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error('PDF generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

function generateInvoiceHTML(inv) {
  const subtotal = inv.lineItems.reduce((sum, item) => sum + (parseFloat(item.quantity) * parseFloat(item.rate)), 0);
  const taxAmount = subtotal * (parseFloat(inv.taxRate || 0) / 100);
  const total = subtotal + taxAmount;

  const lineItemsHTML = inv.lineItems.map(item => {
    const amount = parseFloat(item.quantity) * parseFloat(item.rate);
    return `
      <tr>
        <td class="desc-cell">${escapeHtml(item.description)}</td>
        <td class="num-cell">${parseFloat(item.quantity).toLocaleString()}</td>
        <td class="num-cell">$${parseFloat(item.rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="num-cell amount">$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>
    `;
  }).join('');

  const taxRowHTML = parseFloat(inv.taxRate) > 0 ? `
    <tr class="subtotal-row">
      <td colspan="3">Subtotal</td>
      <td class="num-cell">$${subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
    </tr>
    <tr class="subtotal-row">
      <td colspan="3">Tax (${inv.taxRate}%)</td>
      <td class="num-cell">$${taxAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
    </tr>
  ` : '';

  const notesHTML = inv.notes ? `
    <div class="notes-section">
      <div class="notes-label">Notes</div>
      <div class="notes-text">${escapeHtml(inv.notes)}</div>
    </div>
  ` : '';

  const paymentHTML = inv.paymentInstructions ? `
    <div class="payment-section">
      <div class="payment-label">Payment Instructions</div>
      <div class="payment-text">${escapeHtml(inv.paymentInstructions)}</div>
    </div>
  ` : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    color: #1a1a2e;
    background: #fff;
    font-size: 11pt;
  }
  .page {
    width: 8.5in;
    min-height: 11in;
    padding: 0.6in 0.65in 0.6in 0.65in;
    position: relative;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 0.45in;
  }
  .brand-block {}
  .brand-name {
    font-size: 22pt;
    font-weight: 800;
    color: #1a1a2e;
    letter-spacing: -0.5px;
    line-height: 1;
  }
  .brand-tagline {
    font-size: 8.5pt;
    color: #7c6f9f;
    letter-spacing: 2px;
    text-transform: uppercase;
    margin-top: 4px;
    font-weight: 500;
  }
  .invoice-badge {
    background: #1a1a2e;
    color: #fff;
    padding: 14px 24px;
    text-align: right;
    border-radius: 4px;
  }
  .invoice-badge .label {
    font-size: 7.5pt;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: #a08ecf;
    margin-bottom: 4px;
  }
  .invoice-badge .number {
    font-size: 20pt;
    font-weight: 800;
    letter-spacing: -0.5px;
  }
  .accent-bar {
    height: 3px;
    background: linear-gradient(90deg, #6c4aff 0%, #c084fc 50%, #f472b6 100%);
    margin-bottom: 0.35in;
    border-radius: 2px;
  }
  .meta-grid {
    display: flex;
    justify-content: space-between;
    margin-bottom: 0.35in;
    gap: 20px;
  }
  .meta-block { flex: 1; }
  .meta-label {
    font-size: 7pt;
    letter-spacing: 2.5px;
    text-transform: uppercase;
    color: #7c6f9f;
    margin-bottom: 5px;
    font-weight: 600;
  }
  .meta-value {
    font-size: 10pt;
    color: #1a1a2e;
    font-weight: 500;
    line-height: 1.5;
  }
  .meta-value.large {
    font-size: 12pt;
    font-weight: 700;
  }
  .bill-to-block {
    background: #f8f7ff;
    border-left: 3px solid #6c4aff;
    padding: 14px 18px;
    border-radius: 0 4px 4px 0;
    margin-bottom: 0.3in;
  }
  .bill-to-label {
    font-size: 7pt;
    letter-spacing: 2.5px;
    text-transform: uppercase;
    color: #7c6f9f;
    margin-bottom: 6px;
    font-weight: 600;
  }
  .bill-to-name {
    font-size: 13pt;
    font-weight: 700;
    color: #1a1a2e;
    margin-bottom: 2px;
  }
  .bill-to-details {
    font-size: 9.5pt;
    color: #4a4a6a;
    line-height: 1.6;
    white-space: pre-line;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 0.2in;
  }
  thead tr {
    background: #1a1a2e;
    color: #fff;
  }
  thead th {
    padding: 10px 12px;
    font-size: 7.5pt;
    letter-spacing: 2px;
    text-transform: uppercase;
    font-weight: 600;
    text-align: left;
  }
  thead th.num-cell { text-align: right; }
  tbody tr {
    border-bottom: 1px solid #e8e5f5;
  }
  tbody tr:nth-child(even) { background: #faf9ff; }
  tbody td {
    padding: 10px 12px;
    font-size: 10pt;
    color: #2a2a4a;
    vertical-align: top;
  }
  .desc-cell { max-width: 3.5in; }
  .num-cell { text-align: right; }
  .amount { font-weight: 600; }
  .subtotal-row td {
    padding: 7px 12px;
    font-size: 9.5pt;
    color: #4a4a6a;
    border-bottom: 1px solid #e8e5f5;
  }
  .total-row td {
    padding: 14px 12px;
    background: #f8f7ff;
    border-top: 2px solid #6c4aff;
  }
  .total-label {
    font-size: 9pt;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: #7c6f9f;
    font-weight: 700;
  }
  .total-amount {
    font-size: 18pt;
    font-weight: 800;
    color: #6c4aff;
    text-align: right;
  }
  .notes-section {
    margin-top: 0.25in;
    padding: 14px 18px;
    background: #faf9ff;
    border-radius: 4px;
    margin-bottom: 12px;
  }
  .notes-label, .payment-label {
    font-size: 7pt;
    letter-spacing: 2.5px;
    text-transform: uppercase;
    color: #7c6f9f;
    font-weight: 600;
    margin-bottom: 5px;
  }
  .notes-text, .payment-text {
    font-size: 9.5pt;
    color: #4a4a6a;
    line-height: 1.6;
    white-space: pre-line;
  }
  .payment-section {
    padding: 14px 18px;
    background: #f0ffe8;
    border-left: 3px solid #22c55e;
    border-radius: 0 4px 4px 0;
    margin-bottom: 12px;
  }
  .footer {
    position: absolute;
    bottom: 0.35in;
    left: 0.65in;
    right: 0.65in;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-top: 10px;
    border-top: 1px solid #e8e5f5;
  }
  .footer-brand {
    font-size: 7.5pt;
    color: #7c6f9f;
    font-weight: 600;
    letter-spacing: 1px;
  }
  .footer-contact {
    font-size: 7.5pt;
    color: #9090b0;
    text-align: right;
    line-height: 1.5;
  }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="brand-block">
      <div class="brand-name">Sparkle Optimization</div>
      <div class="brand-tagline">LLC</div>
    </div>
    <div class="invoice-badge">
      <div class="label">Invoice</div>
      <div class="number">#${escapeHtml(inv.invoiceNumber)}</div>
    </div>
  </div>

  <div class="accent-bar"></div>

  <div class="meta-grid">
    <div class="meta-block">
      <div class="meta-label">Invoice Date</div>
      <div class="meta-value">${formatDate(inv.invoiceDate)}</div>
    </div>
    <div class="meta-block">
      <div class="meta-label">Due Date</div>
      <div class="meta-value large">${formatDate(inv.dueDate)}</div>
    </div>
    <div class="meta-block" style="text-align:right">
      <div class="meta-label">From</div>
      <div class="meta-value" style="color:#4a4a6a">${escapeHtml(inv.fromAddress || 'Sparkle Optimization LLC').split('\n').join('<br>')}</div>
    </div>
  </div>

  <div class="bill-to-block">
    <div class="bill-to-label">Bill To</div>
    <div class="bill-to-name">${escapeHtml(inv.clientName)}</div>
    <div class="bill-to-details">${escapeHtml(inv.clientAddress || '')}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th class="num-cell" style="width:80px">Qty</th>
        <th class="num-cell" style="width:100px">Rate</th>
        <th class="num-cell" style="width:110px">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${lineItemsHTML}
      ${taxRowHTML}
      <tr class="total-row">
        <td colspan="3" class="total-label">Total Due</td>
        <td class="total-amount">$${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>
    </tbody>
  </table>

  ${paymentHTML}
  ${notesHTML}

  <div class="footer">
    <div class="footer-brand">Sparkle Optimization LLC</div>
    <div class="footer-contact">${escapeHtml(inv.fromEmail || '')}<br>${escapeHtml(inv.fromPhone || '')}</div>
  </div>
</div>
</body>
</html>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

app.listen(PORT, () => {
  console.log(`\n✨ Sparkle Invoice Generator running at http://localhost:${PORT}\n`);
});
