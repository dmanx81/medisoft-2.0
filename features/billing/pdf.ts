import PDFDocument from 'pdfkit';
import { invoiceFromSnapshot } from './snapshot';
import { moneyLabel } from './format';
import type { LabInvoiceSnapshot } from './types';

function stamp(value: string) {
  if (!value) return '—';
  return value.slice(0, 16).replace('T', ' ');
}

export function renderInvoicePdf(snapshot: LabInvoiceSnapshot): Promise<Buffer> {
  const invoice = invoiceFromSnapshot(snapshot);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      bufferPages: true,
      compress: false,
      info: {
        Title: `Invoice ${invoice.invoice.invoice_number}`,
        Author: invoice.organization.name,
        Creator: 'MEDISOFT',
        CreationDate: invoice.invoice.issued_at
          ? new Date(invoice.invoice.issued_at)
          : undefined,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const currency = invoice.invoice.currency;
    doc.fillColor('#17353A').fontSize(16).text(invoice.organization.name || 'Laboratory');
    doc.fontSize(9).fillColor('#5B6B70');
    const contact = [
      invoice.organization.address,
      invoice.organization.phone,
      invoice.organization.email,
      invoice.organization.country,
    ].filter(Boolean);
    if (contact.length) doc.text(contact.join(' · '));
    doc.moveDown(0.5);
    doc.fillColor('#0F766E').fontSize(13).text('Invoice');
    doc.moveDown(0.4);
    doc.fillColor('#17353A').fontSize(10);
    doc.text(`Invoice ${invoice.invoice.invoice_number}`);
    doc.fontSize(9).fillColor('#5B6B70');
    doc.text(
      `Issued ${stamp(invoice.invoice.issued_at)} by ${invoice.invoice.issued_by_name || '—'}`,
    );
    doc.text(`Currency ${currency}`);
    if (invoice.invoice.due_date) {
      doc.text(`Due ${invoice.invoice.due_date}`);
    }
    doc.moveDown(0.7);
    doc.fillColor('#17353A').fontSize(11).text('Customer');
    doc.fontSize(9);
    doc.text(
      `${invoice.patient.last_name}, ${invoice.patient.first_name}  ·  ${invoice.patient.patient_number}`,
    );
    doc.fillColor('#5B6B70');
    const address = [
      invoice.patient.address_line_1,
      invoice.patient.address_line_2,
      [invoice.patient.postal_code, invoice.patient.city].filter(Boolean).join(' '),
      invoice.patient.country,
    ].filter(Boolean);
    if (address.length) doc.text(address.join(', '));
    doc.moveDown(0.5);
    doc.fillColor('#17353A').fontSize(11).text('Order');
    doc.fontSize(9).fillColor('#5B6B70');
    doc.text(
      `${invoice.order.order_number}${invoice.order.ordered_at ? `  ·  ${stamp(invoice.order.ordered_at)}` : ''}`,
    );
    if (invoice.order.ordering_physician_name)
      doc.text(`Physician ${invoice.order.ordering_physician_name}`);
    doc.moveDown(0.7);
    doc.fillColor('#17353A').fontSize(11).text('Items');
    doc.moveDown(0.2);
    doc.fontSize(8).fillColor('#5B6B70');
    doc.text('Code / test', 48, doc.y, { continued: true });
    doc.text('Qty', 280, doc.y, { continued: true, width: 40, align: 'right' });
    doc.text('Price', 330, doc.y, { continued: true, width: 70, align: 'right' });
    doc.text('Total', 430, doc.y, { width: 110, align: 'right' });
    doc.moveTo(48, doc.y).lineTo(547, doc.y).strokeColor('#D7DEE0').stroke();
    doc.fillColor('#17353A').fontSize(9);
    for (const line of invoice.lines) {
      const y = doc.y + 6;
      doc.text(`${line.code}  ${line.name}`, 48, y, { width: 220 });
      const rowY = y;
      doc.text(line.quantity, 280, rowY, { width: 40, align: 'right' });
      doc.text(moneyLabel(line.unit_price, currency), 330, rowY, {
        width: 70,
        align: 'right',
      });
      doc.text(moneyLabel(line.line_total, currency), 430, rowY, {
        width: 110,
        align: 'right',
      });
      doc.moveDown(0.4);
    }
    doc.moveDown(0.6);
    doc.fontSize(9).fillColor('#5B6B70');
    const totals = [
      ['Subtotal', invoice.totals.subtotal],
      ['Discount', invoice.totals.discount_total],
      ['Tax', invoice.totals.tax_total],
      ['Total', invoice.totals.total],
    ];
    for (const [label, amount] of totals) {
      doc.text(label, 330, doc.y, { continued: true, width: 90 });
      doc.fillColor(label === 'Total' ? '#17353A' : '#5B6B70');
      doc.text(moneyLabel(amount, currency), 430, doc.y, {
        width: 110,
        align: 'right',
      });
      doc.fillColor('#5B6B70');
    }
    if (invoice.invoice.notes) {
      doc.moveDown(1);
      doc.fillColor('#17353A').fontSize(11).text('Notes');
      doc.fontSize(9).fillColor('#5B6B70').text(invoice.invoice.notes);
    }
    doc.moveDown(1);
    doc.fontSize(8).fillColor('#5B6B70').text(
      'This document is the official issued invoice. Later payments change the balance, not these billed amounts.',
    );
    doc.end();
  });
}

