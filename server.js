/* SPDX-FileCopyrightText: Copyright (c) 2026 Sparkle Optimization LLC. All rights reserved. */
/* SPDX-License-Identifier: Apache-2.0 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'invoices', 'data.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Ensure data file exists
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ lastInvoiceNumber: 1000, invoices: [] }));
}

function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Get next invoice number + all invoices
app.get('/api/invoices', (req, res) => {
  const data = readData();
  res.json(data);
});

// Save a new invoice
app.post('/api/invoices', (req, res) => {
  const data = readData();
  const invoice = req.body;
  invoice.id = Date.now();
  invoice.createdAt = new Date().toISOString();
  data.invoices.unshift(invoice);
  data.lastInvoiceNumber = parseInt(invoice.invoiceNumber);
  writeData(data);
  res.json({ success: true, invoice });
});

// Get single invoice by invoice number
app.get('/api/invoices/:number', (req, res) => {
  const data = readData();
  const invoice = data.invoices.find(inv => inv.invoiceNumber === req.params.number);
  if (!invoice) return res.status(404).json({ error: 'Not found' });
  res.json(invoice);
});

// Delete invoice
app.delete('/api/invoices/:number', (req, res) => {
  const data = readData();
  data.invoices = data.invoices.filter(inv => inv.invoiceNumber !== req.params.number);
  writeData(data);
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
