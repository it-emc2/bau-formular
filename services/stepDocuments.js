const fs = require('fs');
const path = require('path');
const { PDFDocument, PDFArray, PDFName, StandardFonts, rgb, decodePDFRawStream } = require('pdf-lib');
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

function buildShortAddressLine(data = {}) {
  const address = data.adresse || {};
  return [
    normalizeWhitespace(address.strasse),
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

// Placeholders are literal text strings (e.g. "vorUndNachname") drawn on the
// template PDF. We scan the content streams, pull each placeholder's (x, y)
// from its Tm operator, overlay a white box to hide the placeholder, and draw
// the real value at the same spot. Move a placeholder in the template and the
// code auto-adapts — no hardcoded coordinates.
const EINWILLIGUNG_PLACEHOLDER_KEYS = ['vorUndNachname', 'adresse', 'geburtsdatum', 'signature'];

function findAndStripTemplatePlaceholders(pdfDoc, page, keys) {
  const positions = {};
  const contentsEntry = page.node.Contents();
  if (!contentsEntry) return positions;

  const isArray = typeof contentsEntry.asArray === 'function';
  const rawItems = isArray ? contentsEntry.asArray() : [contentsEntry];
  const keep = [];

  for (const item of rawItems) {
    const stream = item && typeof item.getContents === 'function'
      ? item
      : pdfDoc.context.lookup(item);

    let matchedKey = null;
    if (stream && typeof stream.getContents === 'function') {
      let decoded;
      try { decoded = decodePDFRawStream(stream).decode(); }
      catch (_err) { decoded = null; }
      if (decoded) {
        const text = Buffer.from(decoded).toString('latin1');
        for (const key of keys) {
          if (positions[key]) continue;
          const re = new RegExp(`1\\s+0\\s+0\\s+1\\s+([\\d.]+)\\s+([\\d.]+)\\s+Tm\\s*\\(${key}\\)\\s*Tj`);
          const m = text.match(re);
          if (m) {
            positions[key] = { x: parseFloat(m[1]), y: parseFloat(m[2]) };
            matchedKey = key;
            break;
          }
        }
      }
    }

    if (!matchedKey) keep.push(item);
  }

  if (isArray && keep.length !== rawItems.length) {
    const newArr = PDFArray.withContext(pdfDoc.context);
    keep.forEach(entry => newArr.push(entry));
    page.node.set(PDFName.of('Contents'), newArr);
  }

  return positions;
}

async function buildEinwilligungFromTemplate(data = {}) {
  const templatePath = path.join(__dirname, '..', 'public', 'templates', 'Template3.pdf');
  const templateBytes = fs.readFileSync(templatePath);
  const pdfDoc = await PDFDocument.load(templateBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const page = pdfDoc.getPage(0);

  const positions = findAndStripTemplatePlaceholders(pdfDoc, page, EINWILLIGUNG_PLACEHOLDER_KEYS);

  const stamp = (key, value, { size = 11 } = {}) => {
    const pos = positions[key];
    if (!pos || !normalizeWhitespace(value)) return;
    page.drawText(String(value), {
      x: pos.x,
      y: pos.y,
      size,
      font,
      color: rgb(0.05, 0.05, 0.05),
    });
  };

  stamp('vorUndNachname', buildCustomerName(data));
  stamp('adresse', buildShortAddressLine(data));
  stamp('geburtsdatum', formatDate(data.einwilligungGeburtsdatum));

  const sigPos = positions.signature;
  if (sigPos) {
    const signatureBase64 = String(data.unterschriftEinwilligung || '').split(',')[1] || '';
    if (signatureBase64) {
      try {
        const png = await pdfDoc.embedPng(Buffer.from(signatureBase64, 'base64'));
        const maxW = 220;
        const maxH = 50;
        const scale = Math.min(maxW / png.width, maxH / png.height, 1);
        page.drawImage(png, {
          x: sigPos.x,
          y: sigPos.y - 4,
          width: png.width * scale,
          height: png.height * scale,
        });
      } catch (_err) { /* skip */ }
    }
  }

  const customerSlug = sanitizeFilenamePart(buildCustomerName(data), 'kunde');
  return {
    filename: `08-einwilligung-template-${customerSlug}.pdf`,
    base64: Buffer.from(await pdfDoc.save()).toString('base64'),
  };
}

async function buildEinwilligungPdf(data = {}) {
  const customerSlug = sanitizeFilenamePart(buildCustomerName(data), 'kunde');
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const oblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const pageWidth = 595.28;
  const pageHeight = 841.89;
  const marginX = 55;
  const contentWidth = pageWidth - (2 * marginX);
  const page = pdfDoc.addPage([pageWidth, pageHeight]);
  const text = (s, x, y, { size = 10, f = font, color = rgb(0.1, 0.1, 0.1) } = {}) =>
    page.drawText(String(s), { x, y, size, font: f, color });
  const centerText = (s, y, { size = 10, f = font, color = rgb(0.1, 0.1, 0.1) } = {}) => {
    const w = f.widthOfTextAtSize(String(s), size);
    text(s, (pageWidth - w) / 2, y, { size, f, color });
  };

  let y = pageHeight - 40;

  // ── Barcode + Logo (Dr. Löffler header image) ──────────────────
  try {
    const logoPath = path.join(__dirname, '..', 'public', 'assets', 'barcodelogo.png');
    const logoBytes = fs.readFileSync(logoPath);
    const logoImage = await pdfDoc.embedPng(logoBytes);
    const logoWidth = 400;
    const logoHeight = logoWidth * (logoImage.height / logoImage.width);
    y -= logoHeight;
    page.drawImage(logoImage, { x: marginX, y, width: logoWidth, height: logoHeight });
  } catch (_err) {
    // If the logo is missing, fall back to plain text header
    centerText('Dr. Löffler & Co. KG', y - 20, { size: 22, f: bold, color: rgb(0.12, 0.26, 0.32) });
    centerText('Abrechnung im Gesundheitswesen', y - 38, { size: 10, f: oblique, color: rgb(0.3, 0.3, 0.3) });
    y -= 55;
  }

  // ── Two boxes ─────────────────────────────────────────────────
  y -= 28;
  const boxTop = y;
  const boxHeight = 135;
  const boxGap = 12;
  const boxWidth = (contentWidth - boxGap) / 2;
  const leftBoxX = marginX;
  const rightBoxX = marginX + boxWidth + boxGap;
  const boxBottom = boxTop - boxHeight;

  const borderColor = rgb(0.55, 0.55, 0.6);
  page.drawRectangle({ x: leftBoxX, y: boxBottom, width: boxWidth, height: boxHeight, borderColor, borderWidth: 0.8 });
  page.drawRectangle({ x: rightBoxX, y: boxBottom, width: boxWidth, height: boxHeight, borderColor, borderWidth: 0.8 });

  // Left box content
  {
    const pad = 10;
    let ly = boxTop - pad - 10;
    text('Leistungserbringer/-in im Gesundheitswesen', leftBoxX + pad, ly, { size: 9, color: rgb(0.2, 0.2, 0.2) });
    ly -= 12;
    text('(vollständige Bezeichnung bzw. Praxis-/', leftBoxX + pad, ly, { size: 9, color: rgb(0.2, 0.2, 0.2) });
    ly -= 11;
    text('Firmenstempel)', leftBoxX + pad, ly, { size: 9, color: rgb(0.2, 0.2, 0.2) });

    try {
      const stempelPath = path.join(__dirname, '..', 'public', 'assets', 'stempel.png');
      const stempelBytes = fs.readFileSync(stempelPath);
      const stempelImage = await pdfDoc.embedPng(stempelBytes);
      const innerWidth = boxWidth - 2 * pad;
      const labelBottom = ly - 6;
      const availHeight = labelBottom - (boxBottom + pad);
      const ratio = stempelImage.width / stempelImage.height;
      let drawHeight = Math.min(availHeight, 90);
      let drawWidth = drawHeight * ratio;
      if (drawWidth > innerWidth) {
        drawWidth = innerWidth;
        drawHeight = drawWidth / ratio;
      }
      const drawX = leftBoxX + pad + (innerWidth - drawWidth) / 2;
      const drawY = boxBottom + pad + (availHeight - drawHeight) / 2;
      page.drawImage(stempelImage, { x: drawX, y: drawY, width: drawWidth, height: drawHeight });
    } catch (_err) {
      // Stempel image missing — leave the box empty
    }
  }

  // Right box content
  {
    const pad = 10;
    let ry = boxTop - pad - 10;
    text('Patient/-in bzw. Leistungsempfänger/-in:', rightBoxX + pad, ry, { size: 9, color: rgb(0.2, 0.2, 0.2) });

    const fields = [
      { value: buildCustomerName(data), label: '(Vor- und Nachname)' },
      { value: buildAddressLine(data),  label: '(Adresse)' },
      { value: formatDate(data.einwilligungGeburtsdatum), label: 'Geburtsdatum' },
    ];
    const lineStart = rightBoxX + pad;
    const lineEnd = rightBoxX + boxWidth - pad;
    const lineOffsets = [45, 80, 115];
    fields.forEach((field, idx) => {
      const yLine = boxTop - lineOffsets[idx];
      page.drawLine({
        start: { x: lineStart, y: yLine },
        end: { x: lineEnd, y: yLine },
        thickness: 0.6,
        color: rgb(0.35, 0.35, 0.35),
      });
      if (field.value) {
        text(field.value, lineStart, yLine + 2, { size: 10, color: rgb(0.1, 0.1, 0.1) });
      }
      text(field.label, lineStart, yLine - 11, { size: 8.5, color: rgb(0.3, 0.3, 0.3) });
    });
  }

  // ── Title "Einwilligung zur Abrechnung" (bold, underlined) ─────
  y = boxBottom - 26;
  const titleText = 'Einwilligung zur Abrechnung';
  const titleSize = 12;
  const titleWidth = bold.widthOfTextAtSize(titleText, titleSize);
  text(titleText, marginX, y, { size: titleSize, f: bold });
  page.drawLine({
    start: { x: marginX, y: y - 2 },
    end: { x: marginX + titleWidth, y: y - 2 },
    thickness: 0.8,
    color: rgb(0.1, 0.1, 0.1),
  });

  y -= 18;

  // ── Body paragraphs ───────────────────────────────────────────
  const bodySize = 9.5;
  const bodyLineHeight = 12;
  const paragraphSpacing = 6;

  const drawPara = (paragraph, { centered = false, f = font } = {}) => {
    const wrapped = wrapTextByWidth(paragraph, f, bodySize, contentWidth);
    wrapped.forEach(line => {
      if (centered) {
        const w = f.widthOfTextAtSize(line, bodySize);
        text(line, (pageWidth - w) / 2, y, { size: bodySize, f });
      } else {
        text(line, marginX, y, { size: bodySize, f });
      }
      y -= bodyLineHeight;
    });
    y -= paragraphSpacing;
  };

  drawPara('Ich willige ein, dass mein Name, meine Anschrift, mein Geburtsdatum sowie meine abrechnungsrelevanten Gesundheitsdaten vom Leistungserbringer/-in an die');
  drawPara('Dr. Löffler & Co. KG, Schildergasse 120, 50667 Köln (Abrechnungszentrale)', { centered: true, f: bold });
  drawPara('ausschließlich zur Abtretung und Abrechnung übermittelt und dort verarbeitet werden. Für den Fall, dass ich Selbstzahler bin, stimme ich zu, dass die Abrechnungszentrale im Zuge ihrer Refinanzierung bei der Commerzbank AG meinen Namen und den jeweils offenen Betrag dieser auf Anfrage mitteilt.');
  drawPara('Die Rechtsgrundlagen für die Verarbeitung sind meine Einwilligung, vgl. Art. 9 Abs. 2 Buchstabe a der EU- Datenschutzgrundverordnung sowie die sozialrechtlichen Erlaubnistatbestände, vgl. insbesondere §§ 300 Abs. 2, 302 Abs. 2, 295a Abs. 3 SGB V sowie § 105 Abs. 2 SGB XI. Mir ist bekannt, dass es keine gesetzliche Pflicht gibt, diese Einwilligung zu unterzeichnen, eine Abrechnung über die Abrechnungszentrale bei Verweigerung der Einwilligung aber ggfls. nicht erfolgen könnte.');
  drawPara('Die Abrechnungszentrale wird meine Daten unverzüglich löschen, sobald sie für die Abtretung, Abrechnung und Geltendmachung der Forderungen nicht mehr erforderlich sind. Anstelle der Löschung tritt die Einschränkung der Verarbeitung (Sperrung), sofern gesetzliche Aufbewahrungspflichten einzuhalten sind. Die gesetzlichen Aufbewahrungsfristen für meine Daten betragen in der Regel zehn Jahre. Ich habe ein Recht auf Auskunft gegenüber der Abrechnungszentrale, welche meine Daten verarbeitet sowie auf Berichtigung, auf Löschung bzw. auf Einschränkung der Verarbeitung. Ferner habe ich ein Recht auf Datenübertragbarkeit sowie ein Beschwerderecht bei der für die Abrechnungszentrale zuständigen Aufsichtsbehörde, der Landesbeauftragten für Datenschutz und Informationsfreiheit Nordrhein-Westfalen, Postfach 20 04 44, 40102 Düsseldorf.');
  drawPara('Die Datenschutzbeauftragte der Abrechnungszentrale ist die Kinast Rechtsanwaltsgesellschaft mbH, Hohenzollernring 54, 50672 Köln, zu erreichen über die Dr. Löffler & Co. KG, Telefon 0221 – 257 64 29.');
  drawPara('Ich kann diese Einwilligung jederzeit gegenüber der Abrechnungszentrale oder dem/der Leistungserbringer/-in widerrufen. Der Widerruf entfaltet lediglich Wirkung für die Zukunft, d.h. bis zum Widerruf bleibt die Verarbeitung rechtmäßig.');

  // ── Signature area ────────────────────────────────────────────
  y -= 8; // small gap after last body paragraph
  const signatureAreaHeight = 55;

  const signatureBase64 = String(data.unterschriftEinwilligung || '').split(',')[1] || '';
  if (signatureBase64) {
    try {
      const png = await pdfDoc.embedPng(Buffer.from(signatureBase64, 'base64'));
      const maxW = 220;
      const maxH = signatureAreaHeight - 4;
      const scale = Math.min(maxW / png.width, maxH / png.height, 1);
      const w = png.width * scale;
      const h = png.height * scale;
      page.drawImage(png, { x: marginX, y: y - h, width: w, height: h });
    } catch (_err) { /* skip */ }
  }
  y -= signatureAreaHeight;

  page.drawLine({
    start: { x: marginX, y },
    end: { x: marginX + contentWidth, y },
    thickness: 0.8,
    color: rgb(0.1, 0.1, 0.1),
  });
  y -= 14;
  text('Datum und Unterschrift des Patienten/Leistungsempfängers bzw. dessen Vertreter/in', marginX, y, { size: 9, color: rgb(0.2, 0.2, 0.2) });

  return {
    filename: `08-einwilligung-zur-abrechnung-${customerSlug}.pdf`,
    base64: Buffer.from(await pdfDoc.save()).toString('base64'),
  };
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

function wrapTextByWidth(text, font, size, maxWidth) {
  const source = String(text || '');
  if (!source) return [''];
  const paragraphs = source.split('\n');
  const out = [];
  for (const paragraph of paragraphs) {
    if (!paragraph) { out.push(''); continue; }
    const words = paragraph.split(/\s+/);
    let currentLine = '';
    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && currentLine) {
        out.push(currentLine);
        currentLine = word;
      } else {
        currentLine = candidate;
      }
    }
    if (currentLine) out.push(currentLine);
  }
  return out;
}

function createPageContext(pdfDoc, font) {
  const pageSize = [595.28, 841.89];
  const topY = 790;
  const bottomY = 70;
  const state = {
    pdfDoc,
    font,
    page: pdfDoc.addPage(pageSize),
    y: topY,
    topY,
    bottomY,
    pageSize,
  };
  state.drawFooter = () => {
    state.page.drawText(`Erstellt am ${formatDate(new Date())}`, {
      x: 50,
      y: 40,
      size: 10,
      font,
      color: rgb(0.45, 0.45, 0.45),
    });
  };
  state.drawFooter();
  state.ensureSpace = (needed) => {
    if (state.y - needed < state.bottomY) {
      state.page = pdfDoc.addPage(pageSize);
      state.y = topY;
      state.drawFooter();
    }
  };
  return state;
}

function drawWrappedLines(ctx, lines, {
  x = 50,
  size = 11,
  lineHeight = 15,
  paragraphSpacing = 6,
  maxWidth = 495,
  color = rgb(0.1, 0.1, 0.1),
  font = ctx.font,
} = {}) {
  for (const rawLine of lines) {
    const text = String(rawLine == null ? '' : rawLine);
    if (!text) {
      ctx.y -= paragraphSpacing;
      continue;
    }
    const wrapped = wrapTextByWidth(text, font, size, maxWidth);
    for (const segment of wrapped) {
      ctx.ensureSpace(lineHeight);
      ctx.page.drawText(segment, { x, y: ctx.y, size, font, color });
      ctx.y -= lineHeight;
    }
  }
}

async function embedSignatureIfPresent(pdfDoc, ctxOrPage, signatureDataUrl, maybeY) {
  const isCtx = ctxOrPage && typeof ctxOrPage === 'object' && 'ensureSpace' in ctxOrPage;
  if (!normalizeWhitespace(signatureDataUrl)) return isCtx ? ctxOrPage.y : maybeY;

  const base64Payload = String(signatureDataUrl).split(',')[1] || '';
  if (!base64Payload) return isCtx ? ctxOrPage.y : maybeY;

  try {
    const pngImage = await pdfDoc.embedPng(Buffer.from(base64Payload, 'base64'));
    const maxWidth = 180;
    const maxHeight = 70;
    const scale = Math.min(maxWidth / pngImage.width, maxHeight / pngImage.height, 1);
    const width = pngImage.width * scale;
    const height = pngImage.height * scale;

    if (isCtx) {
      const ctx = ctxOrPage;
      ctx.ensureSpace(14 + height + 16);
      ctx.page.drawText('Unterschrift:', { x: 50, y: ctx.y, size: 11, color: rgb(0.2, 0.2, 0.2) });
      ctx.y -= 14;
      ctx.page.drawImage(pngImage, { x: 50, y: ctx.y - height, width, height });
      ctx.y -= height + 16;
      return ctx.y;
    }

    let y = maybeY;
    const page = ctxOrPage;
    page.drawText('Unterschrift:', { x: 50, y, size: 11, color: rgb(0.2, 0.2, 0.2) });
    y -= 14;
    page.drawImage(pngImage, { x: 50, y: y - height, width, height });
    return y - height - 16;
  } catch (_error) {
    return isCtx ? ctxOrPage.y : maybeY;
  }
}

async function buildStepPdf({ title, subtitle = '', lines = [], signatureDataUrl = '', fileName }) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const ctx = createPageContext(pdfDoc, font);

  ctx.page.drawText(title, { x: 50, y: ctx.y, size: 18, font: bold, color: rgb(0.15, 0.15, 0.15) });
  ctx.y -= 28;

  if (subtitle) {
    ctx.page.drawText(subtitle, { x: 50, y: ctx.y, size: 11, font, color: rgb(0.35, 0.35, 0.35) });
    ctx.y -= 24;
  }

  drawWrappedLines(ctx, lines);

  ctx.y -= 12;
  await embedSignatureIfPresent(pdfDoc, ctx, signatureDataUrl);

  const pdfBytes = await pdfDoc.save();
  return {
    filename: fileName,
    base64: Buffer.from(pdfBytes).toString('base64'),
  };
}

async function buildStepDocumentAttachments(data = {}, { includeDebug = false, forceAll = false } = {}) {
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
      enabled: forceAll || (includeDebug && (normalizeWhitespace(data.unterschriftMaengel) || normalizeWhitespace(data.maengelAbgeschlossenAm))),
      title: '09-Maengelbeseitigung',
      fileName: `09-maengelbeseitigung-${customerSlug}.pdf`,
      lines: [`Abgeschlossen am: ${formatDate(data.maengelAbgeschlossenAm)}`].filter(Boolean),
      signatureDataUrl: data.unterschriftMaengel,
    },
    {
      enabled: forceAll || (includeDebug && (normalizeWhitespace(data.unterschriftNB) || normalizeWhitespace(data.nachbesserungAbgeschlossenAm))),
      title: '10-Nachbesserung',
      fileName: `10-nachbesserung-${customerSlug}.pdf`,
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
  const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
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

  // 08: Einwilligung zur Abrechnung (custom layout matching original)
  const wantsEinwilligung = forceAll || Boolean(normalizeWhitespace(data.unterschriftEinwilligung));
  if (wantsEinwilligung) {
    try {
      const einwilligungPdf = await buildEinwilligungPdf(data);
      attachments.push(einwilligungPdf);
    } catch (_err) {
      // Skip if Einwilligung generation fails
    }

    // 08 (template variant): stamp values onto the real Dr. Löffler PDF
    try {
      const templatePdf = await buildEinwilligungFromTemplate(data);
      attachments.push(templatePdf);
    } catch (_err) {
      // Skip if template is missing or cannot be loaded
    }
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