export function renderReceiptPdf(input: {
  receiptId: string;
  invoice: LabInvoiceSnapshot;
  payment: {
    amount: string;
    currency: string;
    method: string;
    reference: string;
    received_at: string;
    recorded_by_name: string;
  };
  reversals: { amount: string; reason: string; created_at: string; recorded_by_name: string }[];
}): Promise<Buffer> {
  const invoice = invoiceFromSnapshot(input.invoice);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      bufferPages: true,
      compress: false,
      info: {
        Title: `Receipt ${input.receiptId}`,
        Author: invoice.organization.name,
        Creator: 'MEDISOFT',
        CreationDate: input.payment.received_at
          ? new Date(input.payment.received_at)
          : undefined,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const currency = input.payment.currency;
    doc.fillColor('#17353A').fontSize(16).text(invoice.organization.name || 'Laboratory');
    doc.fontSize(9).fillColor('#5B6B70');
    const contact = [
      invoice.organization.address,
      invoice.organization.phone,
      invoice.organization.email,
      invoice.organization.country,
    ].filter(Boolean);
    if (contact.length) doc.text(contact.join(' · '));
    doc.moveDown(0.5);
    doc.fillColor('#0F766E').fontSize(13).text('Payment receipt');
    doc.moveDown(0.4);
    doc.fillColor('#17353A').fontSize(10);
    doc.text(`Receipt ${input.receiptId}`);
    doc.fontSize(9).fillColor('#5B6B70');
    doc.text(`Invoice ${invoice.invoice.invoice_number}`);
    doc.text(`Received ${stamp(input.payment.received_at)} by ${input.payment.recorded_by_name || '—'}`);
    doc.moveDown(0.7);
    doc.fillColor('#17353A').fontSize(11).text('Customer');
    doc.fontSize(9);
    doc.text(
      `${invoice.patient.last_name}, ${invoice.patient.first_name}  ·  ${invoice.patient.patient_number}`,
    );
    doc.moveDown(0.7);
    doc.fillColor('#17353A').fontSize(11).text('Payment');
    doc.fontSize(9).fillColor('#5B6B70');
    doc.text(`Amount ${moneyLabel(input.payment.amount, currency)}`);
    doc.text(`Method ${input.payment.method}`);
    if (input.payment.reference) doc.text(`Reference ${input.payment.reference}`);
    doc.text(`Currency ${currency}`);
    if (input.reversals.length > 0) {
      doc.moveDown(0.8);
      doc.fillColor('#B45309').fontSize(11).text('Subsequent reversals');
      doc.fontSize(9).fillColor('#5B6B70');
      doc.text(
        'This receipt records the original payment. Later reversals are listed here and do not rewrite the original payment.',
      );
      for (const reversal of input.reversals) {
        doc.text(
          `${moneyLabel(reversal.amount, currency)} on ${stamp(reversal.created_at)} by ${reversal.recorded_by_name || '—'} — ${reversal.reason}`,
        );
      }
    }
    doc.moveDown(1);
    doc.fontSize(8).fillColor('#5B6B70').text(
      'This receipt is generated from immutable payment and invoice snapshot data. Card numbers and secrets are never stored.',
    );
    doc.end();
  });
}
