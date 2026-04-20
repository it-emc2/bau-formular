function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildCustomerName(data = {}) {
  const salutation = normalizeWhitespace(data.anrede);
  const firstName = normalizeWhitespace(data.vorname);
  const lastName = normalizeWhitespace(data.nachname);

  if (salutation === 'Familie' && lastName) {
    return `Familie ${lastName}`;
  }

  return [firstName, lastName].filter(Boolean).join(' ') || normalizeWhitespace(data.name);
}

function buildAddressLines(data = {}) {
  const customerName = buildCustomerName(data);
  const address = data.adresse || {};
  const cityLine = [normalizeWhitespace(address.plz), normalizeWhitespace(address.stadt)]
    .filter(Boolean)
    .join(' ');

  return [
    customerName,
    normalizeWhitespace(address.strasse),
    normalizeWhitespace(address.adresszeile2),
    cityLine,
  ].filter(Boolean);
}

function getReferenceDate(data = {}) {
  const candidates = [
    data.unterschriftZeitpunkt,
    data.abgeschlossenAm,
    data.maengelAbgeschlossenAm,
    data.nachbesserungAbgeschlossenAm,
    data.unterschriftMonteurDatum,
  ];

  for (const value of candidates) {
    if (!value) continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return new Date();
}

function formatMonthYear(date) {
  const formatted = new Intl.DateTimeFormat('de-DE', {
    month: 'long',
    year: 'numeric',
  }).format(date);

  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function formatLongDate(date) {
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function buildConfirmationText(data = {}) {
  const appointmentType = normalizeWhitespace(data.artDesTermins);
  const orderNumber = normalizeWhitespace(data.auftragsNummer);
  const completionState = normalizeWhitespace(data.terminStatus);
  const isSuccessful = completionState !== 'Nicht erfolgreich beendet';

  let measure = 'barrierearmen Umbau';
  if (appointmentType === 'Nachbesserung') measure = 'Nachbesserung';
  if (appointmentType === 'Service') measure = 'Serviceeinsatz';

  const statusText = isSuccessful ? 'erfolgreich durchgeführten' : 'durchgeführten';
  const orderReference = orderNumber ? ` gemäß Auftrag ${orderNumber}` : '';

  return [
    `hiermit bestätige ich den durch die Fa. EmC2 ${statusText}`,
    `${measure}${orderReference} mit Hilfe der mir genehmigten`,
    'Förderung nach §40 SGB XI Abs. 4.',
  ].join(' ');
}

function buildLetterText(data = {}) {
  const addressLines = buildAddressLines(data);
  const customerName = buildCustomerName(data) || 'Kundin / Kunde';
  const date = getReferenceDate(data);
  const city = normalizeWhitespace(data.adresse?.stadt) || 'Leipzig';
  const confirmationText = buildConfirmationText(data);

  return [
    ...addressLines,
    '',
    `${city}, im ${formatMonthYear(date)}`,
    '',
    'Sehr geehrte Damen und Herren,',
    '',
    confirmationText,
    '',
    'Mit freundlichen Grüßen',
    '',
    customerName,
  ].join('\n');
}

function renderLetterHtml(data = {}) {
  const addressLines = buildAddressLines(data);
  const customerName = escapeHtml(buildCustomerName(data) || 'Kundin / Kunde');
  const date = getReferenceDate(data);
  const city = escapeHtml(normalizeWhitespace(data.adresse?.stadt) || 'Leipzig');
  const confirmationText = escapeHtml(buildConfirmationText(data));
  const signature = normalizeWhitespace(data.unterschriftKunde);
  const orderNumber = normalizeWhitespace(data.auftragsNummer);
  const titleSuffix = orderNumber ? ` ${escapeHtml(orderNumber)}` : '';

  const addressMarkup = addressLines.length
    ? addressLines.map(line => `<div>${escapeHtml(line)}</div>`).join('')
    : '<div>Kundin / Kunde</div>';

  const signatureMarkup = signature
    ? `<img class="signature-image" src="${signature}" alt="Unterschrift" />`
    : '';

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Bestaetigung erfolgreicher Umbau${titleSuffix}</title>
  <style>
    :root {
      color-scheme: light;
      --page-width: 210mm;
      --page-height: 297mm;
      --text: #1b1b1b;
      --muted: #5b5b5b;
      --line: #d9d9d9;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #ececec;
      color: var(--text);
      font-family: "Times New Roman", Times, serif;
    }
    .page {
      width: min(var(--page-width), 100%);
      min-height: var(--page-height);
      margin: 24px auto;
      background: #fff;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.12);
      padding: 32mm 24mm 28mm;
      position: relative;
    }
    .address-block {
      font-size: 14px;
      line-height: 1.35;
      min-height: 90px;
    }
    .date-line {
      margin-top: 38px;
      text-align: right;
      font-size: 15px;
    }
    .letter-body {
      margin-top: 32px;
      font-size: 15px;
      line-height: 1.6;
    }
    .letter-body p { margin: 0 0 16px; }
    .signature-space {
      margin-top: 32px;
      min-height: 92px;
    }
    .signature-image {
      display: block;
      max-width: 240px;
      max-height: 90px;
      object-fit: contain;
      margin-bottom: 10px;
    }
    .signature-name {
      margin-top: 8px;
      font-size: 15px;
    }
    .document-meta {
      position: absolute;
      left: 24mm;
      right: 24mm;
      bottom: 18mm;
      padding-top: 10px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-family: Arial, sans-serif;
      font-size: 11px;
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }
    @media print {
      body { background: #fff; }
      .page {
        width: auto;
        min-height: auto;
        margin: 0;
        box-shadow: none;
        padding: 25mm 20mm 22mm;
      }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="address-block">${addressMarkup}</section>
    <div class="date-line">${city}, im ${escapeHtml(formatMonthYear(date))}</div>
    <section class="letter-body">
      <p>Sehr geehrte Damen und Herren,</p>
      <p>${confirmationText}</p>
      <p>Mit freundlichen Grüßen</p>
      <div class="signature-space">
        ${signatureMarkup}
        <div class="signature-name">${customerName}</div>
      </div>
    </section>
    <footer class="document-meta">
      <span>Erstellt am ${escapeHtml(formatLongDate(date))}</span>
      <span>emc2 Bauformular</span>
    </footer>
  </main>
</body>
</html>`;
}

function buildSafeFilename(data = {}) {
  const customer = buildCustomerName(data).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const orderNumber = normalizeWhitespace(data.auftragsNummer).replace(/[^a-zA-Z0-9]+/g, '-');
  const suffix = orderNumber || customer || 'formular';
  return `bestaetigung-${suffix.toLowerCase()}.doc`;
}

function buildDocumentPackage(data = {}) {
  const customerName = buildCustomerName(data) || 'Kundin / Kunde';
  const subjectOrder = normalizeWhitespace(data.auftragsNummer);

  return {
    title: 'Bestaetigung erfolgreicher Umbau',
    subject: subjectOrder
      ? `Bestaetigung Umbau ${subjectOrder}`
      : `Bestaetigung Umbau ${customerName}`,
    fileName: buildSafeFilename(data),
    html: renderLetterHtml(data),
    text: buildLetterText(data),
  };
}

module.exports = {
  buildDocumentPackage,
};
