const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const archiver = require('archiver');
const { BSON } = require('bson');
const mongoose = require('mongoose');

const Abnahme = require('../models/Abnahme');
const Entwurf = require('../models/Entwurf');
const OperationLog = require('../models/OperationLog');
const { buildDocumentPackage } = require('../services/documentLetter');
const { postTimelineComment, updateDealFields, postChatMessage, chatDialogId } = require('../services/bitrix');
const { buildAbnahmeCheckPayload, postAbnahmeCheck } = require('../services/n8nAbnahmeCheck');
const { buildStepDocumentAttachments, buildBitrixUploadAttachment, buildSelectedPdfAttachments, buildProduktverkaufSummaryText, buildCustomerName, ADMIN_PDF_SPECS, compressUploadedFiles, compressStoredVideo, compressedVideoName, COMPRESSED_VIDEO_SUFFIX, VIDEO_EXTENSIONS } = require('../services/stepDocuments');
const { getUploadsDir } = require('../services/uploadsPath');
const { cleanupOrphanUploads, getDraftFileReferences, deleteExpiredDrafts, getVolumeUsage } = require('../services/orphanUploads');
const { addOperationLog, listOperationLogs, migrateLogRetention, AUDIT_EVENT_PATTERN } = require('../services/operationLogs');

const router = express.Router();
const uploadsDir = getUploadsDir();
const SINGLE_UPLOAD_FIELDS = new Set(['videoDesAblaufs']);
const MAX_MONGO_DOCUMENT_BYTES = 15 * 1024 * 1024;
const BITRIX_TIMELINE_MAX_BATCH_BASE64_BYTES = 8 * 1024 * 1024;

fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdir(uploadsDir, { recursive: true }, err => cb(err, uploadsDir));
  },
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '-');
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeName}`);
  },
});

const upload = multer({ storage });

function uploadAny(req, res, next) {
  if (!req.headers || !String(req.headers['content-type'] || '').toLowerCase().includes('multipart/form-data')) {
    req.files = req.files || [];
    return next();
  }

  upload.any()(req, res, async error => {
    if (!error) {
      if (req.files && req.files.length > 0) {
        const compressed = await compressUploadedFiles(req.files, uploadsDir).catch(() => []);
        // Videos take ~30 s: answer the phone first, compress afterwards (C7b).
        const videos = req.files.filter(file => SINGLE_UPLOAD_FIELDS.has(file.fieldname)
          && VIDEO_EXTENSIONS.has(path.extname(file.filename).toLowerCase()));
        if (videos.length) {
          res.on('finish', () => {
            if (res.statusCode < 400) compressVideosAfterResponse(videos).catch(() => {});
          });
        }
        if (compressed.length > 0) {
          addOperationLog({
            event: 'upload.compressed',
            message: `${compressed.length} Datei(en) bei Upload komprimiert (${compressed.map(c => `${c.kind} ${c.originalSizeKB} KB -> ${c.compressedSizeKB} KB`).join(', ')}).`,
            context: { files: compressed },
          }).catch(() => {});
        }
      }
      return next();
    }

    const status = error instanceof multer.MulterError ? 400 : 400;
    const message = error.message || 'Upload konnte nicht verarbeitet werden.';

    await addOperationLog({
      level: 'error',
      event: 'upload.rejected',
      message,
      context: {
        uploadErrorCode: error.code,
      },
    });

    return res.status(status).json({
      success: false,
      error: message,
      details: [{
        field: 'uploads',
        kind: error.code || 'upload_error',
        message,
      }],
    });
  });
}

async function compressVideosAfterResponse(files) {
  for (const file of files) {
    const result = await compressStoredVideo(file.filename, uploadsDir);
    if (!result) continue;
    const oldUrl = `/uploads/${file.filename}`;
    const newUrl = `/uploads/${result.filename}`;
    const filter = { [file.fieldname]: oldUrl };
    const update = { $set: { [file.fieldname]: newUrl } };
    // timestamps: false — a newer updatedAt would make the phone drop local edits (A1).
    const [drafts, abnahmen] = await Promise.all([
      Entwurf.updateMany(filter, update, { timestamps: false }),
      Abnahme.updateMany(filter, update, { timestamps: false }),
    ]);
    await addOperationLog({
      event: 'upload.compressed',
      message: `Video nach der Antwort komprimiert (${result.originalSizeKB} KB -> ${result.compressedSizeKB} KB), ${drafts.modifiedCount + abnahmen.modifiedCount} Formular(e) umgestellt.`,
      context: { files: [{ ...result, fieldName: file.fieldname, original: file.filename }] },
    });
  }
}

// A phone may still send the original video URL (it got it before the compression
// finished). Use the compressed sibling whenever it exists; works after restarts too.
function preferCompressedVideos(payload) {
  SINGLE_UPLOAD_FIELDS.forEach(field => {
    const url = payload[field];
    if (typeof url !== 'string' || !url.startsWith('/uploads/') || url.endsWith(COMPRESSED_VIDEO_SUFFIX)) return;
    const candidate = compressedVideoName(path.basename(url));
    if (fs.existsSync(path.join(uploadsDir, candidate))) payload[field] = `/uploads/${candidate}`;
  });
  return payload;
}

function createShareToken() {
  return crypto.randomBytes(16).toString('hex');
}

function parsePayload(req) {
  const payload = typeof req.body?.formData === 'string'
    ? JSON.parse(req.body.formData)
    : { ...(req.body?.formData && typeof req.body.formData === 'object' ? req.body.formData : req.body) };

  // Die Pflicht-"Auftrags-ID" (terminId) ist die Deal-ID; bitrixAuftragId fuellt nur "Lead laden".
  const terminId = String(payload.terminId || '').trim();
  if (!String(payload.bitrixAuftragId || '').trim() && /^\d+$/.test(terminId)) {
    payload.bitrixAuftragId = terminId;
  }
  return payload;
}

function createMailtoUrl({ to, subject, text }) {
  const params = new URLSearchParams({
    subject,
    body: text,
  });

  return `mailto:${encodeURIComponent(to)}?${params.toString()}`;
}

function isSmtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

async function sendDocumentEmail({ to, subject, document }) {
  if (!isSmtpConfigured()) {
    return {
      delivery: 'mailto',
      mailtoUrl: createMailtoUrl({
        to,
        subject,
        text: document.text,
      }),
    };
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: process.env.SMTP_USER
      ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS || '',
        }
      : undefined,
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    text: document.text,
    html: document.html,
    attachments: [
      {
        filename: document.fileName,
        content: document.html,
        contentType: 'application/msword',
      },
    ],
  });

  return { delivery: 'smtp' };
}

function pickPayload(body = {}) {
  const payload = { ...body };

  delete payload._id;
  delete payload.id;
  delete payload.shareToken;
  delete payload.status;
  delete payload.createdAt;
  delete payload.updatedAt;

  return payload;
}

function sanitizeDocumentForCreate(document = {}) {
  const payload = { ...document };

  delete payload._id;
  delete payload.id;
  delete payload.__v;
  delete payload.createdAt;
  delete payload.updatedAt;

  return payload;
}

function isDevModePasswordValid(password = '') {
  const expected = process.env.TESTMODUS_PASSWORD || process.env.DEV_MODE_PASSWORD || '';
  const received = String(password || '');

  if (!expected) return false;

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  if (expectedBuffer.length !== receivedBuffer.length) return false;

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function mergeUploadedFiles(payload, files = []) {
  const groupedFiles = files.reduce((acc, file) => {
    if (!acc[file.fieldname]) acc[file.fieldname] = [];
    acc[file.fieldname].push(`/uploads/${file.filename}`);
    return acc;
  }, {});

  Object.entries(groupedFiles).forEach(([fieldName, urls]) => {
    if (SINGLE_UPLOAD_FIELDS.has(fieldName)) {
      payload[fieldName] = urls[urls.length - 1] || '';
      return;
    }

    const existingUrls = Array.isArray(payload[fieldName])
      ? payload[fieldName]
      : (payload[fieldName] ? [payload[fieldName]] : []);

    payload[fieldName] = [...existingUrls, ...urls];
  });

  return payload;
}

function buildRequestLogContext(parsed = {}, files = [], extra = {}) {
  const uploadBytes = (files || []).reduce((sum, file) => sum + (file.size || 0), 0);
  return {
    terminId: parsed.terminId,
    bitrixAuftragId: parsed.bitrixAuftragId,
    auftragsNummer: parsed.auftragsNummer,
    formId: parsed._id || parsed.id,
    uploadCount: files?.length || 0,
    uploadBytes,
    uploads: (files || []).map(file => ({
      fieldname: file.fieldname,
      filename: file.filename,
      size: file.size,
    })),
    ...extra,
  };
}

function assertDocumentSizeFitsMongo(document, label = 'Formular') {
  const size = BSON.calculateObjectSize(document);

  if (size <= MAX_MONGO_DOCUMENT_BYTES) return;

  const sizeMb = (size / 1024 / 1024).toFixed(1);
  const limitMb = (MAX_MONGO_DOCUMENT_BYTES / 1024 / 1024).toFixed(0);
  const error = new Error(`${label} ist zu gross zum Speichern (${sizeMb} MB, Limit ${limitMb} MB). Bitte Signaturen oder eingebettete Bilddaten reduzieren.`);
  error.status = 413;
  error.details = [{ field: 'formData', message: error.message }];
  throw error;
}

function toPlainDocument(document) {
  return document?.toObject ? document.toObject() : document;
}

async function deleteUploadedRequestFiles(files = []) {
  await Promise.all((files || []).map(file => (
    file?.path
      ? fs.promises.rm(file.path, { force: true }).catch(() => {})
      : Promise.resolve()
  )));
}

async function runMongoTransaction(work) {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await work(session);
    await session.commitTransaction();
    return result;
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    throw error;
  } finally {
    await session.endSession();
  }
}

async function deleteDraftDocument(draft, session = null) {
  if (draft?.deleteOne) {
    await draft.deleteOne(session ? { session } : undefined);
  }
}

async function deleteSubmittedDocument(form, session = null) {
  if (form?.deleteOne) {
    await form.deleteOne(session ? { session } : undefined);
  } else if (form?._id) {
    const query = Abnahme.findByIdAndDelete?.(form._id);
    if (query?.session && session) {
      await query.session(session);
    } else if (query) {
      await query;
    }
  }
}

async function createDocument(Model, payload, session = null) {
  if (!session) return Model.create(payload);

  const result = await Model.create([payload], { session });
  return Array.isArray(result) ? result[0] : result;
}

async function findByIdWithSession(Model, id, session = null) {
  const query = Model.findById(id);
  if (!query) return null;
  return query.session && session ? query.session(session) : query;
}

async function persistSubmitRecoveryDraft({ formId, payload, session = null }) {
  if (formId) {
    const existingDraft = await findByIdWithSession(Entwurf, formId, session);

    if (existingDraft) {
      Object.assign(existingDraft, payload, { status: 'draft' });
      assertDocumentSizeFitsMongo(toPlainDocument(existingDraft), 'Entwurf');
      await existingDraft.save(session ? { session } : undefined);
      return { draft: existingDraft, source: 'draft' };
    }

    const submitted = await findByIdWithSession(Abnahme, formId, session);

    if (submitted) {
      const draftPayload = {
        ...sanitizeDocumentForCreate(toPlainDocument(submitted)),
        ...payload,
        shareToken: createShareToken(),
        status: 'draft',
      };
      assertDocumentSizeFitsMongo(draftPayload, 'Entwurf');
      const draft = await createDocument(Entwurf, draftPayload, session);
      return { draft, submitted, source: 'submitted' };
    }
  }

  const draftPayload = {
    ...payload,
    shareToken: createShareToken(),
    status: 'draft',
  };
  assertDocumentSizeFitsMongo(draftPayload, 'Entwurf');
  const draft = await createDocument(Entwurf, draftPayload, session);
  return { draft, source: 'new' };
}

async function findAbnahmeBySubmitId(submitId) {
  if (typeof submitId !== 'string' || !submitId) return null;
  return Abnahme.findOne({ submitId });
}

function bitrixPendingFields() {
  return { bitrixStatus: 'pending', bitrixError: '', bitrixAttempts: 0, bitrixLastAttemptAt: new Date() };
}

function buildSuccessResponse(form) {
  return {
    success: true,
    id: form._id,
    shareToken: form.shareToken,
    shareLink: `/form/${form.shareToken}`,
    data: form,
  };
}

function buildDealLink(bitrixAuftragId) {
  if (!bitrixAuftragId) return null;
  try {
    return `${new URL(process.env.BITRIX_WEBHOOK_BASE).origin}/crm/deal/details/${bitrixAuftragId}/`;
  } catch {
    return null;
  }
}

function buildFormLink(shareToken) {
  if (!shareToken) return null;
  return `${(process.env.APP_BASE_URL || 'https://bau-formular.fly.dev').replace(/\/$/, '')}/form/${shareToken}`;
}

const BAUSTELLENABNAHME_CHAT_STATUS = {
  submitted: { emoji: '🟢', label: 'Abnahme abgeschlossen' },
  failed: { emoji: '🔴', label: 'Fehler beim Absenden' },
  bitrix_failed: { emoji: '🔴', label: 'Bitrix-Übertragung endgültig fehlgeschlagen' },
};

const FORM_TYPE_LABELS = {
  baustellenabnahme: 'BAUSTELLENABNAHME',
  zusaetzliche_leistungen: 'ZUSÄTZLICHE LEISTUNGEN',
  nachbesserung: 'NACHBESSERUNG',
  schadensmeldung: 'SCHADENSMELDUNG',
};

async function notifyBaustellenabnahmeChat(kind, doc = {}) {
  // Endgueltig fehlgeschlagene Bitrix-Pushes melden wir fuer jeden Formulartyp,
  // sonst bliebe der Fehler unsichtbar (der Monteur hat schon Gruen gesehen).
  const formularTyp = doc.formularTyp || 'baustellenabnahme';
  if (kind !== 'bitrix_failed' && formularTyp !== 'baustellenabnahme') return null;

  const { emoji, label } = BAUSTELLENABNAHME_CHAT_STATUS[kind];
  const dealId = doc.bitrixAuftragId;
  const customer = buildCustomerName(doc) || doc.name || 'Kunde';
  const dealLink = buildDealLink(dealId);
  const formLink = buildFormLink(doc.shareToken);
  const sep = '━'.repeat(45);

  const lines = [
    `📋 ${FORM_TYPE_LABELS[formularTyp] || 'FORMULAR'}`,
    sep,
    `☐ ${emoji} ${dealId ? `[${dealId}] ` : ''}${customer} — ${label}`,
  ];
  if (dealLink) lines.push(`     🔗 Auftrag: ${dealLink}`);
  if (formLink) lines.push(`     📝 Formular: ${formLink}`);
  if (kind !== 'submitted' && doc.errorMessage) lines.push(`     Fehler: ${doc.errorMessage}`);
  if (kind === 'bitrix_failed') lines.push('     👉 Testmodus → Bitrix Neu-Push → Auftrag-ID laden → „Komplett neu senden“.');
  lines.push(sep, '🤖 Automatisch generiert | Quelle: bau-formular');

  try {
    await postChatMessage(lines.join('\n'));
    return chatDialogId();
  } catch (error) {
    await addOperationLog({
      level: 'error',
      event: 'chat.notify.failed',
      message: error.message,
      context: { kind },
    });
    return null;
  }
}

function formatErrorDetails(error) {
  if (!error) return [];

  if (error.name === 'ValidationError' && error.errors) {
    return Object.values(error.errors).map(err => ({
      field: err.path,
      kind: err.kind,
      message: err.message,
      value: err.value,
    }));
  }

  if (Array.isArray(error.details)) {
    return error.details;
  }

  if (error.name === 'CastError') {
    return [{
      field: error.path,
      kind: error.kind,
      message: `Ungueltiger Wert fuer ${error.path || 'Feld'}: ${error.value}`,
      value: error.value,
    }];
  }

  if (error.code === 11000) {
    return Object.entries(error.keyValue || {}).map(([field, value]) => ({
      field,
      kind: 'duplicate',
      message: `Der Wert "${value}" wird bereits verwendet.`,
      value,
    }));
  }

  if (error instanceof SyntaxError) {
    return [{
      field: 'formData',
      kind: 'invalid_json',
      message: 'Die gesendeten Formulardaten sind kein gueltiges JSON.',
    }];
  }

  return [];
}

function sendRouteError(res, error, fallbackMessage = 'Formular konnte nicht verarbeitet werden') {
  const details = formatErrorDetails(error);
  const message = error?.message || fallbackMessage;
  const status = error?.status || error?.statusCode || 400;

  return res.status(status).json({
    success: false,
    error: message,
    ...(details.length ? { details } : {}),
  });
}

const DEAL_FIELD_DOC_MAP = {
  '02-warenpruefung':                   'UF_CRM_1764230457968',
  '05-abschluss-und-unterschrift':      'UF_CRM_1764760728724',
  '06-checkliste':                      'UF_CRM_1764319514136',
  '07-bestaetigung-erfolgreicher-umbau': 'UF_CRM_1741678496329',
};

function findAttachmentForDealField(attachments, prefix) {
  return attachments.find(att => att.filename.startsWith(prefix));
}

function buildAttachmentSummary(attachments = []) {
  return attachments.map(att => ({
    filename: att.filename,
    base64Length: att.base64?.length || 0,
  }));
}

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return '-';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function buildTimelineRequestEntry({ entityId, comment, attachments = [] }) {
  const fields = {
    ENTITY_ID: entityId,
    ENTITY_TYPE: 'deal',
    COMMENT: comment,
  };

  if (attachments.length) {
    fields.FILES = attachments.map(att => [
      att.filename,
      `[base64 length=${att.base64?.length || 0}]`,
    ]);
  }

  return {
    label: 'Timeline-Kommentar mit Anhaengen',
    method: 'POST',
    url: '<BITRIX_WEBHOOK_BASE>/crm.timeline.comment.add.json',
    contentType: 'application/json',
    body: { fields },
  };
}

function getAttachmentBase64Length(attachment = {}) {
  return attachment.base64?.length || 0;
}

function createTimelineAttachmentBatches(attachments = [], maxBase64Bytes = BITRIX_TIMELINE_MAX_BATCH_BASE64_BYTES) {
  if (!attachments.length) return [[]];

  const batches = [];
  let currentBatch = [];
  let currentBytes = 0;

  for (const attachment of attachments) {
    const attachmentBytes = getAttachmentBase64Length(attachment);
    const wouldExceedBatch = currentBatch.length > 0 && currentBytes + attachmentBytes > maxBase64Bytes;

    if (wouldExceedBatch) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBytes = 0;
    }

    currentBatch.push(attachment);
    currentBytes += attachmentBytes;
  }

  if (currentBatch.length) batches.push(currentBatch);
  return batches;
}

function splitTimelineAttachmentsBySize(attachments = [], maxBase64Bytes = BITRIX_TIMELINE_MAX_BATCH_BASE64_BYTES) {
  const sendableAttachments = [];
  const oversizedAttachments = [];

  for (const attachment of attachments) {
    const base64Length = getAttachmentBase64Length(attachment);
    if (base64Length > maxBase64Bytes) {
      oversizedAttachments.push({
        filename: attachment.filename,
        sizeKB: Math.round(base64Length / 1024),
        reason: `Einzeldatei ueberschreitet Bitrix-Timeline-Limit (${Math.round(maxBase64Bytes / 1024)} KB base64)`,
      });
    } else {
      sendableAttachments.push(attachment);
    }
  }

  return { sendableAttachments, oversizedAttachments };
}

function buildTimelineBatchComment({ baseComment, batchIndex, batchCount }) {
  if (batchIndex === 0) return baseComment;
  return `Weitere Anhaenge zur Baudokumentation (${batchIndex + 1}/${batchCount}).`;
}

function buildTimelineBatchLabel(batchIndex, batchCount) {
  if (batchCount <= 1) return 'Timeline-Kommentar mit Anhaengen';
  return `Timeline-Kommentar mit Anhaengen (${batchIndex + 1}/${batchCount})`;
}

function buildDealFieldRequestEntry({ entityId, fields }) {
  const redactedFields = {};
  Object.entries(fields).forEach(([fieldName, value]) => {
    const [filename, base64] = Array.isArray(value) ? value : ['', ''];
    redactedFields[fieldName] = [filename, `[base64 length=${base64?.length || 0}]`];
  });

  return {
    label: 'Auftragsfelder (Datei-Uploads)',
    method: 'POST',
    url: '<BITRIX_WEBHOOK_BASE>/crm.item.update.json',
    contentType: 'application/json',
    body: {
      entityTypeId: 2,
      id: entityId,
      fields: redactedFields,
      useOriginalUfNames: 'Y',
    },
  };
}

function buildHinweisComment(data = {}) {
  const hinweis = String(data.hinweiseBuero || '').trim();
  const uebermittlungsweg = String(data.checklistFotoUebermittlung || '').trim();
  const uebermittlungswegGrund = String(data.checklistFotoUebermittlungGrund || '').trim();
  const sonstigeBemerkungen = String(data.sonstigeBemerkungenBaustelle || '').trim();

  const blocks = [];
  if (hinweis) blocks.push(hinweis);
  if (uebermittlungsweg && uebermittlungsweg !== 'Über Link' && uebermittlungswegGrund) {
    blocks.push(`Übermittlungsweg nicht über Link (${uebermittlungsweg}) — Grund: ${uebermittlungswegGrund}`);
  }
  if (sonstigeBemerkungen) blocks.push(`Sonstige Bemerkungen: ${sonstigeBemerkungen}`);

  if (!blocks.length) return '';

  return ['⚠️ Hinweis für das Büro', '', ...blocks].join('\n');
}

async function syncDocumentToBitrix(data = {}, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : async () => {};
  const startedAt = Date.now();
  const entityId = Number(data.bitrixAuftragId || 0);

  if (!Number.isFinite(entityId) || entityId <= 0) {
    return {
      attempted: false,
      sent: false,
      reason: 'Keine gueltige Bitrix-Auftrag-ID',
      receivedBitrixAuftragId: data.bitrixAuftragId ?? null,
    };
  }

  let stepStartedAt = Date.now();
  const document = buildDocumentPackage(data);
  await onProgress({
    event: 'submit.bitrix.document_package.built',
    message: `Bitrix-Textdokument vorbereitet (${formatDuration(Date.now() - stepStartedAt)}).`,
    context: { durationMs: Date.now() - stepStartedAt },
  });

  let comment = [document.title, '', document.text].join('\n');
  const produktverkaufSummary = buildProduktverkaufSummaryText(data);
  if (produktverkaufSummary) {
    comment += '\n\n' + produktverkaufSummary;
  }
  stepStartedAt = Date.now();
  const { attachments, skippedFiles, optimizedFiles = [] } = await buildStepDocumentAttachments(data, {
    includeDebug: String(data.debugMode || '').toLowerCase() === 'true',
  });

  if (skippedFiles.length > 0) {
    comment += '\n\nHinweis — folgende Dateien konnten nicht uebertragen werden:\n'
      + skippedFiles.map(f => `- ${f.filename}: ${f.reason}`).join('\n');
    await onProgress({
      level: 'warn',
      event: 'submit.bitrix.attachments.skipped',
      message: `${skippedFiles.length} Datei(en) uebersprungen: ${skippedFiles.map(f => `${f.filename} (${f.reason})`).join(', ')}`,
      context: { skippedFiles },
    });
  }

  const totalBase64Bytes = attachments.reduce((sum, att) => sum + (att.base64?.length || 0), 0);
  const totalPayloadKB = Math.round(totalBase64Bytes / 1024);

  if (optimizedFiles.length > 0) {
    await onProgress({
      event: 'submit.bitrix.attachments.optimized',
      message: `${optimizedFiles.length} Datei(en) fuer Bitrix komprimiert: ${optimizedFiles.map(f => `${f.filename} (${f.originalSizeKB} KB -> ${f.optimizedSizeKB} KB)`).join(', ')}`,
      context: { optimizedFiles },
    });
  }

  await onProgress({
    event: 'submit.bitrix.attachments.built',
    message: `${attachments.length} Anhaenge vorbereitet (${formatDuration(Date.now() - stepStartedAt)}, gesamt ~${totalPayloadKB} KB base64)${skippedFiles.length > 0 ? `, ${skippedFiles.length} uebersprungen` : ''}${optimizedFiles.length > 0 ? `, ${optimizedFiles.length} komprimiert` : ''}.`,
    context: {
      durationMs: Date.now() - stepStartedAt,
      attachmentCount: attachments.length,
      totalPayloadKB,
      skippedCount: skippedFiles.length,
      optimizedCount: optimizedFiles.length,
      attachmentSummary: buildAttachmentSummary(attachments),
    },
  });

  const requests = [];
  const singleTimelineEntry = {
    ...buildTimelineRequestEntry({ entityId, comment, attachments }),
    label: 'Timeline-Kommentar mit Anhaengen',
    mode: 'single',
    attachmentCount: attachments.length,
    payloadKB: totalPayloadKB,
  };

  function buildFallbackTimelineEntries(fallbackComment, fallbackAttachments) {
    const timelineBatches = createTimelineAttachmentBatches(fallbackAttachments);
    const timelineBatchCount = timelineBatches.length;
    const entries = timelineBatches.map((batchAttachments, batchIndex) => {
      const batchComment = buildTimelineBatchComment({
        baseComment: fallbackComment,
        batchIndex,
        batchCount: timelineBatchCount,
      });
      return {
        ...buildTimelineRequestEntry({ entityId, comment: batchComment, attachments: batchAttachments }),
        label: buildTimelineBatchLabel(batchIndex, timelineBatchCount),
        mode: 'fallback_batch',
        batchIndex,
        batchCount: timelineBatchCount,
        attachmentCount: batchAttachments.length,
        payloadKB: Math.round(batchAttachments.reduce((sum, att) => sum + getAttachmentBase64Length(att), 0) / 1024),
      };
    });
    return { timelineBatches, timelineBatchCount, entries };
  }

  const dealFieldsFull = {};
  for (const [prefix, fieldName] of Object.entries(DEAL_FIELD_DOC_MAP)) {
    const att = findAttachmentForDealField(attachments, prefix);
    if (att) {
      dealFieldsFull[fieldName] = [att.filename, att.base64];
    }
  }

  const timelinePromise = (async () => {
    const timelineStartedAt = Date.now();
    await onProgress({
      event: 'submit.bitrix.timeline.started',
      message: `Bitrix-Timeline-Upload als ein Kommentar gestartet (${attachments.length} Anhaenge, ~${totalPayloadKB} KB).`,
      context: {
        attachmentCount: attachments.length,
        totalPayloadKB,
        mode: 'single',
      },
    });

    const MAX_SINGLE_ATTEMPTS = 3;
    const RETRY_DELAY_MS = 10_000;

    for (let attempt = 1; attempt <= MAX_SINGLE_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        await onProgress({
          level: 'warn',
          event: 'submit.bitrix.timeline.single.retrying',
          message: `Bitrix-Timeline-Upload Versuch ${attempt}/${MAX_SINGLE_ATTEMPTS} gestartet (nach 10s Wartezeit).`,
          context: { attempt, maxAttempts: MAX_SINGLE_ATTEMPTS, attachmentCount: attachments.length, totalPayloadKB },
        });
      }

      try {
        singleTimelineEntry.response = await postTimelineComment({
          entityType: 'deal',
          entityId,
          comment,
          attachments,
        });
        singleTimelineEntry.ok = true;
      } catch (err) {
        singleTimelineEntry.ok = false;
        singleTimelineEntry.error = err.message;
      }

      if (singleTimelineEntry.ok) break;

      if (attempt < MAX_SINGLE_ATTEMPTS) {
        await onProgress({
          level: 'warn',
          event: 'submit.bitrix.timeline.single.attempt_failed',
          message: `Bitrix-Timeline-Upload Versuch ${attempt}/${MAX_SINGLE_ATTEMPTS} fehlgeschlagen (${formatDuration(Date.now() - timelineStartedAt)}): ${singleTimelineEntry.error}. Naechster Versuch in 10s.`,
          context: { attempt, maxAttempts: MAX_SINGLE_ATTEMPTS, durationMs: Date.now() - timelineStartedAt, error: singleTimelineEntry.error },
        });
      }
    }

    if (singleTimelineEntry.ok) {
      await onProgress({
        event: 'submit.bitrix.timeline.succeeded',
        message: `Bitrix-Timeline-Upload als ein Kommentar abgeschlossen (${formatDuration(Date.now() - timelineStartedAt)}).`,
        context: {
          durationMs: Date.now() - timelineStartedAt,
          attachmentCount: attachments.length,
          totalPayloadKB,
          mode: 'single',
        },
      });
      return [singleTimelineEntry];
    }

    await onProgress({
      level: 'warn',
      event: 'submit.bitrix.timeline.single.failed_retry_batches',
      message: `Bitrix-Timeline-Upload nach ${MAX_SINGLE_ATTEMPTS} Versuchen fehlgeschlagen (${formatDuration(Date.now() - timelineStartedAt)}): ${singleTimelineEntry.error}. Fallback mit mehreren Kommentaren startet.`,
      context: {
        durationMs: Date.now() - timelineStartedAt,
        attachmentCount: attachments.length,
        totalPayloadKB,
        error: singleTimelineEntry.error,
        mode: 'single',
      },
    });

    let fallbackComment = comment;
    const {
      sendableAttachments: fallbackAttachments,
      oversizedAttachments: oversizedTimelineAttachments,
    } = splitTimelineAttachmentsBySize(attachments);

    if (oversizedTimelineAttachments.length > 0) {
      fallbackComment += '\n\nHinweis — folgende Dateien waren fuer den Fallback-Timeline-Upload zu gross:\n'
        + oversizedTimelineAttachments.map(f => `- ${f.filename}: ${f.reason}`).join('\n');
      await onProgress({
        level: 'warn',
        event: 'submit.bitrix.attachments.timeline_oversized',
        message: `${oversizedTimelineAttachments.length} Timeline-Anhang/Anhaenge im Fallback uebersprungen (Einzeldatei zu gross): ${oversizedTimelineAttachments.map(f => f.filename).join(', ')}`,
        context: { oversizedTimelineAttachments },
      });
    }

    const { timelineBatches, timelineBatchCount, entries: fallbackEntries } = buildFallbackTimelineEntries(fallbackComment, fallbackAttachments);

    for (const timelineEntry of fallbackEntries) {
      const batchStartedAt = Date.now();
      const batchAttachments = timelineBatches[timelineEntry.batchIndex];
      const batchComment = buildTimelineBatchComment({
        baseComment: fallbackComment,
        batchIndex: timelineEntry.batchIndex,
        batchCount: timelineBatchCount,
      });

      await onProgress({
        event: 'submit.bitrix.timeline.batch.started',
        message: `Bitrix-Timeline-Kommentar ${timelineEntry.batchIndex + 1}/${timelineBatchCount} gestartet (${timelineEntry.attachmentCount} Anhaenge, ~${timelineEntry.payloadKB} KB).`,
        context: {
          batchIndex: timelineEntry.batchIndex,
          batchCount: timelineBatchCount,
          attachmentCount: timelineEntry.attachmentCount,
          payloadKB: timelineEntry.payloadKB,
        },
      });

      try {
        timelineEntry.response = await postTimelineComment({
          entityType: 'deal',
          entityId,
          comment: batchComment,
          attachments: batchAttachments,
        });
        timelineEntry.ok = true;
      } catch (err) {
        timelineEntry.ok = false;
        timelineEntry.error = err.message;
      }

      await onProgress({
        level: timelineEntry.ok ? 'info' : 'error',
        event: timelineEntry.ok ? 'submit.bitrix.timeline.batch.succeeded' : 'submit.bitrix.timeline.batch.failed',
        message: timelineEntry.ok
          ? `Bitrix-Timeline-Kommentar ${timelineEntry.batchIndex + 1}/${timelineBatchCount} abgeschlossen (${formatDuration(Date.now() - batchStartedAt)}).`
          : `Bitrix-Timeline-Kommentar ${timelineEntry.batchIndex + 1}/${timelineBatchCount} fehlgeschlagen (${formatDuration(Date.now() - batchStartedAt)}): ${timelineEntry.error}`,
        context: {
          durationMs: Date.now() - batchStartedAt,
          batchIndex: timelineEntry.batchIndex,
          batchCount: timelineBatchCount,
          attachmentCount: timelineEntry.attachmentCount,
          payloadKB: timelineEntry.payloadKB,
          error: timelineEntry.error,
        },
      });

      if (!timelineEntry.ok) break;
    }

    const failedTimelineEntry = fallbackEntries.find(entry => !entry.ok);
    const timelineSucceeded = !failedTimelineEntry;
    await onProgress({
      level: timelineSucceeded ? 'info' : 'error',
      event: timelineSucceeded ? 'submit.bitrix.timeline.succeeded' : 'submit.bitrix.timeline.failed',
      message: timelineSucceeded
        ? `Bitrix-Timeline-Upload im Fallback abgeschlossen (${formatDuration(Date.now() - timelineStartedAt)}).`
        : `Bitrix-Timeline-Upload fehlgeschlagen (${formatDuration(Date.now() - timelineStartedAt)}): ${failedTimelineEntry.error}`,
      context: {
        durationMs: Date.now() - timelineStartedAt,
        attachmentCount: fallbackAttachments.length,
        totalAttachmentCount: attachments.length,
        batchCount: timelineBatchCount,
        fallbackFromSingle: true,
        error: failedTimelineEntry?.error,
      },
    });
    return [singleTimelineEntry, ...fallbackEntries];
  })();

  let dealPromise = Promise.resolve(null);
  if (Object.keys(dealFieldsFull).length) {
    const dealEntry = buildDealFieldRequestEntry({ entityId, fields: dealFieldsFull });
    dealPromise = (async () => {
      const dealStartedAt = Date.now();
      await onProgress({
        event: 'submit.bitrix.deal_fields.started',
        message: `Bitrix-Auftragsfelder-Upload gestartet (${Object.keys(dealFieldsFull).length} Felder).`,
        context: { fieldCount: Object.keys(dealFieldsFull).length },
      });
      try {
        dealEntry.response = await updateDealFields({ dealId: entityId, fields: dealFieldsFull });
        dealEntry.ok = true;
      } catch (err) {
        dealEntry.ok = false;
        dealEntry.error = err.message;
      }
      await onProgress({
        level: dealEntry.ok ? 'info' : 'error',
        event: dealEntry.ok ? 'submit.bitrix.deal_fields.succeeded' : 'submit.bitrix.deal_fields.failed',
        message: dealEntry.ok
          ? `Bitrix-Auftragsfelder-Upload abgeschlossen (${formatDuration(Date.now() - dealStartedAt)}).`
          : `Bitrix-Auftragsfelder-Upload fehlgeschlagen (${formatDuration(Date.now() - dealStartedAt)}): ${dealEntry.error}`,
        context: {
          durationMs: Date.now() - dealStartedAt,
          fieldCount: Object.keys(dealFieldsFull).length,
          error: dealEntry.error,
        },
      });
      return dealEntry;
    })();
  }

  const hinweisComment = buildHinweisComment(data);
  let hinweisPromise = Promise.resolve(null);
  if (hinweisComment) {
    hinweisPromise = (async () => {
      const hinweisEntry = { label: 'Hinweis-Kommentar', mode: 'hinweis' };
      try {
        hinweisEntry.response = await postTimelineComment({ entityType: 'deal', entityId, comment: hinweisComment });
        hinweisEntry.ok = true;
      } catch (err) {
        hinweisEntry.ok = false;
        hinweisEntry.error = err.message;
      }
      await onProgress({
        level: hinweisEntry.ok ? 'info' : 'error',
        event: hinweisEntry.ok ? 'submit.bitrix.hinweis.succeeded' : 'submit.bitrix.hinweis.failed',
        message: hinweisEntry.ok
          ? 'Bitrix-Hinweis-Kommentar gesendet.'
          : `Bitrix-Hinweis-Kommentar fehlgeschlagen: ${hinweisEntry.error}`,
        context: { error: hinweisEntry.error },
      });
      return hinweisEntry;
    })();
  }

  const [finishedTimelineEntries, finishedDealEntry, finishedHinweisEntry] = await Promise.all([timelinePromise, dealPromise, hinweisPromise]);
  requests.push(...finishedTimelineEntries);
  if (finishedDealEntry) requests.push(finishedDealEntry);
  if (finishedHinweisEntry) requests.push(finishedHinweisEntry);

  const timelineSent = finishedTimelineEntries.some(entry => entry.mode === 'single' && entry.ok)
    || finishedTimelineEntries.filter(entry => entry.mode === 'fallback_batch').every(entry => entry.ok);
  const sent = timelineSent;
  const failed = requests.find(entry => !entry.ok && !(entry.mode === 'single' && timelineSent));

  return {
    attempted: true,
    sent,
    entityId,
    error: sent ? undefined : failed?.error,
    attachmentSummary: buildAttachmentSummary(attachments),
    durationMs: Date.now() - startedAt,
    requests,
  };
}

async function trySendDocumentToBitrix(data = {}, options = {}) {
  try {
    const result = await syncDocumentToBitrix(data, options);
    if (!result.attempted) {
      console.warn('[bitrix] skipped: no valid bitrixAuftragId', { received: data.bitrixAuftragId });
    } else if (result.sent) {
      console.log('[bitrix] timeline comment posted to deal', result.entityId);
    } else {
      console.error('[bitrix] post failed for deal', result.entityId, '-', result.error);
    }
    return result;
  } catch (error) {
    console.error('[bitrix] sync failed before sending -', error.message);
    return {
      attempted: true,
      sent: false,
      error: error.message,
    };
  }
}

const BITRIX_MAX_ATTEMPTS = 4; // 1 beim Absenden + 3 automatische Wiederholungen
const BITRIX_RETRY_AFTER_MS = 10 * 60 * 1000;
// ponytail: In-Memory-Sperre, reicht fuer genau eine Fly-Maschine. Bei mehreren Maschinen DB-Lock noetig.
const bitrixPushesInFlight = new Set();

// Laeuft nach der Antwort an den Monteur. Die Abnahme ist dann schon in MongoDB gespeichert.
async function pushAbnahmeToBitrix(abnahmeId, data, logContext = {}, { trigger = 'submit' } = {}) {
  const id = String(abnahmeId);
  if (bitrixPushesInFlight.has(id)) return null;
  bitrixPushesInFlight.add(id);
  const context = { ...logContext, submittedId: id, trigger };

  try {
    const claimed = await Abnahme.findOneAndUpdate(
      { _id: abnahmeId, bitrixStatus: { $ne: 'sent' } },
      { $inc: { bitrixAttempts: 1 }, $set: { bitrixLastAttemptAt: new Date() } },
      { new: true },
    );
    if (!claimed) return null;
    const attempt = claimed.bitrixAttempts || 1;

    await addOperationLog({
      event: 'submit.bitrix.started',
      message: trigger === 'admin'
        ? `Bitrix-Sendung manuell gestartet (Komplett neu senden, Versuch ${attempt}).`
        : `Bitrix-Sendung im Hintergrund gestartet (Versuch ${attempt}/${BITRIX_MAX_ATTEMPTS}).`,
      context: { ...context, attempt },
    });
    const bitrixSync = await trySendDocumentToBitrix(data, {
      onProgress: progress => addOperationLog({
        level: progress.level || 'info',
        event: progress.event,
        message: progress.message,
        context: { ...context, attempt, ...(progress.context || {}) },
      }),
    });

    const bitrixStatus = !bitrixSync.attempted ? 'skipped' : (bitrixSync.sent ? 'sent' : 'failed');
    await Abnahme.updateOne({ _id: abnahmeId }, {
      $set: {
        bitrixStatus,
        bitrixError: bitrixStatus === 'failed' ? (bitrixSync.error || 'Unbekannter Fehler') : '',
        ...(bitrixStatus === 'sent' ? { bitrixSentAt: new Date() } : {}),
      },
    });

    if (bitrixStatus === 'failed') {
      const final = attempt >= BITRIX_MAX_ATTEMPTS && trigger !== 'admin';
      await addOperationLog({
        level: 'error',
        event: final ? 'submit.bitrix.failed_final' : 'submit.bitrix.failed',
        message: final
          ? `Bitrix-Sendung endgueltig fehlgeschlagen nach ${attempt} Versuchen: ${bitrixSync.error}`
          : `Bitrix-Sendung fehlgeschlagen (Versuch ${attempt}/${BITRIX_MAX_ATTEMPTS}), automatischer neuer Versuch in ca. 10 Min.: ${bitrixSync.error}`,
        context: { ...context, attempt, bitrixSync },
      });
      if (final) {
        await notifyBaustellenabnahmeChat('bitrix_failed', { ...toPlainDocument(claimed), errorMessage: bitrixSync.error });
      }
      return bitrixSync;
    }

    await addOperationLog({
      event: 'submit.bitrix.succeeded',
      message: bitrixStatus === 'sent'
        ? `Bitrix hat die Dokumente akzeptiert (Versuch ${attempt}).`
        : 'Keine gueltige Bitrix-Auftrag-ID, Bitrix-Sendung uebersprungen.',
      context: { ...context, attempt, bitrixStatus, bitrixAttempted: bitrixSync.attempted, bitrixSent: bitrixSync.sent },
    });

    const chatId = await notifyBaustellenabnahmeChat('submitted', { ...data, shareToken: claimed.shareToken });
    if (chatId) {
      const checkPayload = buildAbnahmeCheckPayload(data, {
        chatId,
        customerName: buildCustomerName(data) || data.name,
        documents: bitrixSync.attachmentSummary || [],
      });
      // fire-and-forget: ein Fehler hier darf die Abnahme nie zuruecknehmen
      postAbnahmeCheck(checkPayload, { log: entry => addOperationLog({ ...entry, context: { ...context, ...(entry.context || {}) } }) })
        .catch(() => {});
    }
    return bitrixSync;
  } catch (error) {
    await addOperationLog({
      level: 'error',
      event: 'submit.bitrix.background_error',
      message: error.message,
      context,
    }).catch(() => {});
    return null;
  } finally {
    bitrixPushesInFlight.delete(id);
  }
}

let bitrixRetrySweepRunning = false;

// Sucht Abnahmen, deren Bitrix-Push fehlgeschlagen ist oder durch einen Neustart verloren ging.
async function retryPendingBitrixPushes() {
  if (bitrixRetrySweepRunning) return;
  bitrixRetrySweepRunning = true;
  try {
    const due = await Abnahme.find({
      bitrixLastAttemptAt: { $lt: new Date(Date.now() - BITRIX_RETRY_AFTER_MS) },
      $or: [
        { bitrixStatus: 'pending' },
        { bitrixStatus: 'failed', bitrixAttempts: { $lt: BITRIX_MAX_ATTEMPTS } },
      ],
    }).lean();

    for (const doc of due) {
      if (bitrixPushesInFlight.has(String(doc._id))) continue;
      const context = { bitrixAuftragId: doc.bitrixAuftragId, terminId: doc.terminId, submittedId: doc._id };

      // 'pending' ohne laufenden Push und ohne Versuche uebrig: der Prozess ist dabei mehrfach gestorben.
      if ((doc.bitrixAttempts || 0) >= BITRIX_MAX_ATTEMPTS) {
        const errorMessage = 'Server wurde waehrend der Bitrix-Uebertragung mehrfach neu gestartet.';
        await Abnahme.updateOne({ _id: doc._id }, { $set: { bitrixStatus: 'failed', bitrixError: errorMessage } });
        await addOperationLog({ level: 'error', event: 'submit.bitrix.failed_final', message: errorMessage, context });
        await notifyBaustellenabnahmeChat('bitrix_failed', { ...doc, errorMessage });
        continue;
      }

      await addOperationLog({
        event: 'submit.bitrix.auto_retry.started',
        message: `Automatischer Bitrix-Wiederholungsversuch (bisher ${doc.bitrixAttempts || 0} Versuche, Status ${doc.bitrixStatus}).`,
        context,
      });
      await pushAbnahmeToBitrix(doc._id, doc, context, { trigger: 'auto_retry' });
    }
  } catch (error) {
    await addOperationLog({ level: 'error', event: 'submit.bitrix.auto_retry.failed', message: error.message }).catch(() => {});
  } finally {
    bitrixRetrySweepRunning = false;
  }
}

// Nur Entwuerfe ab Einfuehrung des Auto-Speicherns (A2); aeltere Entwuerfe bleiben unangetastet.
const DRAFT_CLEANUP_CREATED_SINCE = new Date('2026-10-02T00:00:00Z');
const DRAFT_CLEANUP_AFTER_DAYS = 30;

async function cleanupExpiredDrafts() {
  try {
    const result = await deleteExpiredDrafts({ createdSince: DRAFT_CLEANUP_CREATED_SINCE, olderThanDays: DRAFT_CLEANUP_AFTER_DAYS });
    if (!result.deletedDrafts.length) return;
    await addOperationLog({
      event: 'draft.cleanup.deleted',
      message: `${result.deletedDrafts.length} Entwurf/Entwuerfe nach ${DRAFT_CLEANUP_AFTER_DAYS} Tagen ohne Aenderung geloescht (${result.deletedFiles.length} Dateien).`,
      context: result,
    });
  } catch (error) {
    await addOperationLog({ level: 'error', event: 'draft.cleanup.failed', message: error.message }).catch(() => {});
  }
}

const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const VOLUME_ALARM_PERCENT = 80;

// Files nothing references any more. The minimum age protects uploads whose
// draft is still being saved (multer writes the file before the draft exists).
async function cleanupOrphanFiles() {
  try {
    const result = await cleanupOrphanUploads({ deleteFiles: true, uploadsDir, minAgeMs: ORPHAN_MIN_AGE_MS });
    if (!result.deletedCount) return;
    await addOperationLog({
      event: 'storage.orphans.deleted',
      message: `${result.deletedCount} verwaiste Datei(en) geloescht (${result.deletedBytesLabel}).`,
      context: { files: result.orphanFiles.map(file => file.relativePath) },
    });
  } catch (error) {
    await addOperationLog({ level: 'error', event: 'storage.orphans.failed', message: error.message }).catch(() => {});
  }
}

async function checkVolumeUsage({ statfs } = {}) {
  try {
    const usage = await getVolumeUsage({ uploadsDir, ...(statfs ? { statfs } : {}) });
    if (usage.usedPercent < VOLUME_ALARM_PERCENT) return usage;
    const message = `Volume ${usage.usedPercent} % voll (${usage.usedLabel} von ${usage.totalLabel}).`;
    await addOperationLog({ level: 'error', event: 'storage.volume.alarm', message, context: usage });
    const sep = '━'.repeat(45);
    await postChatMessage([
      '💾 SPEICHER BAU-FORMULAR',
      sep,
      `☐ 🔴 ${message}`,
      '     👉 Testmodus → Volume-Speicher prüfen; ggf. „Alte Dateien löschen“ oder Volume vergrößern.',
      sep,
      '🤖 Automatisch generiert | Quelle: bau-formular',
    ].join('\n')).catch(error => addOperationLog({ level: 'error', event: 'chat.notify.failed', message: error.message, context: { kind: 'volume_alarm' } }));
    return usage;
  } catch (error) {
    await addOperationLog({ level: 'error', event: 'storage.volume.check_failed', message: error.message }).catch(() => {});
    return null;
  }
}

async function runDailyMaintenance() {
  await cleanupExpiredDrafts();
  await cleanupOrphanFiles();
  await checkVolumeUsage();
}

function startBackgroundJobs() {
  migrateLogRetention().catch(error => addOperationLog({ level: 'error', event: 'admin.logs.retention_migration_failed', message: error.message }).catch(() => {}));
  setTimeout(retryPendingBitrixPushes, 30 * 1000).unref();
  setInterval(retryPendingBitrixPushes, BITRIX_RETRY_AFTER_MS).unref();
  setTimeout(runDailyMaintenance, 60 * 1000).unref();
  setInterval(runDailyMaintenance, 24 * 60 * 60 * 1000).unref();
}

function buildDraftSearchQuery(search = '') {
  const value = String(search || '').trim();
  if (!value) return { status: 'draft' };

  const regex = new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  return {
    status: 'draft',
    $or: [
      { terminId: regex },
      { kundennummer: regex },
      { auftragsNummer: regex },
      { vorname: regex },
      { nachname: regex },
      { name: regex },
      { entwurfsName: regex },
    ],
  };
}

function buildSubmittedSearchQuery(search = '') {
  const value = String(search || '').trim();
  if (!value) return { status: 'submitted' };

  const regex = new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  return {
    status: 'submitted',
    $or: [
      { terminId: regex },
      { kundennummer: regex },
      { auftragsNummer: regex },
      { vorname: regex },
      { nachname: regex },
      { name: regex },
      { entwurfsName: regex },
    ],
  };
}

async function proxyArbeitsberichtPdf(payload = {}) {
  const endpoint = process.env.ARBEITSBERICHT_PDF_URL ||
    'https://angebotskonfigurator-emc2-v2.fly.dev/api/arbeitsbericht/pdf';

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      errorBody.error || `Arbeitsbericht PDF generation failed: ${response.status}`
    );
  }

  const arrayBuffer = await response.arrayBuffer();

  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: response.headers.get('content-type') || 'application/pdf',
    contentDisposition: response.headers.get('content-disposition') || 'attachment; filename="Arbeitsbericht.pdf"',
  };
}

router.get('/health', (_req, res) => {
  res.json({ ok: true });
});

router.get('/drafts', async (req, res) => {
  try {
    const drafts = await Entwurf.find(buildDraftSearchQuery(req.query.q))
      .sort({ updatedAt: -1 })
      .limit(20)
      .lean();

    return res.json({
      success: true,
      drafts: drafts.map(draft => ({
        _id: draft._id,
        shareToken: draft.shareToken,
        terminId: draft.terminId,
        kundennummer: draft.kundennummer,
        auftragsNummer: draft.auftragsNummer,
        vorname: draft.vorname,
        nachname: draft.nachname,
        name: draft.name,
        entwurfsName: draft.entwurfsName,
        status: draft.status,
        updatedAt: draft.updatedAt,
      })),
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/submitted', async (req, res) => {
  try {
    const items = await Abnahme.find(buildSubmittedSearchQuery(req.query.q))
      .sort({ updatedAt: -1 })
      .limit(20)
      .lean();

    return res.json({
      success: true,
      submitted: items.map(item => ({
        _id: item._id,
        shareToken: item.shareToken,
        terminId: item.terminId,
        kundennummer: item.kundennummer,
        auftragsNummer: item.auftragsNummer,
        vorname: item.vorname,
        nachname: item.nachname,
        name: item.name,
        entwurfsName: item.entwurfsName,
        status: item.status,
        updatedAt: item.updatedAt,
      })),
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/submitted/:id/export', async (req, res) => {
  try {
    const form = await Abnahme.findById(req.params.id).lean();
    if (!form) {
      return res.status(404).json({ success: false, error: 'Abnahme nicht gefunden' });
    }

    const customerSlug = String(`${form.vorname || ''}-${form.nachname || ''}`)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'abnahme';
    const zipName = `abnahme-${customerSlug}-${form._id}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('warning', err => { if (err.code !== 'ENOENT') throw err; });
    archive.on('error', err => { throw err; });
    archive.pipe(res);

    // 1. Raw JSON (everything from DB)
    archive.append(JSON.stringify(form, null, 2), { name: 'data.json' });

    // 2. Signature fields – any base64 data URL gets decoded into a PNG
    const signatures = [];
    for (const [key, value] of Object.entries(form)) {
      if (typeof value !== 'string' || !value.startsWith('data:image/')) continue;
      const match = value.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!match) continue;
      const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      const buf = Buffer.from(match[2], 'base64');
      archive.append(buf, { name: `signatures/${key}.${ext}` });
      signatures.push(`${key}.${ext}`);
    }

    // 3. File upload fields – pull the actual files from /uploads if present
    const fileFields = [
      'bilderFertigerUmbau', 'videoDesAblaufs', 'fotosAbdichtung',
      'bilderBehobeneMaengel', 'weitereBilder', 'weitereBilder2', 'weitereBilder3',
    ];
    const missingFiles = [];
    for (const field of fileFields) {
      const raw = form[field];
      const paths = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      for (const p of paths) {
        const basename = path.basename(String(p));
        const fullPath = path.join(uploadsDir, basename);
        if (fs.existsSync(fullPath)) {
          archive.file(fullPath, { name: `uploads/${field}/${basename}` });
        } else {
          missingFiles.push(`${field}/${basename}`);
        }
      }
    }

    // 4. Manifest so it's obvious what's inside
    const manifest = {
      _id: String(form._id),
      terminId: form.terminId,
      shareToken: form.shareToken,
      status: form.status,
      createdAt: form.createdAt,
      updatedAt: form.updatedAt,
      customer: `${form.vorname || ''} ${form.nachname || ''}`.trim(),
      signaturesExtracted: signatures,
      missingUploads: missingFiles,
      note: 'data.json contains the full document as stored in MongoDB. signatures/ holds the decoded PNGs. uploads/ holds the referenced files that were still on disk.',
    };
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

    await archive.finalize();
  } catch (error) {
    if (!res.headersSent) {
      return res.status(400).json({ success: false, error: error.message });
    }
    res.end();
  }
});

