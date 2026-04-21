const { buildStepDocumentAttachments, getChecklistVariant } = require('../services/stepDocuments');

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

  it('uses the selected checklist variant for the generated checklist attachment filename', async () => {
    const attachments = await buildStepDocumentAttachments({
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
    const attachments = await buildStepDocumentAttachments({
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
    const attachments = await buildStepDocumentAttachments({
      vorname: 'Max',
      nachname: 'Muster',
    });

    expect(attachments.some(a => a.filename.startsWith('08-einwilligung-zur-abrechnung'))).toBe(false);
  });
});
