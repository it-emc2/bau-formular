const TZ = process.env.N8N_ABNAHME_TZ || 'Europe/Berlin';
const RETRY_DELAYS_MS = [2000, 10_000, 60_000];

function isoWithOffset(date, timeZone = TZ) {
  const local = new Intl.DateTimeFormat('sv-SE', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date).replace(' ', 'T');
  const gmt = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(date).find(part => part.type === 'timeZoneName').value;
  return local + (gmt === 'GMT' ? '+00:00' : gmt.replace('GMT', ''));
}

function buildAddressLine(data = {}) {
  const address = data.adresse || {};
  return [address.strasse, address.adresszeile2, [address.plz, address.stadt].filter(Boolean).join(' ')]
    .map(part => String(part || '').trim())
    .filter(Boolean)
    .join(', ');
}

function buildAbnahmeCheckPayload(doc = {}, { chatId, documents = [], customerName, submittedAt = new Date() } = {}) {
  return {
    deal_id: Number(doc.bitrixAuftragId) || null,
    customer_name: customerName || doc.name || '',
    address: buildAddressLine(doc),
    submitted_at: isoWithOffset(submittedAt instanceof Date ? submittedAt : new Date(submittedAt)),
    chat_id: chatId || '',
    documents: documents.map(entry => (typeof entry === 'string' ? entry : entry?.filename || entry?.name)).filter(Boolean),
    source: 'bau-formular',
  };
}

// ponytail: inline retry loop; move to a job queue if submissions ever outpace the 72s worst case.
async function postAbnahmeCheck(payload, { log = async () => {} } = {}) {
  const url = process.env.N8N_ABNAHME_URL;
  const token = process.env.N8N_ABNAHME_TOKEN;
  if (!url || !token) {
    await log({ level: 'warn', event: 'n8n.abnahme_check.skipped', message: 'N8N_ABNAHME_URL oder N8N_ABNAHME_TOKEN ist nicht konfiguriert.' });
    return null;
  }

  for (let attempt = 1; attempt <= RETRY_DELAYS_MS.length + 1; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Abnahme-Token': token },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await response.text();

      if (response.ok) {
        const result = (() => { try { return JSON.parse(body); } catch { return body; } })();
        await log({ event: 'n8n.abnahme_check.ok', message: 'n8n-Abnahme-Check ausgefuehrt.', context: { dealId: payload.deal_id, result } });
        return result;
      }
      if (response.status < 500) {
        await log({ level: 'error', event: 'n8n.abnahme_check.rejected', message: `n8n lehnte den Abnahme-Check ab (${response.status}): ${body}`, context: { dealId: payload.deal_id } });
        return null;
      }
      throw new Error(`n8n antwortete mit ${response.status}: ${body}`);
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt - 1];
      await log({
        level: delay ? 'warn' : 'error',
        event: 'n8n.abnahme_check.failed',
        message: `n8n-Abnahme-Check Versuch ${attempt} fehlgeschlagen: ${error.message}${delay ? ` Naechster Versuch in ${delay / 1000}s.` : ''}`,
        context: { dealId: payload.deal_id },
      });
      if (!delay) return null;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  return null;
}

module.exports = { buildAbnahmeCheckPayload, postAbnahmeCheck, isoWithOffset };