// Der Bitrix-Link (?dealId=) ist der einzige Einstieg der Monteure: so setzt ein zweites
// Handy (oder ein verlorener lokaler Stand) denselben Entwurf fort statt einen neuen anzulegen.
router.get('/drafts/by-deal/:dealId', async (req, res) => {
  try {
    const dealId = String(req.params.dealId || '').trim();
    if (!/^\d+$/.test(dealId)) return res.status(400).json({ success: false, error: 'Ungueltige Auftrag-ID' });
    const draft = await Entwurf.findOne({ bitrixAuftragId: dealId, formularTyp: 'baustellenabnahme' }).sort({ updatedAt: -1 });
    if (!draft) return res.status(404).json({ success: false, error: 'Kein Entwurf fuer diesen Auftrag' });
    return res.json({ success: true, data: draft });
  } catch (error) {
    return sendRouteError(res, error, 'Entwurf konnte nicht geladen werden');
  }
});

router.get('/drafts/:id', async (req, res) => {
  try {
    const draft = await Entwurf.findById(req.params.id);

    if (!draft) {
      return res.status(404).json({ success: false, error: 'Entwurf nicht gefunden' });
    }

    return res.json({ success: true, data: draft });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/save', uploadAny, async (req, res) => {
  let logContext = { uploadCount: req.files?.length || 0 };
  try {
    const parsed = parsePayload(req);
    logContext = buildRequestLogContext(parsed, req.files);
    // One entry per save (C4): auto-save (A2) runs often; failures keep the full context.
    const payload = preferCompressedVideos(mergeUploadedFiles(pickPayload(parsed), req.files));
    const formId = parsed._id || parsed.id;

    if (formId) {
      const existing = await Entwurf.findById(formId);

      if (existing) {
        Object.assign(existing, payload);
        assertDocumentSizeFitsMongo(toPlainDocument(existing), 'Entwurf');
        await existing.save();

        await addOperationLog({
          event: 'draft.save.updated',
          message: 'Bestehender Entwurf erfolgreich gespeichert.',
          context: buildRequestLogContext(parsed, req.files, {
            draftId: existing._id,
            shareToken: existing.shareToken,
          }),
        });
        return res.json(buildSuccessResponse(existing));
      }

      const submitted = await Abnahme.findById(formId);

      if (!submitted) {
        await addOperationLog({
          level: 'error',
          event: 'draft.save.source_missing',
          message: 'Entwurf konnte nicht gespeichert werden, weil Formular-ID weder Entwurf noch Abnahme findet.',
          context: buildRequestLogContext(parsed, req.files, { formId }),
        });
        return res.status(404).json({ success: false, error: 'Formular nicht gefunden' });
      }

      const draftPayload = {
        ...sanitizeDocumentForCreate(submitted.toObject()),
        ...payload,
        shareToken: createShareToken(),
        status: 'draft',
      };
      assertDocumentSizeFitsMongo(draftPayload, 'Entwurf');
      const draft = await Entwurf.create(draftPayload);

      await addOperationLog({
        event: 'draft.save.created_from_submission',
        message: 'Neuer Entwurf aus bestehender Abnahme erfolgreich gespeichert.',
        context: buildRequestLogContext(parsed, req.files, {
          draftId: draft._id,
          formId,
          shareToken: draft.shareToken,
        }),
      });
      return res.status(201).json(buildSuccessResponse(draft));
    }

    const draftPayload = {
      ...payload,
      shareToken: createShareToken(),
      status: 'draft',
    };
    assertDocumentSizeFitsMongo(draftPayload, 'Entwurf');
    const form = await Entwurf.create(draftPayload);

    await addOperationLog({
      event: 'draft.save.created',
      message: 'Neuer Entwurf erfolgreich gespeichert.',
      context: buildRequestLogContext(parsed, req.files, {
        draftId: form._id,
        shareToken: form.shareToken,
      }),
    });
    return res.status(201).json(buildSuccessResponse(form));
  } catch (error) {
    await deleteUploadedRequestFiles(req.files);
    await addOperationLog({
      level: 'error',
      event: 'draft.save.failed',
      message: error?.message || 'Entwurf konnte nicht gespeichert werden.',
      context: {
        ...logContext,
        details: formatErrorDetails(error),
        uploadedFilesDeleted: true,
      },
    });
    return sendRouteError(res, error, 'Entwurf konnte nicht gespeichert werden');
  }
});

router.post('/dev-mode/verify', (req, res) => {
  try {
    const password = req.body?.password;
    if (!isDevModePasswordValid(password)) {
      return res.status(403).json({ success: false, error: 'Passwort ungueltig' });
    }

    return res.json({ success: true });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/admin/orphan-uploads', async (req, res) => {
  try {
    const password = req.body?.password || req.get?.('x-admin-password');
    if (!isDevModePasswordValid(password)) {
      return res.status(403).json({ success: false, error: 'Passwort ungueltig' });
    }

    const shouldDelete = req.body?.delete === true;
    const report = await cleanupOrphanUploads({
      deleteFiles: shouldDelete,
      uploadsDir,
    });

    return res.json({
      success: true,
      mode: shouldDelete ? 'delete' : 'dry-run',
      report,
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/admin/logs', async (req, res) => {
  try {
    const password = req.body?.password || req.get?.('x-admin-password');
    if (!isDevModePasswordValid(password)) {
      return res.status(403).json({ success: false, error: 'Passwort ungueltig' });
    }

    return res.json({
      success: true,
      logs: await listOperationLogs({ limit: req.body?.limit || 100 }),
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/admin/logs/clear', async (req, res) => {
  try {
    const password = req.body?.password || req.get?.('x-admin-password');
    if (!isDevModePasswordValid(password)) {
      return res.status(403).json({ success: false, error: 'Passwort ungueltig' });
    }

    if (String(req.body?.confirm || '').trim() !== 'LÖSCHEN') {
      return res.status(400).json({ success: false, error: 'Bestätigungswort fehlt: LÖSCHEN eingeben.' });
    }

    // Only everyday entries: the audit trail (submit, Bitrix, admin, …) only expires (C4).
    const result = await OperationLog.deleteMany({ event: { $not: AUDIT_EVENT_PATTERN } });
    await addOperationLog({
      level: 'warn',
      event: 'admin.logs.cleared',
      message: `Alltags-Logs im Testmodus geloescht (${result.deletedCount || 0} Eintraege); Audit-Eintraege bleiben erhalten.`,
      context: { deletedCount: result.deletedCount || 0 },
    });

    return res.json({
      success: true,
      deletedCount: result.deletedCount || 0,
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/admin/submitted/:id/bitrix/video', async (req, res) => {
  try {
    const password = req.body?.password || req.get?.('x-admin-password');
    if (!isDevModePasswordValid(password)) {
      return res.status(403).json({ success: false, error: 'Passwort ungueltig' });
    }

    const form = await Abnahme.findById(req.params.id).lean();
    if (!form) {
      return res.status(404).json({ success: false, error: 'Abnahme nicht gefunden' });
    }

    const entityId = Number(req.body?.entityId || form.bitrixAuftragId || 0);
    if (!Number.isFinite(entityId) || entityId <= 0) {
      return res.status(400).json({ success: false, error: 'Keine gueltige Bitrix-Auftrag-ID' });
    }

    if (!form.videoDesAblaufs) {
      return res.status(404).json({ success: false, error: 'Kein Video des Ablaufs in der Abnahme gespeichert' });
    }

    const context = buildRequestLogContext(form, [], {
      submittedId: form._id,
      bitrixAuftragId: entityId,
    });

    await addOperationLog({
      event: 'admin.bitrix.video.started',
      message: 'Separater Bitrix-Upload fuer Video des Ablaufs gestartet.',
      context,
    });

    const media = await buildBitrixUploadAttachment(form.videoDesAblaufs, 'videoDesAblaufs', 1, { uploadsDir });
    if (media.skippedFile || !media.attachment) {
      const reason = media.skippedFile?.reason || 'Video konnte nicht vorbereitet werden';
      await addOperationLog({
        level: 'error',
        event: 'admin.bitrix.video.failed',
        message: `Video konnte nicht fuer Bitrix vorbereitet werden: ${reason}`,
        context: {
          ...context,
          skippedFile: media.skippedFile,
        },
      });
      return res.status(400).json({ success: false, error: reason, skippedFile: media.skippedFile });
    }

    const customer = buildCustomerName(form) || form.name || 'Kunde';
    const comment = String(req.body?.comment || [
      'Video des Ablaufs',
      '',
      `Kunde: ${customer}`,
      form.auftragsNummer ? `Auftrag: ${form.auftragsNummer}` : '',
      form.terminId ? `Termin-ID: ${form.terminId}` : '',
    ].filter(Boolean).join('\n'));

    const response = await postTimelineComment({
      entityType: 'deal',
      entityId,
      comment,
      attachments: [media.attachment],
    });

    await addOperationLog({
      event: 'admin.bitrix.video.succeeded',
      message: `Video des Ablaufs separat zu Bitrix hochgeladen (${media.attachment.filename}, ~${Math.round((media.attachment.base64?.length || 0) / 1024)} KB base64).`,
      context: {
        ...context,
        attachment: {
          filename: media.attachment.filename,
          base64Length: media.attachment.base64?.length || 0,
        },
        optimizedFile: media.optimizedFile,
      },
    });

    return res.json({
      success: true,
      entityId,
      attachment: {
        filename: media.attachment.filename,
        base64Length: media.attachment.base64?.length || 0,
      },
      optimizedFile: media.optimizedFile,
      response,
    });
  } catch (error) {
    await addOperationLog({
      level: 'error',
      event: 'admin.bitrix.video.failed',
      message: error?.message || 'Video konnte nicht zu Bitrix hochgeladen werden.',
      context: {
        submittedId: req.params.id,
        bitrixAuftragId: req.body?.entityId,
      },
    });
    return res.status(400).json({ success: false, error: error.message });
  }
});

const STORAGE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function getStorageStats() {
  let disk = null;
  try {
    const vfs = fs.statfsSync(uploadsDir);
    const total = vfs.blocks * vfs.bsize;
    const available = vfs.bavail * vfs.bsize;
    const used = total - available;
    disk = { total, used, available, usePercent: total > 0 ? Math.round((used / total) * 100) : 0 };
  } catch (_) {}

  const cutoff = Date.now() - STORAGE_MAX_AGE_MS;
  let fileCount = 0;
  let totalBytes = 0;
  let oldFileCount = 0;
  let oldFileBytes = 0;

  try {
    const files = fs.readdirSync(uploadsDir);
    for (const filename of files) {
      try {
        const stat = fs.statSync(path.join(uploadsDir, filename));
        if (!stat.isFile()) continue;
        fileCount++;
        totalBytes += stat.size;
        if (stat.mtime.getTime() < cutoff) {
          oldFileCount++;
          oldFileBytes += stat.size;
        }
      } catch (_) {}
    }
  } catch (_) {}

  return { disk, uploads: { fileCount, totalBytes, oldFileCount, oldFileBytes } };
}

router.post('/admin/storage', async (req, res) => {
  try {
    const password = req.body?.password || req.get?.('x-admin-password');
    if (!isDevModePasswordValid(password)) {
      return res.status(403).json({ success: false, error: 'Passwort ungueltig' });
    }
    return res.json({ success: true, ...getStorageStats() });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/admin/storage/cleanup', async (req, res) => {
  try {
    const password = req.body?.password || req.get?.('x-admin-password');
    if (!isDevModePasswordValid(password)) {
      return res.status(403).json({ success: false, error: 'Passwort ungueltig' });
    }

    const dryRun = req.body?.dryRun !== false;
    const cutoff = Date.now() - STORAGE_MAX_AGE_MS;

    const draftRefs = await getDraftFileReferences();

    const candidates = [];
    const protectedFiles = [];

    try {
      for (const filename of fs.readdirSync(uploadsDir)) {
        try {
          const fullPath = path.join(uploadsDir, filename);
          const stat = fs.statSync(fullPath);
          if (!stat.isFile() || stat.mtime.getTime() >= cutoff) continue;

          if (draftRefs.has(filename)) {
            protectedFiles.push({ filename, sizeBytes: stat.size });
          } else {
            candidates.push({ filename, fullPath, sizeBytes: stat.size });
          }
        } catch (_) {}
      }
    } catch (_) {}

    const candidateBytes = candidates.reduce((sum, f) => sum + f.sizeBytes, 0);
    let deletedCount = 0;
    let deletedBytes = 0;
    const errors = [];

    if (!dryRun) {
      for (const { filename, fullPath, sizeBytes } of candidates) {
        try {
          fs.unlinkSync(fullPath);
          deletedCount++;
          deletedBytes += sizeBytes;
        } catch (err) {
          errors.push({ filename, error: err.message });
        }
      }
      await addOperationLog({
        event: 'admin.storage.cleanup',
        message: `Speicherbereinigung: ${deletedCount} Datei(en) geloescht, ${Math.round(deletedBytes / 1024 / 1024)} MB freigegeben (aelter als 30 Tage, ${protectedFiles.length} Entwurf-Dateien geschuetzt).`,
        context: { deletedCount, deletedBytes, protectedCount: protectedFiles.length, errors },
      });
    }

    return res.json({
      success: true,
      dryRun,
      candidateCount: candidates.length,
      candidateBytes,
      protectedCount: protectedFiles.length,
      deletedCount: dryRun ? 0 : deletedCount,
      deletedBytes: dryRun ? 0 : deletedBytes,
      errors: dryRun ? [] : errors,
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

const ADMIN_FILE_FIELD_LABELS = {
  bilderFertigerUmbau: 'Bilder fertiger Umbau',
  fotosAbdichtung: 'Fotos Abdichtung',
  bilderBehobeneMaengel: 'Bilder behobene Mängel',
  weitereBilder: 'Weitere Bilder',
  weitereBilder2: 'Weitere Bilder 2',
  weitereBilder3: 'Weitere Bilder 3',
};
const ADMIN_IMAGE_FIELDS = Object.keys(ADMIN_FILE_FIELD_LABELS);
const ADMIN_VIDEO_FIELDS = ['videoDesAblaufs'];

async function findAdminForm(id) {
  let form = null;
  let source = null;
  try {
    form = await Abnahme.findById(id).lean();
    if (form) source = 'abnahme';
  } catch (_) {}
  if (!form) {
    try {
      form = await Entwurf.findById(id).lean();
      if (form) source = 'entwurf';
    } catch (_) {}
  }
  return { form, source };
}

async function findAdminFormByBitrixId(entityId) {
  const idQuery = { bitrixAuftragId: { $in: [entityId, String(entityId)] } };
  const abnahmen = await Abnahme.find(idQuery).sort({ updatedAt: -1 }).limit(2).lean();
  if (abnahmen.length > 0) {
    return { form: abnahmen[0], source: 'abnahme', multipleCount: abnahmen.length };
  }
  const entwuerfe = await Entwurf.find(idQuery).sort({ updatedAt: -1 }).limit(2).lean();
  if (entwuerfe.length > 0) {
    return { form: entwuerfe[0], source: 'entwurf', multipleCount: entwuerfe.length };
  }
  return { form: null, source: null, multipleCount: 0 };
}

router.post('/admin/inspect', async (req, res) => {
  try {
    const password = req.body?.password;
    if (!isDevModePasswordValid(password)) {
      return res.status(403).json({ success: false, error: 'Passwort ungueltig' });
    }

    const rawEntityId = req.body?.entityId;
    const entityId = Number(rawEntityId);
    if (!Number.isFinite(entityId) || entityId <= 0) {
      return res.status(400).json({ success: false, error: 'Bitrix-Auftrag-ID fehlt oder ungültig' });
    }

    const { form, source, multipleCount } = await findAdminFormByBitrixId(entityId);
    if (!form) return res.status(404).json({ success: false, error: `Kein Formular mit Bitrix-Auftrag-ID ${entityId} gefunden` });

    const storedEntityId = Number(form.bitrixAuftragId || 0);

    const bilder = [];
    for (const field of ADMIN_IMAGE_FIELDS) {
      const raw = form[field];
      const paths = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      for (const p of paths) {
        const filename = path.basename(String(p || '').trim());
        if (!filename) continue;
        const exists = fs.existsSync(path.join(uploadsDir, filename));
        bilder.push({ field, filename, label: ADMIN_FILE_FIELD_LABELS[field], exists });
      }
    }

    const video = [];
    for (const field of ADMIN_VIDEO_FIELDS) {
      const raw = form[field];
      const paths = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      for (const p of paths) {
        const filename = path.basename(String(p || '').trim());
        if (!filename) continue;
        const exists = fs.existsSync(path.join(uploadsDir, filename));
        video.push({ field, filename, exists });
      }
    }

    return res.json({
      success: true,
      source,
      multipleCount,
      form: {
        _id: String(form._id),
        customerName: buildCustomerName(form) || form.name || '—',
        bitrixAuftragId: storedEntityId,
        auftragsNummer: form.auftragsNummer || '',
        terminId: form.terminId || '',
        bitrixStatus: form.bitrixStatus || '',
        bitrixAttempts: form.bitrixAttempts || 0,
        bitrixError: form.bitrixError || '',
      },
      categories: { bilder, video, pdfs: ADMIN_PDF_SPECS },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Komplett neu senden: exakt derselbe Push wie nach dem Absenden (Text, Dateien, PDFs, Auftragsfelder, Hinweis, Chat, n8n).
router.post('/admin/resend-full', async (req, res) => {
  try {
    if (!isDevModePasswordValid(req.body?.password)) {
      return res.status(403).json({ success: false, error: 'Passwort ungueltig' });
    }
    const entityId = Number(req.body?.entityId);
    if (!Number.isFinite(entityId) || entityId <= 0) {
      return res.status(400).json({ success: false, error: 'Bitrix-Auftrag-ID fehlt oder ungültig' });
    }

    const { form, source } = await findAdminFormByBitrixId(entityId);
    if (!form || source !== 'abnahme') {
      return res.status(404).json({ success: false, error: `Keine abgesendete Abnahme mit Bitrix-Auftrag-ID ${entityId} gefunden` });
    }
    if (bitrixPushesInFlight.has(String(form._id))) {
      return res.status(409).json({ success: false, error: 'Für diesen Auftrag läuft gerade eine Bitrix-Übertragung. Bitte in ein paar Minuten erneut versuchen.' });
    }
    if (form.bitrixStatus === 'sent') {
      return res.status(409).json({ success: false, error: 'Diese Abnahme ist bereits vollständig in Bitrix. Für einzelne Dateien „Zu Bitrix senden“ nutzen.' });
    }

    const context = { bitrixAuftragId: form.bitrixAuftragId, terminId: form.terminId, submittedId: form._id };
    await addOperationLog({ event: 'admin.bitrix.resend_full.started', message: 'Komplett neu senden gestartet.', context });
    const bitrixSync = await pushAbnahmeToBitrix(form._id, form, context, { trigger: 'admin' });
    if (!bitrixSync) {
      return res.status(500).json({ success: false, error: 'Übertragung konnte nicht gestartet werden (Details in den Logs).' });
    }
    const sent = !bitrixSync.attempted || bitrixSync.sent;
    return res.status(sent ? 200 : 502).json({
      success: sent,
      error: sent ? undefined : `Bitrix-Sendung fehlgeschlagen: ${bitrixSync.error || 'Unbekannter Fehler'}`,
      attachmentCount: bitrixSync.attachmentSummary?.length || 0,
      durationMs: bitrixSync.durationMs,
    });
  } catch (error) {
    await addOperationLog({ level: 'error', event: 'admin.bitrix.resend_full.failed', message: error.message, context: { entityId: req.body?.entityId } });
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/admin/push', async (req, res) => {
  try {
    const password = req.body?.password;
    if (!isDevModePasswordValid(password)) {
      return res.status(403).json({ success: false, error: 'Passwort ungueltig' });
    }

    const entityId = Number(req.body?.entityId);
    if (!Number.isFinite(entityId) || entityId <= 0) {
      return res.status(400).json({ success: false, error: 'Bitrix-Auftrag-ID fehlt oder ungültig' });
    }

    const selectedFiles = Array.isArray(req.body?.files) ? req.body.files : [];
    const selectedPdfKeys = Array.isArray(req.body?.pdfKeys) ? req.body.pdfKeys : [];

    if (!selectedFiles.length && !selectedPdfKeys.length) {
      return res.status(400).json({ success: false, error: 'Keine Dateien oder PDFs ausgewählt' });
    }

    const { form, source } = await findAdminFormByBitrixId(entityId);
    if (!form) return res.status(404).json({ success: false, error: `Kein Formular mit Bitrix-Auftrag-ID ${entityId} gefunden` });
    if (source === 'abnahme' && bitrixPushesInFlight.has(String(form._id))) {
      return res.status(409).json({ success: false, error: 'Für diesen Auftrag läuft gerade eine automatische Bitrix-Übertragung. Bitte in ein paar Minuten erneut versuchen.' });
    }

    const context = { source, entityId };
    await addOperationLog({ event: 'admin.bitrix.push.started', message: `Admin-Push gestartet (${selectedFiles.length} Dateien, ${selectedPdfKeys.length} PDFs).`, context });

    const attachments = [];
    const skippedFiles = [];
    const optimizedFiles = [];

    // Build file attachments
    for (const { field, filename } of selectedFiles) {
      if (!filename) continue;
      try {
        const result = await buildBitrixUploadAttachment(filename, field, attachments.length + 1, { uploadsDir });
        if (result.skippedFile) { skippedFiles.push(result.skippedFile); continue; }
        attachments.push(result.attachment);
        if (result.optimizedFile) optimizedFiles.push(result.optimizedFile);
      } catch (err) {
        skippedFiles.push({ filename, fieldName: field, reason: err.message });
      }
    }

    // Build PDF attachments
    if (selectedPdfKeys.length) {
      try {
        const pdfAttachments = await buildSelectedPdfAttachments(form, selectedPdfKeys);
        attachments.push(...pdfAttachments);
      } catch (err) {
        await addOperationLog({ level: 'warn', event: 'admin.bitrix.push.pdf_error', message: `PDF-Generierung teilweise fehlgeschlagen: ${err.message}`, context });
      }
    }

    if (!attachments.length) {
      return res.status(400).json({ success: false, error: 'Keine Anhänge konnten vorbereitet werden', skippedFiles });
    }

    const customer = buildCustomerName(form) || form.name || 'Kunde';
    const comment = [
      'Admin-Push: Ausgewählte Dateien',
      '',
      `Kunde: ${customer}`,
      form.auftragsNummer ? `Auftrag: ${form.auftragsNummer}` : '',
      form.terminId ? `Termin-ID: ${form.terminId}` : '',
      skippedFiles.length ? `\nHinweis — ${skippedFiles.length} Datei(en) übersprungen:\n${skippedFiles.map(f => `- ${f.filename}: ${f.reason}`).join('\n')}` : '',
    ].filter(Boolean).join('\n');

    // Try single comment first, then batch fallback
    let timelineResults = [];
    try {
      const response = await postTimelineComment({ entityType: 'deal', entityId, comment, attachments });
      timelineResults = [{ ok: true, mode: 'single', attachmentCount: attachments.length, response }];
    } catch (singleErr) {
      const batches = createTimelineAttachmentBatches(attachments);
      for (let i = 0; i < batches.length; i++) {
        const batchComment = buildTimelineBatchComment({ baseComment: comment, batchIndex: i, batchCount: batches.length });
        try {
          const response = await postTimelineComment({ entityType: 'deal', entityId, comment: batchComment, attachments: batches[i] });
          timelineResults.push({ ok: true, mode: 'batch', batchIndex: i, batchCount: batches.length, attachmentCount: batches[i].length, response });
        } catch (batchErr) {
          timelineResults.push({ ok: false, mode: 'batch', batchIndex: i, batchCount: batches.length, error: batchErr.message });
        }
      }
    }

    const allOk = timelineResults.length > 0 && timelineResults.every(r => r.ok);
    if (allOk && source === 'abnahme') {
      // Buero hat von Hand nachgesendet: automatische Wiederholungen stoppen.
      await Abnahme.updateOne({ _id: form._id }, { $set: { bitrixStatus: 'sent', bitrixError: '', bitrixSentAt: new Date() } });
    }
    await addOperationLog({
      event: allOk ? 'admin.bitrix.push.succeeded' : 'admin.bitrix.push.partial',
      message: `Admin-Push ${allOk ? 'erfolgreich' : 'teilweise fehlgeschlagen'} (${attachments.length} Anhänge, ${timelineResults.length} Kommentar(e)).`,
      context: { ...context, attachmentCount: attachments.length, skippedCount: skippedFiles.length, optimizedCount: optimizedFiles.length, timelineResults },
    });

    return res.json({ success: allOk, entityId, attachmentCount: attachments.length, skippedFiles, optimizedFiles, timelineResults });
  } catch (error) {
    await addOperationLog({ level: 'error', event: 'admin.bitrix.push.failed', message: error.message, context: { entityId: req.body?.entityId } });
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Errors injected by browsers/extensions, not by our code (seen in production:
// Brave on iOS, crypto wallets, cross-origin "Script error.", embedded browsers).
const CLIENT_NOISE_PATTERNS = [/^Script error\.?$/i, /__firefox__/, /window\.ethereum/, /prompt\(\) is not supported/i];

function isClientNoise(event, message = '') {
  if (event !== 'client.error' && event !== 'client.unhandled_rejection') return false;
  return CLIENT_NOISE_PATTERNS.some(pattern => pattern.test(String(message).trim()));
}

const CLIENT_CHAT_EVENTS = {
  'client.error': 'Programmfehler im Formular',
  'client.unhandled_rejection': 'Programmfehler im Formular',
  'client.outbox.rejected': 'Wartendes Absenden vom Server abgelehnt',
};
const CLIENT_CHAT_INTERVAL_MS = 60 * 60 * 1000;
// ponytail: in-memory rate limit, resets on restart; fine for one machine.
const clientChatLastSent = new Map();

function describeDevice(userAgent = '') {
  const os = /iPhone|iPad/.test(userAgent) ? 'iPhone' : (/Android/.test(userAgent) ? 'Android' : 'Computer');
  const browser = /Brave/.test(userAgent) ? 'Brave'
    : /CriOS|Chrome/.test(userAgent) ? 'Chrome'
      : /FxiOS|Firefox/.test(userAgent) ? 'Firefox'
        : /Safari/.test(userAgent) ? 'Safari' : 'Browser';
  return `${os} ${browser}`;
}

async function findFormForChat(formId) {
  if (!formId || !mongoose.isValidObjectId?.(formId)) return null;
  return (await Entwurf.findById(formId).lean()) || (await Abnahme.findById(formId).lean());
}

async function notifyClientErrorChat(event, payload = {}) {
  const message = String(payload.message || '').slice(0, 300);
  const key = `${event}|${message.slice(0, 120)}`;
  const now = Date.now();
  if (now - (clientChatLastSent.get(key) || 0) < CLIENT_CHAT_INTERVAL_MS) return false;
  clientChatLastSent.set(key, now);

  const form = await findFormForChat(payload.formId).catch(() => null);
  const dealId = form?.bitrixAuftragId || payload.bitrixAuftragId;
  const customer = (form && (buildCustomerName(form) || form.name)) || String(payload.customerName || '').slice(0, 80) || 'Kunde unbekannt';
  const dealLink = buildDealLink(dealId);
  const formLink = buildFormLink(form?.shareToken);
  const sep = '━'.repeat(45);
  const lines = [
    '⚠️ FEHLER IM FORMULAR',
    sep,
    `☐ 🔴 ${dealId ? `[${dealId}] ` : ''}${customer} — ${CLIENT_CHAT_EVENTS[event]}`,
    `     Fehler: ${message || 'ohne Text'}`,
  ];
  if (payload.stepTitle) lines.push(`     Schritt: ${payload.stepTitle}`);
  lines.push(`     Gerät: ${describeDevice(payload.browser)}`);
  if (dealLink) lines.push(`     🔗 Auftrag: ${dealLink}`);
  if (formLink) lines.push(`     📝 Formular: ${formLink}`);
  lines.push('     ℹ️ Gleicher Fehler wird höchstens 1× pro Stunde gemeldet. Details: Testmodus → Logs.');
  lines.push(sep, '🤖 Automatisch generiert | Quelle: bau-formular');

  try {
    await postChatMessage(lines.join('\n'));
    return true;
  } catch (error) {
    await addOperationLog({ level: 'error', event: 'chat.notify.failed', message: error.message, context: { kind: event } });
    return false;
  }
}

router.post('/client-log', async (req, res) => {
  try {
    const payload = req.body || {};
    const event = String(payload.event || '');
    const allowedEvents = new Set([
      'client.validation.blocked',
      'client.error',
      'client.unhandled_rejection',
      'client.submit.success',
      'client.save.adopt_skipped',
      'client.local.restored',
      'client.local.failed',
      'client.autosave.failed',
      'client.draft.loaded_by_deal',
      'client.outbox.queued',
      'client.outbox.sent',
      'client.outbox.retry_failed',
      'client.outbox.rejected',
      'client.storage.persist',
      'client.action.failed',
    ]);

    if (!allowedEvents.has(event)) {
      return res.status(400).json({ success: false, error: 'Log event not allowed' });
    }
    if (isClientNoise(event, payload.message)) {
      return res.json({ success: true, ignored: true });
    }

    await addOperationLog({
      level: payload.level === 'error' ? 'error' : 'warn',
      event,
      message: String(payload.message || '').slice(0, 500),
      context: {
        terminId: payload.terminId,
        bitrixAuftragId: payload.bitrixAuftragId,
        auftragsNummer: payload.auftragsNummer,
        formId: payload.formId,
        draftId: payload.draftId,
        action: payload.action,
        step: payload.step,
        stepTitle: payload.stepTitle,
        issues: Array.isArray(payload.issues) ? payload.issues.slice(0, 20) : [],
        browser: payload.browser,
        path: payload.path,
        fileSummary: payload.fileSummary,
        elapsedMs: typeof payload.elapsedMs === 'number' ? payload.elapsedMs : undefined,
        bitrixSynced: typeof payload.bitrixSynced === 'boolean' ? payload.bitrixSynced : undefined,
        fileField: payload.fileField,
        expectedCount: typeof payload.expectedCount === 'number' ? payload.expectedCount : undefined,
        receivedCount: typeof payload.receivedCount === 'number' ? payload.receivedCount : undefined,
      },
    });

    if (CLIENT_CHAT_EVENTS[event]) {
      notifyClientErrorChat(event, payload).catch(() => {});
    }
    return res.json({ success: true });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.get('/token/:token', async (req, res) => {
  try {
    const form =
      await Entwurf.findOne({ shareToken: req.params.token }) ||
      await Abnahme.findOne({ shareToken: req.params.token });

    if (!form) {
      return res.status(404).json({ success: false, error: 'Formular nicht gefunden' });
    }

    return res.json({ success: true, data: form });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/document/render', async (req, res) => {
  try {
    const document = buildDocumentPackage(parsePayload(req));
    return res.json({ success: true, document });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/document/email', async (req, res) => {
  try {
    const parsed = parsePayload(req);
    const to = String(req.body?.to || parsed.emailEmpfaenger || '').trim();

    if (!to) {
      return res.status(400).json({ success: false, error: 'E-Mail-Adresse fehlt' });
    }

    const document = buildDocumentPackage(parsed);
    const result = await sendDocumentEmail({
      to,
      subject: String(req.body?.subject || document.subject).trim(),
      document,
    });

    return res.json({ success: true, ...result, document });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/document/bitrix', async (req, res) => {
  try {
    const parsed = parsePayload(req);
    const entityId = Number(req.body?.entityId || parsed.bitrixAuftragId || 0);

    if (!Number.isFinite(entityId) || entityId <= 0) {
      return res.status(400).json({ success: false, error: 'Gueltige Bitrix-Auftrag-ID fehlt' });
    }

    const document = buildDocumentPackage(parsed);
    const comment = [document.title, '', document.text].join('\n');
    const { attachments } = await buildStepDocumentAttachments(parsed, {
      includeDebug: String(parsed.debugMode || '').toLowerCase() === 'true',
    });

    const result = await postTimelineComment({
      entityType: 'deal',
      entityId,
      comment,
      attachments,
    });

    return res.json({ success: true, result, document });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/debug-bitrix-payload', uploadAny, async (req, res) => {
  try {
    const parsed = parsePayload(req);
    mergeUploadedFiles(parsed, req.files);
    const bitrixSync = await trySendDocumentToBitrix(parsed);
    return res.json({ success: true, ...bitrixSync, bitrixSync });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/document/step-pdf', async (req, res) => {
  try {
    const parsed = parsePayload(req);
    const prefix = String(req.body?.filenamePrefix || '').trim();
    if (!prefix) {
      return res.status(400).json({ success: false, error: 'filenamePrefix fehlt' });
    }
    const { attachments } = await buildStepDocumentAttachments(parsed, { includeDebug: true, forceAll: true });
    const match = attachments.find(a => a.filename && a.filename.startsWith(prefix));
    if (!match || !match.base64) {
      return res.status(404).json({ success: false, error: `Kein PDF mit Prefix "${prefix}" gefunden` });
    }
    const buffer = Buffer.from(match.base64, 'base64');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${match.filename}"`);
    return res.status(200).send(buffer);
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/arbeitsbericht/pdf', async (req, res) => {
  try {
    const pdf = await proxyArbeitsberichtPdf(parsePayload(req));

    res.setHeader('Content-Type', pdf.contentType);
    res.setHeader('Content-Disposition', pdf.contentDisposition);
    return res.status(200).send(pdf.buffer);
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/submit', uploadAny, async (req, res) => {
  let recoveryDraft = null;
  let uploadedFilesProtectedByDraft = false;
  let logContext = { uploadCount: req.files?.length || 0 };

  try {
    const parsed = parsePayload(req);
    logContext = buildRequestLogContext(parsed, req.files, { submitId: parsed.submitId });
    const alreadySubmitted = await findAbnahmeBySubmitId(parsed.submitId);
    if (alreadySubmitted) {
      await deleteUploadedRequestFiles(req.files);
      await addOperationLog({
        event: 'submit.duplicate_ignored',
        message: 'Absenden mit bekannter submitId wiederholt (z. B. Antwort ging verloren). Bestehende Abnahme wird zurueckgegeben.',
        context: { ...logContext, submittedId: alreadySubmitted._id },
      });
      return res.status(200).json({ ...buildSuccessResponse(alreadySubmitted), bitrixStatus: alreadySubmitted.bitrixStatus, duplicate: true });
    }
    await addOperationLog({
      event: 'submit.received',
      message: 'Absenden empfangen. Zuerst wird ein Recovery-Entwurf gespeichert.',
      context: logContext,
    });

    const payload = preferCompressedVideos(mergeUploadedFiles(pickPayload(parsed), req.files));
    const formId = parsed._id || parsed.id;
    const recovery = await runMongoTransaction(session => persistSubmitRecoveryDraft({ formId, payload, session }));
    recoveryDraft = recovery.draft;
    uploadedFilesProtectedByDraft = true;
    logContext = buildRequestLogContext(parsed, req.files, {
      draftId: recoveryDraft._id,
      shareToken: recoveryDraft.shareToken,
      recoverySource: recovery.source,
      submittedId: recovery.submitted?._id,
    });
    await addOperationLog({
      event: 'submit.recovery_draft.saved',
      message: 'Recovery-Entwurf erfolgreich gespeichert. Uploads sind durch diesen Entwurf referenziert.',
      context: logContext,
    });

    const draftData = sanitizeDocumentForCreate(toPlainDocument(recoveryDraft));
    const bitrixPayload = {
      ...draftData,
      ...parsed,
      ...payload,
    };

    const submitResult = await runMongoTransaction(async session => {
      await addOperationLog({
        event: 'submit.transaction.started',
        message: 'Kurze MongoDB-Transaktion fuer Abnahme und Entwurf-Loeschung gestartet.',
        context: logContext,
      });

      if (recovery.submitted) {
        const submitted = await findByIdWithSession(Abnahme, recovery.submitted._id, session);

        if (!submitted) {
          const error = new Error('Formular nicht gefunden');
          error.status = 404;
          throw error;
        }

        const existingShareToken = submitted.shareToken || createShareToken();
        Object.assign(submitted, {
          ...draftData,
          ...bitrixPendingFields(),
          shareToken: existingShareToken,
          status: 'submitted',
        });
        assertDocumentSizeFitsMongo(toPlainDocument(submitted), 'Abnahme');
        await submitted.save({ session });
        await addOperationLog({
          event: 'submit.abnahme.updated',
          message: 'Bestehende Abnahme in MongoDB innerhalb der Transaktion gespeichert.',
          context: {
            ...logContext,
            submittedId: submitted._id,
          },
        });

        const draftToDelete = await findByIdWithSession(Entwurf, recoveryDraft._id, session);
        await deleteDraftDocument(draftToDelete, session);
        await addOperationLog({
          event: 'submit.recovery_draft.deleted',
          message: 'Recovery-Entwurf innerhalb der Transaktion zur Loeschung markiert.',
          context: logContext,
        });

        const response = buildSuccessResponse(submitted);
        return {
          statusCode: 200,
          response: {
            ...response,
            bitrixStatus: 'pending',
          },
          submittedId: submitted._id,
        };
      }

      const submitPayload = {
        ...draftData,
        ...bitrixPendingFields(),
        shareToken: recoveryDraft.shareToken || createShareToken(),
        status: 'submitted',
      };
      assertDocumentSizeFitsMongo(submitPayload, 'Abnahme');
      const submitted = await createDocument(Abnahme, submitPayload, session);
      await addOperationLog({
        event: 'submit.abnahme.created',
        message: 'Neue Abnahme in MongoDB innerhalb der Transaktion gespeichert.',
        context: {
          ...logContext,
          submittedId: submitted._id,
        },
      });

      const draftToDelete = await findByIdWithSession(Entwurf, recoveryDraft._id, session);
      await deleteDraftDocument(draftToDelete, session);
      await addOperationLog({
        event: 'submit.recovery_draft.deleted',
        message: 'Recovery-Entwurf innerhalb der Transaktion zur Loeschung markiert.',
        context: logContext,
      });

      const response = buildSuccessResponse(submitted);
      return {
        statusCode: recovery.source === 'new' ? 201 : 200,
        response: {
          ...response,
          bitrixStatus: 'pending',
        },
        submittedId: submitted._id,
      };
    });

    await addOperationLog({
      event: 'submit.transaction.committed',
      message: 'MongoDB-Transaktion abgeschlossen. Abnahme ist gespeichert und Recovery-Entwurf geloescht.',
      context: {
        ...logContext,
        submittedId: submitResult.submittedId,
      },
    });
    res.status(submitResult.statusCode).json(submitResult.response);
    // Bitrix, Chat und n8n laufen nach der Antwort. Die Abnahme ist schon gespeichert.
    // ponytail: Neustart waehrend des Pushs verliert ihn; retryPendingBitrixPushes holt ihn nach 10 Min. nach.
    req.bitrixPush = pushAbnahmeToBitrix(submitResult.submittedId, bitrixPayload, logContext);
    return undefined;
  } catch (error) {
    // Zwei Versuche mit derselben submitId gleichzeitig: der zweite scheitert am Unique-Index.
    const raceWinner = error?.code === 11000 ? await findAbnahmeBySubmitId(parsePayload(req).submitId).catch(() => null) : null;
    if (raceWinner) {
      await addOperationLog({
        event: 'submit.duplicate_ignored',
        message: 'Paralleles Absenden mit derselben submitId; bestehende Abnahme wird zurueckgegeben.',
        context: { ...logContext, submittedId: raceWinner._id },
      });
      return res.status(200).json({ ...buildSuccessResponse(raceWinner), bitrixStatus: raceWinner.bitrixStatus, duplicate: true });
    }
    if (!uploadedFilesProtectedByDraft) {
      await deleteUploadedRequestFiles(req.files);
    }

    const response = {
      success: false,
      error: error?.message || 'Formular konnte nicht abgesendet werden',
    };

    if (recoveryDraft) {
      response.draftSaved = true;
      response.draftId = recoveryDraft._id;
      response.shareToken = recoveryDraft.shareToken;
      response.shareLink = recoveryDraft.shareToken ? `/form/${recoveryDraft.shareToken}` : undefined;
    }

    const details = formatErrorDetails(error);
    if (details.length) response.details = details;

    await addOperationLog({
      level: 'error',
      event: recoveryDraft ? 'submit.failed.draft_available' : 'submit.failed.no_draft',
      message: recoveryDraft
        ? `${response.error} Der Stand wurde als Entwurf gesichert.`
        : `${response.error} Es konnte kein Recovery-Entwurf gesichert werden.`,
      context: {
        ...logContext,
        draftId: recoveryDraft?._id,
        shareToken: recoveryDraft?.shareToken,
        draftSaved: Boolean(recoveryDraft),
        uploadedFilesDeleted: !uploadedFilesProtectedByDraft,
        details,
      },
    });
    if (recoveryDraft) {
      await notifyBaustellenabnahmeChat('failed', { ...toPlainDocument(recoveryDraft), errorMessage: response.error });
    }
    return res.status(error?.status || error?.statusCode || 400).json(response);
  }
});

module.exports = router;
module.exports.pushAbnahmeToBitrix = pushAbnahmeToBitrix;
module.exports.retryPendingBitrixPushes = retryPendingBitrixPushes;
module.exports.startBackgroundJobs = startBackgroundJobs;
module.exports.cleanupExpiredDrafts = cleanupExpiredDrafts;
module.exports.cleanupOrphanFiles = cleanupOrphanFiles;
module.exports.checkVolumeUsage = checkVolumeUsage;
module.exports.notifyClientErrorChat = notifyClientErrorChat;
module.exports.compressVideosAfterResponse = compressVideosAfterResponse;
module.exports.preferCompressedVideos = preferCompressedVideos;
