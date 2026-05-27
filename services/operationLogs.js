const crypto = require('crypto');
const OperationLog = require('../models/OperationLog');

const DEFAULT_LOG_LIMIT = 500;

function getLogLimit() {
  const limit = Number(process.env.OPERATION_LOG_LIMIT || DEFAULT_LOG_LIMIT);
  return Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LOG_LIMIT;
}

function truncate(value, maxLength = 300) {
  const text = String(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...[truncated ${text.length - maxLength} chars]`;
}

function sanitizeContext(value, depth = 0) {
  if (value == null) return value;
  if (depth > 3) return '[max depth]';

  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) return `[signature data url length=${value.length}]`;
    if (value.length > 500) return truncate(value);
    return value;
  }

  if (typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.slice(0, 20).map(item => sanitizeContext(item, depth + 1));
  }

  if (typeof value.toObject === 'function') {
    return sanitizeContext(value.toObject(), depth + 1);
  }

  return Object.entries(value).reduce((acc, [key, entryValue]) => {
    if (/passwort|password|token/i.test(key) && key !== 'shareToken') {
      acc[key] = '[redacted]';
      return acc;
    }

    acc[key] = sanitizeContext(entryValue, depth + 1);
    return acc;
  }, {});
}

function pickIdentifiers(context = {}) {
  return {
    dealId: context.bitrixAuftragId || context.terminId || context.auftragsNummer || null,
    terminId: context.terminId || null,
    bitrixAuftragId: context.bitrixAuftragId || null,
    draftId: context.draftId || null,
    formId: context.formId || context.submittedId || null,
    shareToken: context.shareToken || null,
  };
}

async function addOperationLog({ level = 'info', event = 'operation', message = '', context = {} } = {}) {
  const entry = {
    id: `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    timestamp: new Date(),
    level,
    event,
    message,
    ...pickIdentifiers(context),
    context: sanitizeContext(context),
  };

  let persisted = null;
  try {
    persisted = await OperationLog.create(entry);
  } catch (error) {
    console.error('[operation-log] persist failed', error.message);
  }

  const printer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  printer('[operation-log]', entry.event, entry.message, {
    dealId: entry.dealId,
    draftId: entry.draftId,
    formId: entry.formId,
  });

  return persisted || entry;
}

async function listOperationLogs({ limit = 100 } = {}) {
  const numericLimit = Number(limit);
  const safeLimit = Number.isFinite(numericLimit) && numericLimit > 0 ? numericLimit : 100;
  return OperationLog
    .find({})
    .sort({ timestamp: -1, createdAt: -1 })
    .limit(Math.min(safeLimit, getLogLimit()))
    .lean();
}

module.exports = {
  addOperationLog,
  listOperationLogs,
};
