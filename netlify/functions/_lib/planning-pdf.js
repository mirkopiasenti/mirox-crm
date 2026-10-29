'use strict';
const PDFDocument = require('pdfkit');
const Core = require('../../../js/planning-core');
const path = require('node:path');
const fs = require('node:fs');
const printable = value => String(value).replace(/\s+/g, ' ');

async function generatePdf(input, { type = 'personal', employeeId, draft = true } = {}) {
  if (!['personal', 'collective', 'hours'].includes(type)) throw new Error('Tipo PDF non valido');
  const data = Core.validateDocument(input);
  const employees = type === 'collective' ? data.employees : data.employees.filter(e => e.id === employeeId);
  if (!employees.length) throw new Error('Dipendente non presente');
  const doc = new PDFDocument({
    size: 'A4', layout: type === 'personal' ? 'portrait' : 'landscape', margin: 32, bufferPages: true,
    info: { Title: 'Mirox - Planning personale', Author: 'Mirox CRM' }
  });
  const chunks = [];
  const ready = new Promise((resolve, reject) => {
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const width = doc.page.width - 64;
  const logo = [path.join(process.cwd(), 'assets/logo.png'), path.resolve(__dirname, '../../../assets/logo.png'), path.resolve(__dirname, '../../assets/logo.png')].find(file => fs.existsSync(file));
  const label = new Date(`${data.month}-01T12:00:00Z`).toLocaleDateString('it-IT', { month: 'long', year: 'numeric', timeZone: 'Europe/Rome' });
  const groups = [];
  for (let i = 0; i < employees.length; i += 4) groups.push(employees.slice(i, i + 4));

  function pageHeading() {
    if (logo) doc.image(logo, 30, 19, { fit: [72, 42], align: 'left' });
    doc.fillColor('#0a2540').font('Helvetica-Bold').fontSize(20)
      .text(type === 'hours' ? 'Scheda ore mensili' : 'Planning mensile', 112, 28, { width: width - 90 });
    const subtitle = printable(`Legnago | ${label}${type === 'collective' ? '' : ` | ${employees[0].name}`}`);
    doc.font('Helvetica').fontSize(10).fillColor('#697386');
    const subtitleHeight = doc.heightOfString(subtitle, { width });
    doc.text(subtitle, 32, 77, { width });
    const badgeY = 77 + subtitleHeight + 6;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(draft ? '#b34a00' : '#177245')
      .text(draft ? 'BOZZA - NON APPROVATA' : 'PLANNING APPROVATO', 32, badgeY, { width });
    let y = badgeY + 22;
    if (type === 'hours') {
      doc.font('Helvetica').fontSize(8).fillColor('#697386')
        .text('Ordinarie: dato inserito oppure stima (S) dal turno al netto delle assenze. Straordinari sempre manuali.', 32, badgeY + 14, { width });
      y += 8;
    }
    return y;
  }

  for (const [groupIndex, group] of groups.entries()) {
    if (groupIndex) doc.addPage();
    let y = pageHeading();
    const headings = type === 'collective' ? ['Giorno', ...group.map(e => printable(e.name))]
      : type === 'hours' ? ['Giorno', 'Previste', 'Ordinarie', 'Extra', 'Ferie', 'Permessi', 'Malattia', 'Codice malattia']
        : ['Giorno', 'Orario', 'Indicazioni'];
    const widths = type === 'collective' ? [106, ...group.map(() => (width - 106) / group.length)]
      : type === 'hours' ? [110, 65, 75, 55, 55, 65, 65, width - 490] : [110, 255, width - 365];
    function tableHeader() {
      doc.font('Helvetica-Bold').fontSize(8);
      const height = Math.max(20, ...headings.map((text, i) => doc.heightOfString(text, { width: widths[i] - 14 }) + 12));
      doc.rect(32, y, width, height).fill('#0a2540');
      let x = 32;
      headings.forEach((text, i) => {
        doc.fillColor('#ffffff').text(text, x + 7, y + 6, { width: widths[i] - 14 });
        x += widths[i];
      });
      y += height;
    }
    tableHeader();
    for (const date of Core.dates(data.month)) {
      const days = group.map(e => data.entries.find(d => d.date === date && d.employeeId === e.id));
      const dayLabel = `${Core.WEEKDAYS[Core.weekday(date)].slice(0, 3)} ${date.slice(8)}/${date.slice(5, 7)}`;
      let values;
      if (type === 'collective') values = [dayLabel, ...days.map(d => Core.formatSlots(Core.availableSlots(d)) || (d.absences.length ? 'Assente' : d.closed ? 'Chiusura' : 'Riposo'))];
      else if (type === 'personal') values = [dayLabel, Core.formatSlots(Core.availableSlots(days[0])) || '-', days[0].closed ? 'Chiusura' : days[0].absences.length ? `Assenza ${Core.hours(Core.absenceMinutes(days[0]))}` : !days[0].slots.length ? 'Riposo' : ''];
      else {
        const d = days[0], planned = Core.slotMinutes(d.slots), ordinary = d.workedMinutes ?? planned - Core.absenceMinutes(d);
        values = [dayLabel, Core.hours(planned), `${Core.hours(ordinary)}${d.workedMinutes === null && ordinary ? ' S' : ''}`, Core.hours(d.extraMinutes), ...Core.TYPES.map(t => Core.hours(Core.absenceMinutes(d, t))), d.absences.filter(a => a.type === 'malattia' && a.code).map(a => a.code).join(', ')];
      }
      values = values.map(printable);
      const fontSize = type === 'hours' ? 7.5 : type === 'collective' ? 8 : 9;
      doc.font('Helvetica').fontSize(fontSize);
      const rowHeight = Math.max(type === 'personal' ? 16 : 11, ...values.map((value, i) => doc.heightOfString(value, { width: widths[i] - 14 }) + (type === 'personal' ? 8 : 3)));
      if (y + rowHeight > doc.page.height - 58) { doc.addPage(); y = pageHeading(); tableHeader(); }
      if (Core.weekday(date) === 0 || Core.holiday(date)) doc.rect(32, y, width, rowHeight).fill('#fff3e8');
      else if (Number(date.slice(8)) % 2 === 0) doc.rect(32, y, width, rowHeight).fill('#f6f9fc');
      let x = 32;
      values.forEach((value, i) => {
        doc.font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor('#0a2540')
          .text(value, x + 7, y + (type === 'personal' ? 4 : 1.5), { width: widths[i] - 14 });
        x += widths[i];
      });
      y += rowHeight;
    }
    if (type === 'hours') {
      const summary = Core.summary(data, employeeId);
      if (y + 50 > doc.page.height - 40) { doc.addPage(); y = pageHeading(); }
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#0a2540')
        .text(`Totali | Previste ${Core.hours(summary.planned)} | Ordinarie ${Core.hours(summary.ordinary)} | Extra ${Core.hours(summary.extra)}`, 32, y + 16, { width });
      doc.font('Helvetica').fontSize(9)
        .text(`Ferie ${Core.hours(summary.ferie)} | Permessi ${Core.hours(summary.permessi)} | Malattia ${Core.hours(summary.malattia)} | Giorni ordinari da confermare: ${summary.pending}`, 32, y + 33, { width });
    }
  }
  const count = doc.bufferedPageRange().count;
  for (let i = 0; i < count; i++) {
    doc.switchToPage(i);
    doc.font('Helvetica').fontSize(8).fillColor('#697386')
      .text(`Mirox CRM | ${draft ? 'Bozza' : 'Approvato'} | ${i + 1}/${count}`, 32, doc.page.height - 45, { width, align: 'right', lineBreak: false });
  }
  doc.end();
  return ready;
}
module.exports = { generatePdf };
