const { buildStepDocumentAttachments, getChecklistVariant, buildProduktverkaufSummaryText } = require('../services/stepDocuments');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { getUploadsDir } = require('../services/uploadsPath');

describe('stepDocuments', () => {
  it('defaults to the badumbau checklist when no execution activities are present', () => {
    expect(getChecklistVariant({})).toEqual({
      key: 'badumbau',
      title: '06-Checkliste-Badumbau',
      fileNamePrefix: '06-checkliste-badumbau',
    });
  });

  it('selects the handlaeufe checklist when execution activities contain handlaeufe', () => {
    expect(getChecklistVariant({
      bitrixExecutionActivities: '[HD] Handläufe, [HD] Haltegriffe',
    })).toEqual({
      key: 'handlaeufe',
      title: '06-Checkliste-Handlaeufe',
      fileNamePrefix: '06-checkliste-handlaeufe',
    });
  });

  it('selects the badewannentuer checklist when execution activities contain badewannentuer', () => {
    expect(getChecklistVariant({
      bitrixExecutionActivities: '[HD] Badewannentüre',
    })).toEqual({
      key: 'badewannentuer',
      title: '06-Checkliste-Badewannentuer',
      fileNamePrefix: '06-checkliste-badewannentuer',
    });
  });

  it('builds a Produktverkauf summary with the correct Summe when products are selected', () => {
    const text = buildProduktverkaufSummaryText({
      produktverkaufVorOrt: 'Ja',
      produktverkaufProdukt1: true,
      produktverkaufProdukt2: true,
      produktverkaufProdukt2Variante: 'Klebepad',
    });
    expect(text).toContain('Duschhocker mit Soft-Drehsitz und Ablage — 89,99 €');
    expect(text).toContain('Duschabzieher Silikon mit Halterung (mit Klebepad) — 24,99 €');
    expect(text).toContain('Summe ausgewählter Produkte: 114,98 €');
  });

  it('returns an empty Produktverkauf summary when no products are selected', () => {
    expect(buildProduktverkaufSummaryText({ produktverkaufVorOrt: 'Nein' })).toBe('');
  });

  it('attaches the Produktverkauf PDF to the Bitrix submission when a sale occurred', async () => {
    const { attachments } = await buildStepDocumentAttachments({
      vorname: 'Max',
      nachname: 'Muster',
      produktverkaufVorOrt: 'Ja',
      produktverkaufProdukt1: true,
    });
    expect(attachments.some(a => a.filename.includes('produktverkauf-vor-ort'))).toBe(true);
  });

  it('uses the selected checklist variant for the generated checklist attachment filename', async () => {
    const { attachments } = await buildStepDocumentAttachments({
      vorname: 'Max',
      nachname: 'Muster',
      bitrixExecutionActivities: '[HD] Handläufe',
    });

    expect(
      attachments.some(attachment => attachment.filename.includes('06-checkliste-handlaeufe-max-muster.pdf'))
    ).toBe(true);
  });

  it('supports the current form field name for execution activities', () => {
    expect(getChecklistVariant({
      auszufuehrendeTaetigkeiten: '[HD] Badewannentüre',
    })).toEqual({
      key: 'badewannentuer',
      title: '06-Checkliste-Badewannentuer',
      fileNamePrefix: '06-checkliste-badewannentuer',
    });
  });

  it('includes the 08-einwilligung-zur-abrechnung PDF when the customer has signed it', async () => {
    const { attachments } = await buildStepDocumentAttachments({
      vorname: 'Max',
      nachname: 'Muster',
      einwilligungGeburtsdatum: '1955-04-12',
      unterschriftEinwilligung: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAWk1v3QAAAABJRU5ErkJggg==',
    });

    const einwilligung = attachments.find(a => a.filename.startsWith('08-einwilligung-zur-abrechnung'));
    expect(einwilligung).toBeDefined();
    expect(einwilligung.filename).toBe('08-einwilligung-zur-abrechnung-max-muster.pdf');
    expect(Buffer.from(einwilligung.base64, 'base64').slice(0, 4).toString('binary')).toBe('%PDF');
  });

  it('omits the 08-einwilligung-zur-abrechnung PDF when the customer has not signed', async () => {
    const { attachments } = await buildStepDocumentAttachments({
      vorname: 'Max',
      nachname: 'Muster',
    });

    expect(attachments.some(a => a.filename.startsWith('08-einwilligung-zur-abrechnung'))).toBe(false);
  });

  it('compresses uploaded images before adding them as Bitrix attachments', async () => {
    const uploadsDir = getUploadsDir();
    const filename = 'large-test-photo.jpg';
    const fullPath = path.join(uploadsDir, filename);
    fs.mkdirSync(uploadsDir, { recursive: true });

    const original = await sharp({
      create: {
        width: 2600,
        height: 1800,
        channels: 3,
        background: { r: 120, g: 80, b: 40 },
      },
    })
      .jpeg({ quality: 100 })
      .toBuffer();

    fs.writeFileSync(fullPath, original);

    try {
      const { attachments, optimizedFiles } = await buildStepDocumentAttachments({
        vorname: 'Max',
        nachname: 'Muster',
        bilderFertigerUmbau: `/uploads/${filename}`,
      });

      const uploadedImage = attachments.find(att => att.filename === '01-bilderFertigerUmbau.jpg');
      expect(uploadedImage).toBeDefined();
      expect(Buffer.from(uploadedImage.base64, 'base64').length).toBeLessThan(original.length);
      expect(optimizedFiles).toEqual([
        expect.objectContaining({
          filename,
          outputFilename: '01-bilderFertigerUmbau.jpg',
          kind: 'image',
        }),
      ]);
    } finally {
      fs.rmSync(fullPath, { force: true });
    }
  });
});
