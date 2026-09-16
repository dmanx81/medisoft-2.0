import PDFDocument from 'pdfkit';
import { prescriptionFromSnapshot } from './snapshot';
import type { PrescriptionSnapshot } from './types';

const A5: [number, number] = [419.53, 595.28];
const MARGIN = 36;

function stamp(value: string) {
  if (!value) return '';
  return value.slice(0, 10);
}

function lineParts(item: PrescriptionSnapshot['items'][number]) {
  return [
    item.strength && `${item.strength}`,
    item.form,
    item.dose && `Dose ${item.dose}`,
    item.route,
    item.frequency,
    item.duration && `for ${item.duration}`,
    item.quantity && `Qty ${item.quantity}`,
  ].filter(Boolean);
}

export function renderPrescriptionPdf(
  snapshot: PrescriptionSnapshot,
): Promise<Buffer> {
  const clinical = prescriptionFromSnapshot(snapshot);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: A5,
      margin: MARGIN,
      bufferPages: true,
      compress: false,
      info: {
        Title: `Prescription ${clinical.prescription.prescription_number}`,
        Author: clinical.organization.legal_name || clinical.organization.name,
        Creator: 'MEDISOFT',
        CreationDate: clinical.prescription.finalized_at
          ? new Date(clinical.prescription.finalized_at)
          : undefined,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const width = doc.page.width - MARGIN * 2;
    let page = 1;
    const orgTitle =
      clinical.organization.legal_name || clinical.organization.name;

    function header(continued = false) {
      const top = doc.y;
      if (clinical.logo?.bytes) {
        try {
          doc.image(Buffer.from(clinical.logo.bytes, 'base64'), MARGIN, top, {
            fit: [64, 40],
          });
        } catch {
          /* invalid frozen image is omitted rather than failing the document */
        }
      }
      const textX = clinical.logo?.bytes ? MARGIN + 76 : MARGIN;
      doc.fillColor('#17353A').fontSize(12).text(orgTitle, textX, top, {
        width: width - (textX - MARGIN),
      });
      doc.fontSize(8).fillColor('#5B6B70');
      const address = [
        clinical.organization.address,
        [clinical.organization.postal_code, clinical.organization.city]
          .filter(Boolean)
          .join(' '),
        clinical.organization.country,
      ].filter(Boolean);
      if (address.length)
        doc.text(address.join(', '), textX, undefined, {
          width: width - (textX - MARGIN),
        });
      const contact = [
        clinical.organization.phone,
        clinical.organization.email,
        clinical.organization.website,
      ].filter(Boolean);
      if (contact.length)
        doc.text(contact.join(' · '), textX, undefined, {
          width: width - (textX - MARGIN),
        });
      if (clinical.organization.registration_number)
        doc.text(
          `Reg. ${clinical.organization.registration_number}`,
          textX,
          undefined,
          { width: width - (textX - MARGIN) },
        );
      doc.moveDown(0.4);
      doc.fillColor('#0F766E').fontSize(13).text('Prescription');
      doc.fillColor('#17353A').fontSize(9);
      doc.text(
        `${clinical.prescription.prescription_number}  ·  ${stamp(clinical.prescription.prescribed_on)}${continued ? '  ·  continued' : ''}`,
      );
      doc.moveDown(0.3);
      doc.fontSize(10).text(
        `${clinical.patient.last_name}, ${clinical.patient.first_name}  ·  ${clinical.patient.patient_number}`,
      );
      doc.fontSize(8).fillColor('#5B6B70');
      if (clinical.patient.date_of_birth)
        doc.text(`Date of birth ${stamp(clinical.patient.date_of_birth)}`);
      doc.moveDown(0.4);
    }

    function footer() {
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i += 1) {
        doc.switchToPage(range.start + i);
        const previousBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.fontSize(7).fillColor('#5B6B70');
        doc.text(
          `${orgTitle}  ·  ${clinical.prescription.prescription_number}  ·  page ${i + 1} of ${range.count}`,
          MARGIN,
          doc.page.height - 28,
          { width, align: 'center', lineBreak: false },
        );
        doc.page.margins.bottom = previousBottom;
      }
    }

    function ensureSpace(needed: number) {
      if (doc.y + needed <= doc.page.height - MARGIN - 28) return;
      doc.addPage({ size: A5, margin: MARGIN });
      page += 1;
      header(true);
    }

    header(false);
    if (clinical.prescription.clinical_note) {
      ensureSpace(36);
      doc.fillColor('#17353A').fontSize(9).text('Clinical note');
      doc.fontSize(8).fillColor('#5B6B70').text(clinical.prescription.clinical_note, {
        width,
      });
      doc.moveDown(0.4);
    }
    doc.fillColor('#17353A').fontSize(10).text('Rx');
    doc.moveDown(0.2);
    clinical.items.forEach((item, index) => {
      const details = lineParts(item);
      ensureSpace(item.instructions ? 58 : 42);
      doc.fillColor('#17353A').fontSize(9).text(`${index + 1}. ${item.medication_name}`, {
        width,
      });
      if (details.length)
        doc.fontSize(8).fillColor('#5B6B70').text(details.join(' · '), { width });
      if (item.instructions)
        doc.fontSize(8).fillColor('#5B6B70').text(item.instructions, { width });
      doc.moveDown(0.25);
    });
    if (clinical.prescription.instructions) {
      ensureSpace(40);
      doc.fillColor('#17353A').fontSize(9).text('General instructions');
      doc.fontSize(8).fillColor('#5B6B70').text(clinical.prescription.instructions, {
        width,
      });
      doc.moveDown(0.4);
    }
    ensureSpace(70);
    doc.fillColor('#17353A').fontSize(9).text('Prescribing doctor');
    const doctorLine = [
      clinical.doctor.title,
      clinical.doctor.display_name,
    ]
      .filter(Boolean)
      .join(' ');
    doc.fontSize(9).text(doctorLine || clinical.doctor.display_name);
    doc.fontSize(8).fillColor('#5B6B70');
    const doctorMeta = [
      clinical.doctor.specialty,
      clinical.doctor.department,
      clinical.doctor.license_number && `Lic. ${clinical.doctor.license_number}`,
    ].filter(Boolean);
    if (doctorMeta.length) doc.text(doctorMeta.join(' · '));
    if (clinical.signature?.bytes) {
      try {
        doc.image(Buffer.from(clinical.signature.bytes, 'base64'), {
          fit: [90, 36],
        });
      } catch {
        /* omit invalid frozen signature */
      }
    }
    void page;
    footer();
    doc.end();
  });
}

export function pdfPageSize(pdf: Buffer) {
  const match = pdf
    .toString('latin1')
    .match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  return {
    width: match ? Number(match[1]) : 0,
    height: match ? Number(match[2]) : 0,
  };
}
