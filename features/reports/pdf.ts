import PDFDocument from 'pdfkit';
import type { LabReport, LabReportSnapshot } from './types';

function stamp(value: string) {
  if (!value) return '—';
  return value.slice(0, 16).replace('T', ' ');
}

function flagLabel(flag: string) {
  if (flag === 'CRITICAL_LOW') return 'Critical low';
  if (flag === 'CRITICAL_HIGH') return 'Critical high';
  if (flag === 'LOW') return 'Low';
  if (flag === 'HIGH') return 'High';
  if (flag === 'NORMAL') return 'Normal';
  return 'Not interpreted';
}

export function renderReportPdf(
  report: Pick<LabReport, 'report_number' | 'report_version' | 'status' | 'issued_at' | 'issued_by_name'>,
  snapshot: LabReportSnapshot,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 48,
      bufferPages: true,
      info: {
        Title: `Laboratory report ${report.report_number}`,
        Author: snapshot.organization.name,
        Creator: 'MEDISOFT',
        CreationDate: report.issued_at ? new Date(report.issued_at) : undefined,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const width = doc.page.width - 96;
    doc.fillColor('#17353A').fontSize(16).text(snapshot.organization.name || 'Laboratory');
    doc.fontSize(9).fillColor('#5B6B70');
    const contact = [
      snapshot.organization.address,
      snapshot.organization.phone,
      snapshot.organization.email,
      snapshot.organization.country,
    ].filter(Boolean);
    if (contact.length) doc.text(contact.join(' · '));
    doc.moveDown(0.4);
    doc.fillColor('#0F766E').fontSize(13).text('Laboratory report');
    if (report.status === 'SUPERSEDED') {
      doc.moveDown(0.2);
      doc.fillColor('#C2410C').fontSize(9).text('This report has been superseded by a later issued version.');
    }
    doc.moveDown(0.5);
    doc.fillColor('#17353A').fontSize(10);
    doc.text(`Report ${report.report_number}  ·  Version ${report.report_version}`);
    doc.fontSize(9).fillColor('#5B6B70');
    doc.text(
      `Issued ${stamp(report.issued_at)} by ${report.issued_by_name || '—'}`,
    );
    doc.moveDown(0.8);
    doc.fillColor('#17353A').fontSize(11).text('Patient');
    doc.fontSize(9).fillColor('#17353A');
    doc.text(
      `${snapshot.patient.last_name}, ${snapshot.patient.first_name}  ·  ${snapshot.patient.patient_number}`,
    );
    doc.fillColor('#5B6B70');
    doc.text(
      [
        snapshot.patient.date_of_birth
          ? `Date of birth ${snapshot.patient.date_of_birth.slice(0, 10)}`
          : '',
        snapshot.patient.sex && snapshot.patient.sex !== 'UNKNOWN'
          ? snapshot.patient.sex
          : '',
      ]
        .filter(Boolean)
        .join('  ·  ') || 'Demographics as recorded at issuance',
    );
    doc.moveDown(0.6);
    doc.fillColor('#17353A').fontSize(11).text('Order');
    doc.fontSize(9).fillColor('#5B6B70');
    doc.text(
      [
        snapshot.order.order_number,
        snapshot.order.priority,
        snapshot.order.ordered_at ? `Ordered ${stamp(snapshot.order.ordered_at)}` : '',
        snapshot.order.ordering_physician_name
          ? `Physician ${snapshot.order.ordering_physician_name}`
          : '',
        snapshot.order.fasting_status && snapshot.order.fasting_status !== 'UNKNOWN'
          ? snapshot.order.fasting_status.replace('_', '-')
          : '',
      ]
        .filter(Boolean)
        .join('  ·  '),
    );
    if (snapshot.specimens.length) {
      doc.moveDown(0.3);
      for (const specimen of snapshot.specimens) {
        doc.text(
          [
            specimen.accession_number,
            specimen.specimen_type,
            specimen.status,
            specimen.collected_at ? `Collected ${stamp(specimen.collected_at)}` : '',
            specimen.received_at ? `Received ${stamp(specimen.received_at)}` : '',
          ]
            .filter(Boolean)
            .join('  ·  '),
        );
      }
    }
    doc.moveDown(0.8);
    doc.fillColor('#17353A').fontSize(11).text('Results');
    doc.moveDown(0.3);
    const columns = [70, 150, 70, 130, 80];
    const headers = ['Code', 'Test', 'Result', 'Reference interval', 'Flag'];
    let x = 48;
    doc.fontSize(8).fillColor('#5B6B70');
    headers.forEach((header, index) => {
      doc.text(header, x, doc.y, { width: columns[index], continued: index < headers.length - 1 });
      x += columns[index];
    });
    doc.text('');
    doc.moveTo(48, doc.y).lineTo(48 + width, doc.y).strokeColor('#D7E3E0').stroke();
    doc.moveDown(0.3);
    for (const result of snapshot.results) {
      if (doc.y > doc.page.height - 90) doc.addPage();
      const rowY = doc.y;
      const values = [
        result.test_code,
        result.test_name,
        result.result_display,
        result.reference_range_display || '—',
        flagLabel(result.flag),
      ];
      let cellX = 48;
      doc.fillColor('#17353A').fontSize(9);
      values.forEach((value, index) => {
        doc.text(value, cellX, rowY, {
          width: columns[index],
          continued: index < values.length - 1,
        });
        cellX += columns[index];
      });
      doc.text('');
      doc.fontSize(8).fillColor('#5B6B70');
      doc.text(
        [
          result.unit_symbol ? `Unit ${result.unit_symbol}` : '',
          result.method ? `Method ${result.method}` : '',
          result.clinically_verified_by_name
            ? `Verified by ${result.clinically_verified_by_name} ${stamp(result.clinically_verified_at)}`
            : '',
          result.is_amendment ? 'Amended result' : '',
        ]
          .filter(Boolean)
          .join('  ·  '),
      );
      doc.moveDown(0.35);
    }
    if (snapshot.order.clinical_notes) {
      doc.moveDown(0.4);
      doc.fillColor('#17353A').fontSize(10).text('Clinical notes');
      doc.fontSize(8).fillColor('#5B6B70').text(snapshot.order.clinical_notes);
    }
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i += 1) {
      doc.switchToPage(i);
      doc.fontSize(8).fillColor('#5B6B70');
      doc.text(
        `${report.report_number}  ·  ${snapshot.patient.patient_number}  ·  Page ${i + 1} of ${pages.count}`,
        48,
        doc.page.height - 36,
        { width, align: 'center' },
      );
    }
    doc.end();
  });
}
