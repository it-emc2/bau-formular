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

  it('persists Einwilligung fields', () => {
    const zeit = new Date('2026-04-21T10:15:00Z');
    const doc = new Abnahme({
      terminId: 'UT-1000',
      einwilligungGeburtsdatum: '1955-04-12',
      unterschriftEinwilligung: 'data:image/png;base64,AAAA',
      unterschriftEinwilligungZeitpunkt: zeit,
    });

    expect(doc.validateSync()).toBeUndefined();
    expect(doc.einwilligungGeburtsdatum).toBe('1955-04-12');
    expect(doc.unterschriftEinwilligung).toBe('data:image/png;base64,AAAA');
    expect(doc.unterschriftEinwilligungZeitpunkt).toEqual(zeit);
  });
});
