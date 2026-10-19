const { buildAbnahmeCheckPayload, postAbnahmeCheck } = require('../services/n8nAbnahmeCheck');

const doc = {
  bitrixAuftragId: '65046',
  anrede: 'Frau',
  vorname: 'Veronika',
  nachname: 'Schiller',
  adresse: { strasse: 'Musterweg 5', plz: '90402', stadt: 'Nürnberg' },
};

test('baut das n8n-Payload aus einer Abnahme', () => {
  const payload = buildAbnahmeCheckPayload(doc, {
    chatId: 'chat42',
    customerName: 'Frau Veronika Schiller',
    submittedAt: new Date('2026-09-11T08:20:00Z'),
    documents: ['abnahmeprotokoll.pdf', { filename: 'bad_foto_1.jpg' }, { name: 'unterschrift_kunde.png' }, {}],
  });

  expect(payload).toEqual({
    deal_id: 65046,
    customer_name: 'Frau Veronika Schiller',
    address: 'Musterweg 5, 90402 Nürnberg',
    submitted_at: '2026-09-11T10:20:00+02:00',
    chat_id: 'chat42',
    documents: ['abnahmeprotokoll.pdf', 'bad_foto_1.jpg', 'unterschrift_kunde.png'],
    source: 'bau-formular',
  });
});

test('leere Uploads bleiben ein leeres Array', () => {
  expect(buildAbnahmeCheckPayload(doc, { chatId: 'chat42' }).documents).toEqual([]);
});

test('submitted_at traegt den echten Offset des Datums (Winterzeit)', () => {
  const winter = buildAbnahmeCheckPayload(doc, { chatId: 'chat42', submittedAt: new Date('2026-01-15T09:20:00Z') });
  expect(winter.submitted_at).toBe('2026-01-15T10:20:00+01:00');
});

test('ohne Deal-ID wird n8n nicht aufgerufen', async () => {
  process.env.N8N_ABNAHME_URL = 'https://n8n.test/hook';
  process.env.N8N_ABNAHME_TOKEN = 't';
  global.fetch = jest.fn();
  const log = jest.fn();
  expect(await postAbnahmeCheck({ deal_id: null }, { log })).toBeNull();
  expect(global.fetch).not.toHaveBeenCalled();
  expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: 'n8n.abnahme_check.skipped' }));
});
