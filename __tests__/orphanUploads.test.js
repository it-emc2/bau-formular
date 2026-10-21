const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../models/Abnahme', () => ({ find: jest.fn() }));
jest.mock('../models/Entwurf', () => ({ find: jest.fn(), deleteMany: jest.fn() }));

const Abnahme = require('../models/Abnahme');
const Entwurf = require('../models/Entwurf');
const { deleteExpiredDrafts, cleanupOrphanUploads, getVolumeUsage } = require('../services/orphanUploads');

function cursorOf(docs) {
  return { lean: () => ({ cursor: () => docs[Symbol.iterator]() }) };
}

describe('deleteExpiredDrafts', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-'));
    ['old.jpg', 'shared.jpg', 'keep.jpg'].forEach(name => fs.writeFileSync(path.join(dir, name), 'x'));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('deletes expired drafts and only the files nothing else references', async () => {
    const createdSince = new Date('2026-10-02T00:00:00Z');
    Entwurf.find
      .mockReturnValueOnce({ lean: async () => [{ _id: 'd1', bitrixAuftragId: '1', bilderFertigerUmbau: ['/uploads/old.jpg', '/uploads/shared.jpg'] }] })
      .mockReturnValueOnce(cursorOf([{ _id: 'd2', fotos: ['/uploads/keep.jpg'] }]));
    Abnahme.find.mockReturnValue(cursorOf([{ _id: 'a1', bilder: ['/uploads/shared.jpg'] }]));

    const result = await deleteExpiredDrafts({ createdSince, olderThanDays: 30, uploadsDir: dir });

    expect(Entwurf.find.mock.calls[0][0]).toEqual({ createdAt: { $gte: createdSince }, updatedAt: { $lt: expect.any(Date) } });
    expect(Entwurf.deleteMany).toHaveBeenCalledWith({ _id: { $in: ['d1'] } });
    expect(result.deletedFiles).toEqual(['old.jpg']);
    expect(fs.existsSync(path.join(dir, 'old.jpg'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'shared.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'keep.jpg'))).toBe(true);
  });

  it('does nothing when no draft is expired', async () => {
    Entwurf.find.mockReturnValueOnce({ lean: async () => [] });

    const result = await deleteExpiredDrafts({ createdSince: new Date(), uploadsDir: dir });

    expect(result).toEqual({ deletedDrafts: [], deletedFiles: [] });
    expect(Entwurf.deleteMany).not.toHaveBeenCalled();
  });
});

describe('cleanupOrphanUploads minimum age', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-'));
    ['young.jpg', 'old.jpg', 'used.jpg'].forEach(name => fs.writeFileSync(path.join(dir, name), 'x'));
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    fs.utimesSync(path.join(dir, 'old.jpg'), twoDaysAgo, twoDaysAgo);
    fs.utimesSync(path.join(dir, 'used.jpg'), twoDaysAgo, twoDaysAgo);
    Abnahme.find.mockReturnValue(cursorOf([{ _id: 'a1', bilder: ['/uploads/used.jpg'] }]));
    Entwurf.find.mockReturnValue(cursorOf([]));
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('deletes only unreferenced files older than the minimum age', async () => {
    const result = await cleanupOrphanUploads({ deleteFiles: true, uploadsDir: dir, minAgeMs: 24 * 60 * 60 * 1000 });

    expect(result.orphanFiles.map(file => file.relativePath)).toEqual(['old.jpg']);
    expect(fs.existsSync(path.join(dir, 'old.jpg'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'young.jpg'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'used.jpg'))).toBe(true);
  });
});

describe('getVolumeUsage', () => {
  it('computes used percent from statfs', async () => {
    const statfs = async () => ({ blocks: 1000, bfree: 150, bsize: 4096 });
    const usage = await getVolumeUsage({ uploadsDir: '/x', statfs });
    expect(usage.usedPercent).toBe(85);
    expect(usage.usedBytes).toBe(850 * 4096);
  });
});
