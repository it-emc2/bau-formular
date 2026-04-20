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
});
