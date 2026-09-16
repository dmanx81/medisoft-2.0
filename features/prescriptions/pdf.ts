import PDFDocument from 'pdfkit';
import { prescriptionFromSnapshot } from './snapshot';
import type { PrescriptionSnapshot } from './types';

const A5: [number, number] = [419.53, 595.28];
const MARGIN = 32;
const INK = '#17353A';
const TEAL = '#0F766E';
const SLATE = '#5B6B70';
const LINE = '#D7DEE0';

function stamp(value: string) {
  if (!value) return '';
  return value.slice(0, 10);
}

function present(value: string | undefined) {
  return Boolean(value && value.trim());
}

function join(parts: Array<string | undefined>, separator = ' · ') {
  return parts.filter((part) => present(part)).join(separator);
}

function dateLabel(value: string) {
  const parts = stamp(value).split('-');
  if (parts.length !== 3) return value || '';
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function renderPrescriptionPdf(
  snapshot: PrescriptionSnapshot,
  options?: { draft?: boolean; cancelled?: boolean },
): Promise<Buffer> {
  const rx = options?.draft ? snapshot : prescriptionFromSnapshot(snapshot);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: A5,
      margin: MARGIN,
      bufferPages: true,
      compress: false,
      info: {
        Title: rx.prescription.prescription_number
          ? `Prescription ${rx.prescription.prescription_number}`
          : 'Prescription draft',
        Author: rx.organization.legal_name || rx.organization.name,
        Creator: 'MEDISOFT',
        CreationDate: rx.prescription.finalized_at
          ? new Date(rx.prescription.finalized_at)
          : undefined,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const left = MARGIN;
    const width = doc.page.width - MARGIN * 2;
    const bottom = () => doc.page.height - MARGIN - 28;

    function banner() {
      if (options?.cancelled) {
        doc.fillColor('#C2410C').fontSize(9).text('CANCELLED / REVOKED', left, MARGIN - 16, {
          width,
          align: 'right',
        });
      } else if (options?.draft) {
        doc.fillColor('#C2410C').fontSize(9).text('DRAFT — NOT AN ISSUED PRESCRIPTION', left, MARGIN - 16, {
          width,
          align: 'right',
        });
      }
    }

    function identification(compact: boolean) {
      const orgName = rx.organization.legal_name || rx.organization.name;
      let textX = left;
      if (rx.organization.logo?.png_base64) {
        try {
          const image = Buffer.from(rx.organization.logo.png_base64, 'base64');
          const logoHeight = compact ? 28 : 42;
          const ratio = rx.organization.logo.width / rx.organization.logo.height;
          const logoWidth = Math.min(compact ? 70 : 90, logoHeight * ratio);
          doc.image(image, left, doc.y, { width: logoWidth, height: logoHeight });
          textX = left + logoWidth + 10;
        } catch {
          textX = left;
        }
      }
      const headerY = doc.y;
      doc.fillColor(INK).fontSize(compact ? 10 : 13).text(orgName, textX, headerY, {
        width: doc.page.width - MARGIN - textX,
      });
      doc.fillColor(SLATE).fontSize(8);
      const contact = join([
        rx.organization.address,
        join([rx.organization.postal_code, rx.organization.city], ' '),
        rx.organization.country,
      ]);
      if (contact) doc.text(contact, textX, doc.y, { width: doc.page.width - MARGIN - textX });
      const channels = join([
        rx.organization.phone,
        rx.organization.email,
        rx.organization.website,
      ]);
      if (channels) doc.text(channels, textX, doc.y, { width: doc.page.width - MARGIN - textX });
      if (present(rx.organization.registration_number))
        doc.text(
          `Registration ${rx.organization.registration_number}`,
          textX,
          doc.y,
          { width: doc.page.width - MARGIN - textX },
        );
      doc.y = Math.max(doc.y, headerY + (compact ? 32 : 48));
      doc.moveTo(left, doc.y).lineTo(left + width, doc.y).strokeColor(LINE).stroke();
      doc.moveDown(0.4);
      doc.fillColor(TEAL).fontSize(compact ? 10 : 12).text('PRESCRIPTION', left, doc.y);
      doc.fillColor(INK).fontSize(9);
      doc.text(
        join([
          rx.prescription.prescription_number || 'Draft',
          rx.prescription.prescription_date
            ? dateLabel(rx.prescription.prescription_date)
            : '',
        ]),
      );
      doc.fillColor(SLATE).fontSize(8);
      doc.text(
        join([
          `${rx.patient.last_name}, ${rx.patient.first_name}`,
          rx.patient.patient_number,
          rx.patient.date_of_birth
            ? `DOB ${dateLabel(rx.patient.date_of_birth)}`
            : '',
        ]),
      );
      doc.moveDown(0.3);
    }

    function ensure(needed: number) {
      if (doc.y + needed <= bottom()) return;
      doc.addPage({ size: A5, margin: MARGIN });
      banner();
      doc.y = MARGIN;
      identification(true);
    }

    function labeled(label: string, value: string) {
      if (!present(value)) return;
      ensure(18);
      doc.fillColor(SLATE).fontSize(7).text(label, { continued: true });
      doc.fillColor(INK).fontSize(9).text(`  ${value}`);
    }

    banner();
    identification(false);
    doc.moveDown(0.2);
    doc.fillColor(INK).fontSize(10).text('Patient');
    doc.fontSize(9).text(`${rx.patient.last_name}, ${rx.patient.first_name}`);
    doc.fillColor(SLATE).fontSize(8);
    doc.text(
      join([
        rx.patient.patient_number,
        rx.patient.date_of_birth ? `Date of birth ${dateLabel(rx.patient.date_of_birth)}` : '',
      ]) || 'Patient identity as recorded at finalization',
    );
    if (present(rx.prescription.clinical_note)) {
      doc.moveDown(0.25);
      doc.fillColor(INK).fontSize(9).text('Clinical note');
      doc.fillColor(SLATE).fontSize(8).text(rx.prescription.clinical_note, { width });
    }
    doc.moveDown(0.35);
    ensure(40);
    doc.fillColor(TEAL).fontSize(16).text('Rx', left, doc.y, { continued: true });
    doc.fillColor(INK).fontSize(10).text('  Medications');
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).strokeColor(TEAL).stroke();
    doc.moveDown(0.25);
    rx.items
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .forEach((item, index) => {
        ensure(48);
        doc.fillColor(INK).fontSize(10).text(`${index + 1}.  ${item.medication_name}`, {
          width,
        });
        const details = join([
          item.strength,
          item.form,
          item.dose,
          item.route,
          item.frequency,
          item.duration,
          item.quantity ? `Qty ${item.quantity}` : '',
        ]);
        if (details) {
          doc.fillColor(SLATE).fontSize(8).text(details, { width });
        }
        labeled('Strength', item.strength && details.includes(item.strength) ? '' : item.strength);
        if (present(item.instructions)) {
          doc.fillColor(INK).fontSize(8).text(item.instructions, { width });
        }
        doc.moveDown(0.2);
      });
    if (present(rx.prescription.general_instructions)) {
      ensure(36);
      doc.fillColor(INK).fontSize(10).text('Instructions');
      doc.fillColor(SLATE).fontSize(8).text(rx.prescription.general_instructions, { width });
    }
    ensure(70);
    doc.moveDown(0.4);
    doc.fillColor(INK).fontSize(10).text('Prescribing doctor');
    doc.fontSize(9).text(
      join([rx.doctor.title, rx.doctor.display_name], ' ') || rx.doctor.display_name,
    );
    doc.fillColor(SLATE).fontSize(8);
    const doctorMeta = join([
      rx.doctor.specialty,
      rx.doctor.department,
      rx.doctor.license_number ? `License ${rx.doctor.license_number}` : '',
      rx.doctor.qualifications,
    ]);
    if (doctorMeta) doc.text(doctorMeta, { width });
    if (rx.doctor.signature?.png_base64) {
      try {
        const image = Buffer.from(rx.doctor.signature.png_base64, 'base64');
        const height = 36;
        const ratio = rx.doctor.signature.width / rx.doctor.signature.height;
        ensure(height + 8);
        doc.image(image, left, doc.y, {
          width: Math.min(110, height * ratio),
          height,
        });
        doc.moveDown(2.4);
      } catch {
        doc.moveDown(0.2);
      }
    }
    doc.fillColor(SLATE).fontSize(8);
    if (rx.prescription.finalized_at)
      doc.text(
        `Finalized ${dateLabel(rx.prescription.finalized_at)} by ${rx.prescription.finalized_by_name || '—'}`,
      );

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      doc.switchToPage(range.start + i);
      const footerY = doc.page.height - 26;
      doc.moveTo(MARGIN, footerY - 8).lineTo(doc.page.width - MARGIN, footerY - 8)
        .strokeColor(LINE).stroke();
      doc.fillColor(SLATE).fontSize(7);
      doc.text(
        join([
          rx.organization.phone,
          rx.organization.email,
          rx.prescription.prescription_number || 'Draft prescription',
        ]),
        MARGIN,
        footerY - 4,
        { width: width - 70 },
      );
      doc.text(`Page ${i + 1} of ${range.count}`, MARGIN, footerY - 4, {
        width,
        align: 'right',
      });
    }
    doc.end();
  });
}
