const mongoose = require('mongoose');

const Abnahme = require('../models/Abnahme');

describe('Abnahme model', () => {
  afterAll(() => {
    delete mongoose.connection.models.Abnahme;
    delete mongoose.models.Abnahme;
  });

  it('requires terminId', async () => {
    const doc = new Abnahme({});
    const error = doc.validateSync();

    expect(error.errors.terminId).toBeDefined();
  });

  it('applies expected defaults', () => {
    const doc = new Abnahme({ terminId: 'UT-1000' });

    expect(doc.status).toBe('draft');
    expect(doc.formularTyp).toBe('baustellenabnahme');
    expect(doc.artDesTermins).toBe('Umbau');
    expect(doc.grossesVideoNachgang).toBe(false);
    expect(doc.adresse.strasse).toBe('');
    expect(doc.bitrixAuftragId).toBe('');
    expect(doc.auszufuehrendeTaetigkeiten).toBe('');
    expect(doc.emailEmpfaenger).toBe('');
  });

  it('rejects invalid enum values', async () => {
    const doc = new Abnahme({
      terminId: 'UT-1000',
      artDesTermins: 'Unbekannt',
    });
    const error = doc.validateSync();

    expect(error.errors.artDesTermins).toBeDefined();
  });
});
