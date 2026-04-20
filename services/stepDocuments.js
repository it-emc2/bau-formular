const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { buildDocumentPackage } = require('./documentLetter');

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function formatDate(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed);
}

function buildCustomerName(data = {}) {
  const salutation = normalizeWhitespace(data.anrede);
  const firstName = normalizeWhitespace(data.vorname);
  const lastName = normalizeWhitespace(data.nachname);

  if (salutation === 'Familie' && lastName) return `Familie ${lastName}`;
  return [salutation === 'Familie' ? '' : salutation, firstName, lastName].filter(Boolean).join(' ');
}

function buildAddressLine(data = {}) {
  const address = data.adresse || {};
  return [
    normalizeWhitespace(address.strasse),
    normalizeWhitespace(address.adresszeile2),
    [normalizeWhitespace(address.plz), normalizeWhitespace(address.stadt)].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');
}

function buildBasicInfoLines(data = {}) {
  return [
    ['Termin-ID', data.terminId],
    ['Art des Termins', data.artDesTermins],
    ['Terminstatus', data.terminStatus],
    ['Auftrags-Nummer', data.auftragsNummer],
    ['Kunde', buildCustomerName(data)],
    ['Adresse', buildAddressLine(data)],
  ]
    .filter(([, value]) => normalizeWhitespace(value))
    .map(([label, value]) => `${label}: ${normalizeWhitespace(value)}`);
}

function buildInspectionLines(data = {}) {
  const rows = [
    ['Wandverkleidung(en)', data.wareWandverkleidungenStatus],
    ['Duschabtrennung(en)', data.wareDuschabtrennungenStatus],
    ['Duschwanne', data.wareDuschwanneStatus],
    ['Badewannentür', data.wareBadewannentuerStatus],
    ['Waschtisch', data.wareWaschtischStatus],
    ['Toilette', data.wareToiletteStatus],
    ['Haltegriff', data.wareHaltegriffStatus],
    ['Böden', data.wareBoedenStatus],
    ['Geländer', data.wareGelaenderStatus],
    ['Sonstiges', data.wareSonstigesStatus],
  ];

  return rows
    .filter(([, value]) => normalizeWhitespace(value))
    .map(([label, value]) => `${label}: ${value === 'io' ? 'I.O.' : 'Nicht I.O.'}`);
}

function buildChecklistLines(data = {}) {
  const checks = [
    ['Regelmäßige Fotos während der Umsetzung', data.checklistFotosWaerendUmsetzung],
    ['Finale Fotos gemacht', data.checklistFinaleFotos],
    ['Fotos an Handwerkskoordination übermittelt', data.checklistFotosHandwerkskoordination],
    ['Verbrauchsmaterial erfasst', data.checklistVerbrauchsmaterialErfasst],
    ['Warenkorb geschickt', data.checklistWarenkorbGeschickt],
    ['Dokument Warenprüfung unterschrieben', data.checklistDokumentWarenpruefung],
    ['Arbeitszeiten erfasst', data.checklistArbeitszeitenErfasst],
    ['Bestätigung Kasse unterschrieben', data.checklistBestaetigungKasse],
    ['Dokument Arbeitsbericht unterschrieben', data.checklistDokumentArbeitsbericht],
    ['Gratis Haltegriff montiert', data.checklistGratisHaltegriffMontiert],
    ['Baustelle sauber', data.abschlusskontrolleBaustelleSauber],
    ['Verpackung entsorgt', data.abschlusskontrolleVerpackungEntsorgt],
    ['Funktionstest durchgeführt', data.abschlusskontrolleFunktionstest],
    ['Kunde eingewiesen', data.abschlusskontrolleKundeEingewiesen],
    ['Werkzeuge mitgenommen', data.abschlusskontrolleWerkzeugeMitgenommen],
  ];

  return checks
    .filter(([, value]) => value === true)
    .map(([label]) => `Erledigt: ${label}`);
}

function buildFileLines(data = {}, fieldNames = []) {
  return fieldNames
    .map(fieldName => {
      const value = data[fieldName];
      const count = Array.isArray(value) ? value.length : (normalizeWhitespace(value) ? 1 : 0);
      if (!count) return '';
      return `${fieldName}: ${count} Datei(en)`;
    })
    .filter(Boolean);
}

function sanitizeFilenamePart(value, fallback = 'formular') {
  const cleaned = normalizeWhitespace(value)
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return cleaned || fallback;
}

function normalizeChecklistSourceValue(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getChecklistVariant(data = {}) {
  const sourceValue =
    data.auszufuehrendeTaetigkeiten ||
    data.bitrixExecutionActivities ||
    data.bitrixAuszufuehrendeTaetigkeiten ||
    '';
  const rawValues = Array.isArray(sourceValue)
    ? sourceValue
    : String(sourceValue).split(',');

  const normalizedValues = rawValues
    .map(value => normalizeChecklistSourceValue(value).trim())
    .filter(Boolean);

  if (normalizedValues.some(value => value.includes('handlaufe'))) {
    return {
      key: 'handlaeufe',
      title: '06-Checkliste-Handlaeufe',
      fileNamePrefix: '06-checkliste-handlaeufe',
    };
  }

  if (normalizedValues.some(value => value.includes('badewannenture') || value.includes('badewannentur'))) {
    return {
      key: 'badewannentuer',
      title: '06-Checkliste-Badewannentuer',
      fileNamePrefix: '06-checkliste-badewannentuer',
    };
  }

  return {
    key: 'badumbau',
    title: '06-Checkliste-Badumbau',
    fileNamePrefix: '06-checkliste-badumbau',
  };
}

async function embedSignatureIfPresent(pdfDoc, page, signatureDataUrl, y) {
  if (!normalizeWhitespace(signatureDataUrl)) return y;

  const base64Payload = String(signatureDataUrl).split(',')[1] || '';
  if (!base64Payload) return y;

  try {
    const pngImage = await pdfDoc.embedPng(Buffer.from(base64Payload, 'base64'));
    const maxWidth = 180;
    const maxHeight = 70;
    const scale = Math.min(maxWidth / pngImage.width, maxHeight / pngImage.height, 1);
    const width = pngImage.width * scale;
    const height = pngImage.height * scale;

    page.drawText('Unterschrift:', {
      x: 50,
      y,
      size: 11,
      color: rgb(0.2, 0.2, 0.2),
    });
    y -= 14;

    page.drawImage(pngImage, {
      x: 50,
      y: y - height,
      width,
      height,
    });

    return y - height - 16;
  } catch (_error) {
    return y;
  }
}

async function buildStepPdf({ title, subtitle = '', lines = [], signatureDataUrl = '', fileName }) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = 790;

  page.drawText(title, {
    x: 50,
    y,
    size: 18,
    font: bold,
    color: rgb(0.15, 0.15, 0.15),
  });
  y -= 28;

  if (subtitle) {
    page.drawText(subtitle, {
      x: 50,
      y,
      size: 11,
      font,
      color: rgb(0.35, 0.35, 0.35),
    });
    y -= 24;
  }

  lines.forEach(line => {
    page.drawText(String(line), {
      x: 50,
      y,
      size: 11,
      font,
      color: rgb(0.1, 0.1, 0.1),
      maxWidth: 495,
      lineHeight: 14,
    });
    y -= 18;
  });

  y -= 12;
  y = await embedSignatureIfPresent(pdfDoc, page, signatureDataUrl, y);

  page.drawText(`Erstellt am ${formatDate(new Date())}`, {
    x: 50,
    y: 40,
    size: 10,
    font,
    color: rgb(0.45, 0.45, 0.45),
  });

  const pdfBytes = await pdfDoc.save();
  return {
    filename: fileName,
    base64: Buffer.from(pdfBytes).toString('base64'),
  };
}

async function buildStepDocumentAttachments(data = {}, { includeDebug = false } = {}) {
  const customerSlug = sanitizeFilenamePart(buildCustomerName(data), 'kunde');
  const attachments = [];
  const checklistVariant = getChecklistVariant(data);
  const docSpecs = [
    {
      enabled: true,
      title: '01-Abschluss-der-Baustelle',
      fileName: `01-abschluss-der-baustelle-${customerSlug}.pdf`,
      lines: buildBasicInfoLines(data),
    },
    {
      enabled: true,
      title: '02-Warenpruefung-vor-Baubeginn',
      fileName: `02-warenpruefung-${customerSlug}.pdf`,
      lines: [
        `Datum: ${formatDate(data.warenpruefungDatum)}`,
        ...buildInspectionLines(data),
        normalizeWhitespace(data.warenpruefungKommentar)
          ? `Kommentar: ${normalizeWhitespace(data.warenpruefungKommentar)}`
          : '',
      ].filter(Boolean),
      signatureDataUrl: data.unterschriftWarenpruefung,
    },
    // 03 + 04: actual files are appended below (not PDFs)

    {
      enabled: true,
      title: '05-Abschluss-und-Unterschrift',
      fileName: `05-abschluss-und-unterschrift-${customerSlug}.pdf`,
      lines: [
        `Abgeschlossen am: ${formatDate(data.abgeschlossenAm)}`,
        normalizeWhitespace(data.alleArbeitenErledigt)
          ? `Alle Arbeiten durchgeführt: ${normalizeWhitespace(data.alleArbeitenErledigt)}`
          : '',
        normalizeWhitespace(data.nichtErledigteArbeiten)
          ? `Nicht durchgeführt: ${normalizeWhitespace(data.nichtErledigteArbeiten)}`
          : '',
      ].filter(Boolean),
      signatureDataUrl: data.unterschriftKunde,
    },
    {
      enabled: true,
      title: checklistVariant.title,
      fileName: `${checklistVariant.fileNamePrefix}-${customerSlug}.pdf`,
      lines: [
        ...buildChecklistLines(data),
        normalizeWhitespace(data.checklistGratisHaltegriffKommentar)
          ? `Kommentar Gratisaktion: ${normalizeWhitespace(data.checklistGratisHaltegriffKommentar)}`
          : '',
        normalizeWhitespace(data.sonstigeBemerkungenBaustelle)
          ? `Sonstige Bemerkungen: ${normalizeWhitespace(data.sonstigeBemerkungenBaustelle)}`
          : '',
        `Datum: ${formatDate(data.unterschriftMonteurDatum)}`,
      ].filter(Boolean),
      signatureDataUrl: data.unterschriftMonteur1 || data.unterschriftMonteur2,
    },
    {
      enabled: includeDebug && (normalizeWhitespace(data.unterschriftMaengel) || normalizeWhitespace(data.maengelAbgeschlossenAm)),
      title: '08-Maengelbeseitigung',
      fileName: `08-maengelbeseitigung-${customerSlug}.pdf`,
      lines: [`Abgeschlossen am: ${formatDate(data.maengelAbgeschlossenAm)}`].filter(Boolean),
      signatureDataUrl: data.unterschriftMaengel,
    },
    {
      enabled: includeDebug && (normalizeWhitespace(data.unterschriftNB) || normalizeWhitespace(data.nachbesserungAbgeschlossenAm)),
      title: '09-Nachbesserung',
      fileName: `09-nachbesserung-${customerSlug}.pdf`,
      lines: [
        `Abgeschlossen am: ${formatDate(data.nachbesserungAbgeschlossenAm)}`,
        normalizeWhitespace(data.alleArbeitenNB)
          ? `Alle Arbeiten durchgeführt: ${normalizeWhitespace(data.alleArbeitenNB)}`
          : '',
        normalizeWhitespace(data.nichtErledigteArbeitenNB)
          ? `Nicht durchgeführt: ${normalizeWhitespace(data.nichtErledigteArbeitenNB)}`
          : '',
      ].filter(Boolean),
      signatureDataUrl: data.unterschriftNB,
    },
  ];

  for (const spec of docSpecs) {
    if (!spec.enabled) continue;
    attachments.push(await buildStepPdf({
      title: spec.title.replace(/-/g, ' '),
      subtitle: buildCustomerName(data),
      lines: spec.lines.length ? spec.lines : ['Keine zusätzlichen Angaben.'],
      signatureDataUrl: spec.signatureDataUrl,
      fileName: spec.fileName,
    }));
  }

  // 03/04: Attach actual uploaded files as base64
  const fileFields = [
    'bilderFertigerUmbau', 'videoDesAblaufs', 'fotosAbdichtung',
    'bilderBehobeneMaengel', 'weitereBilder', 'weitereBilder2', 'weitereBilder3',
  ];
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  let fileIndex = 0;

  for (const fieldName of fileFields) {
    const paths = Array.isArray(data[fieldName]) ? data[fieldName] : (data[fieldName] ? [data[fieldName]] : []);
    for (const filePath of paths) {
      const normalized = String(filePath || '').trim();
      if (!normalized) continue;
      const basename = path.basename(normalized);
      const fullPath = path.join(uploadsDir, basename);
      try {
        const fileBuffer = fs.readFileSync(fullPath);
        fileIndex++;
        const ext = path.extname(basename).toLowerCase() || '.bin';
        attachments.push({
          filename: `${String(fileIndex).padStart(2, '0')}-${fieldName}${ext}`,
          base64: fileBuffer.toString('base64'),
        });
      } catch (_err) {
        // File not found on disk — skip
      }
    }
  }

  // 07: Confirmation letter as PDF
  try {
    const letterPdf = await buildConfirmationLetterPdf(data);
    attachments.push(letterPdf);
  } catch (_err) {
    // Skip if letter generation fails
  }

  return attachments;
}

async function buildConfirmationLetterPdf(data = {}) {
  const doc = buildDocumentPackage(data);
  const customerSlug = sanitizeFilenamePart(buildCustomerName(data), 'kunde');
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]);
  const font = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const bold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);

  let y = 760;
  const x = 70;
  const maxWidth = 455;

  // Address block
  const addressLines = [
    buildCustomerName(data),
    normalizeWhitespace(data.adresse?.strasse),
    normalizeWhitespace(data.adresse?.adresszeile2),
    [normalizeWhitespace(data.adresse?.plz), normalizeWhitespace(data.adresse?.stadt)].filter(Boolean).join(' '),
  ].filter(Boolean);

  for (const line of addressLines) {
    page.drawText(line, { x, y, size: 12, font, color: rgb(0.1, 0.1, 0.1) });
    y -= 16;
  }

  // Date line
  y -= 24;
  const city = normalizeWhitespace(data.adresse?.stadt) || 'Leipzig';
  const now = new Date();
  const monthYear = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(now);
  const dateLine = `${city}, im ${monthYear.charAt(0).toUpperCase() + monthYear.slice(1)}`;
  const dateWidth = font.widthOfTextAtSize(dateLine, 12);
  page.drawText(dateLine, { x: 595.28 - 70 - dateWidth, y, size: 12, font, color: rgb(0.1, 0.1, 0.1) });

  // Body
  y -= 40;
  page.drawText('Sehr geehrte Damen und Herren,', { x, y, size: 12, font, color: rgb(0.1, 0.1, 0.1) });
  y -= 28;

  const bodyText = doc.text.split('\n').slice(
    doc.text.split('\n').findIndex(l => l.startsWith('hiermit')),
    doc.text.split('\n').findIndex(l => l.startsWith('Mit freundlichen'))
  ).join(' ').trim();

  // Word-wrap body text
  const words = bodyText.split(/\s+/);
  let currentLine = '';
  for (const word of words) {
    const test = currentLine ? `${currentLine} ${word}` : word;
    if (font.widthOfTextAtSize(test, 12) > maxWidth && currentLine) {
      page.drawText(currentLine, { x, y, size: 12, font, color: rgb(0.1, 0.1, 0.1) });
      y -= 18;
      currentLine = word;
    } else {
      currentLine = test;
    }
  }
  if (currentLine) {
    page.drawText(currentLine, { x, y, size: 12, font, color: rgb(0.1, 0.1, 0.1) });
    y -= 18;
  }

  // Closing
  y -= 20;
  page.drawText('Mit freundlichen Grüßen', { x, y, size: 12, font, color: rgb(0.1, 0.1, 0.1) });
  y -= 28;

  // Signature
  y = await embedSignatureIfPresent(pdfDoc, page, data.unterschriftKunde, y);

  // Customer name
  page.drawText(buildCustomerName(data) || 'Kundin / Kunde', { x, y, size: 12, font, color: rgb(0.1, 0.1, 0.1) });

  // Footer
  page.drawText(`Erstellt am ${formatDate(new Date())}`, {
    x: 70, y: 40, size: 10, font, color: rgb(0.45, 0.45, 0.45),
  });

  const pdfBytes = await pdfDoc.save();
  return {
    filename: `07-bestaetigung-erfolgreicher-umbau-${customerSlug}.pdf`,
    base64: Buffer.from(pdfBytes).toString('base64'),
  };
}

module.exports = {
  buildStepDocumentAttachments,
  getChecklistVariant,
};
