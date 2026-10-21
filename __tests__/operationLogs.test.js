jest.mock('../models/OperationLog', () => ({
  create: jest.fn(async entry => entry),
  createIndexes: jest.fn(),
  collection: {
    indexes: jest.fn(),
    dropIndex: jest.fn(),
    updateMany: jest.fn(),
  },
}));

const OperationLog = require('../models/OperationLog');
const { addOperationLog, migrateLogRetention, retentionMs } = require('../services/operationLogs');

const DAY = 24 * 60 * 60 * 1000;

describe('log retention (C4)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps audit events 2 years and everyday events 30 days', () => {
    ['submit.received', 'submit.bitrix.failed_final', 'admin.logs.cleared', 'chat.notify.failed', 'draft.cleanup.deleted',
      'storage.volume.alarm', 'n8n.abnahme_check.ok', 'client.submit.success', 'client.outbox.sent']
      .forEach(event => expect(retentionMs(event)).toBe(2 * 365 * DAY));
    ['draft.save.updated', 'upload.compressed', 'client.validation.blocked', 'client.error', 'client.storage.persist', 'chat.notify.ok']
      .forEach(event => expect(retentionMs(event)).toBe(30 * DAY));
  });

  it('writes expireAt on every entry', async () => {
    const before = Date.now();
    const audit = await addOperationLog({ event: 'submit.received' });
    const everyday = await addOperationLog({ event: 'draft.save.updated' });
    expect(audit.expireAt.getTime()).toBeGreaterThanOrEqual(before + 2 * 365 * DAY);
    expect(everyday.expireAt.getTime()).toBeLessThan(before + 31 * DAY);
  });

  it('drops the old 30-day TTL index once and backfills expireAt', async () => {
    OperationLog.collection.indexes.mockResolvedValue([
      { name: '_id_', key: { _id: 1 } },
      { name: 'createdAt_1', key: { createdAt: 1 }, expireAfterSeconds: 2592000 },
    ]);
    OperationLog.collection.updateMany
      .mockResolvedValueOnce({ modifiedCount: 3 })
      .mockResolvedValueOnce({ modifiedCount: 5 });

    const result = await migrateLogRetention();

    expect(OperationLog.collection.dropIndex).toHaveBeenCalledWith('createdAt_1');
    expect(OperationLog.collection.updateMany.mock.calls[0][0]).toEqual({ expireAt: { $exists: false }, event: { $regex: expect.any(RegExp) } });
    expect(OperationLog.createIndexes).toHaveBeenCalled();
    expect(result).toEqual({ droppedIndex: 'createdAt_1', auditBackfilled: 3, everydayBackfilled: 5 });
    expect(OperationLog.create).toHaveBeenCalledWith(expect.objectContaining({ event: 'admin.logs.retention_migrated' }));
  });

  it('does nothing and logs nothing when already migrated', async () => {
    OperationLog.collection.indexes.mockResolvedValue([{ name: 'expireAt_1', key: { expireAt: 1 }, expireAfterSeconds: 0 }]);
    OperationLog.collection.updateMany.mockResolvedValue({ modifiedCount: 0 });

    await migrateLogRetention();

    expect(OperationLog.collection.dropIndex).not.toHaveBeenCalled();
    expect(OperationLog.create).not.toHaveBeenCalled();
  });
});
