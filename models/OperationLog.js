const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now, index: true },
  level: { type: String, enum: ['info', 'warn', 'error'], default: 'info', index: true },
  event: { type: String, default: 'operation', index: true },
  message: { type: String, default: '' },
  dealId: { type: String, default: null, index: true },
  terminId: { type: String, default: null, index: true },
  bitrixAuftragId: { type: String, default: null, index: true },
  draftId: { type: String, default: null, index: true },
  formId: { type: String, default: null, index: true },
  shareToken: { type: String, default: null },
  context: { type: mongoose.Schema.Types.Mixed, default: {} },
  // Set when written (services/operationLogs.js): audit entries 2 years, everyday 30 days.
  expireAt: { type: Date },
}, {
  timestamps: true,
  collection: 'OperationLogs',
});

// Replaces the old 30-day TTL on createdAt (dropped once by migrateLogRetention).
schema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.OperationLog || mongoose.model('OperationLog', schema);
