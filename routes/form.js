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
const { postTimelineComment, updateDealFields } = require('../services/bitrix');
const { buildStepDocumentAttachments, buildBitrixUploadAttachment, buildSelectedPdfAttachments, buildCustomerName, ADMIN_PDF_SPECS, compressUploadedFiles } = require('../services/stepDocuments');
const { getUploadsDir } = require('../services/uploadsPath');
const { cleanupOrphanUploads } = require('../services/orphanUploads');
const { addOperationLog, listOperationLogs } = require('../services/operationLogs');

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
        if (compressed.length > 0) {
          addOperationLog({
            event: 'upload.compressed',
            message: `${compressed.length} Bild(er) bei Upload komprimiert.`,
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

function createShareToken() {
  return crypto.randomBytes(16).toString('hex');
}

function parsePayload(req) {
  if (typeof req.body?.formData === 'string') {
    return JSON.parse(req.body.formData);
  }

  if (req.body?.formData && typeof req.body.formData === 'object') {
    return { ...req.body.formData };
  }

  return { ...req.body };
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

function assertBitrixSubmitSucceeded(bitrixSync) {
  if (!bitrixSync?.attempted || bitrixSync?.sent) return;

  const error = new Error(`Bitrix-Sendung fehlgeschlagen: ${bitrixSync.error || 'Unbekannter Fehler'}`);
  error.status = 502;
  error.bitrixSync = bitrixSync;
  throw error;
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

function buildSuccessResponse(form) {
  return {
    success: true,
    id: form._id,
    shareToken: form.shareToken,
    shareLink: `/form/${form.shareToken}`,
    data: form,
  };
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
      message: `Bitrix-Timeline-Upload als ein Kommentar fehlgeschlagen (${formatDuration(Date.now() - timelineStartedAt)}): ${singleTimelineEntry.error}. Fallback mit mehreren Kommentaren startet.`,
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

  const [finishedTimelineEntries, finishedDealEntry] = await Promise.all([timelinePromise, dealPromise]);
  requests.push(...finishedTimelineEntries);
  if (finishedDealEntry) requests.push(finishedDealEntry);

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
    await addOperationLog({
      event: 'draft.save.received',
      message: 'Entwurf-Speicherung empfangen.',
      context: logContext,
    });

    const payload = mergeUploadedFiles(pickPayload(parsed), req.files);
    const formId = parsed._id || parsed.id;
    await addOperationLog({
      event: 'draft.save.uploads_merged',
      message: 'Upload-Referenzen fuer Entwurf vorbereitet.',
      context: buildRequestLogContext(parsed, req.files, { formId }),
    });

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

    const result = await OperationLog.deleteMany({});

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

router.post('/admin/inspect', async (req, res) => {
  try {
    const password = req.body?.password;
    if (!isDevModePasswordValid(password)) {
      return res.status(403).json({ success: false, error: 'Passwort ungueltig' });
    }

    const id = String(req.body?.id || '').trim();
    if (!id) return res.status(400).json({ success: false, error: 'ID fehlt' });

    const rawEntityId = req.body?.entityId;
    const entityId = Number(rawEntityId);
    if (!Number.isFinite(entityId) || entityId <= 0) {
      return res.status(400).json({ success: false, error: 'Bitrix-Auftrag-ID fehlt oder ungültig' });
    }

    const { form, source } = await findAdminForm(id);
    if (!form) return res.status(404).json({ success: false, error: 'Formular nicht gefunden' });

    const storedEntityId = Number(form.bitrixAuftragId || 0);
    if (storedEntityId !== entityId) {
      return res.status(400).json({
        success: false,
        error: `Bitrix-Auftrag-ID stimmt nicht überein (gespeichert: ${storedEntityId || '—'}, eingegeben: ${entityId})`,
      });
    }

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
      form: {
        _id: String(form._id),
        customerName: buildCustomerName(form) || form.name || '—',
        bitrixAuftragId: storedEntityId,
        auftragsNummer: form.auftragsNummer || '',
        terminId: form.terminId || '',
      },
      categories: { bilder, video, pdfs: ADMIN_PDF_SPECS },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/admin/push', async (req, res) => {
  try {
    const password = req.body?.password;
    if (!isDevModePasswordValid(password)) {
      return res.status(403).json({ success: false, error: 'Passwort ungueltig' });
    }

    const id = String(req.body?.id || '').trim();
    if (!id) return res.status(400).json({ success: false, error: 'ID fehlt' });

    const entityId = Number(req.body?.entityId);
    if (!Number.isFinite(entityId) || entityId <= 0) {
      return res.status(400).json({ success: false, error: 'Bitrix-Auftrag-ID fehlt oder ungültig' });
    }

    const selectedFiles = Array.isArray(req.body?.files) ? req.body.files : [];
    const selectedPdfKeys = Array.isArray(req.body?.pdfKeys) ? req.body.pdfKeys : [];

    if (!selectedFiles.length && !selectedPdfKeys.length) {
      return res.status(400).json({ success: false, error: 'Keine Dateien oder PDFs ausgewählt' });
    }

    const { form, source } = await findAdminForm(id);
    if (!form) return res.status(404).json({ success: false, error: 'Formular nicht gefunden' });

    const storedEntityId = Number(form.bitrixAuftragId || 0);
    if (storedEntityId !== entityId) {
      return res.status(400).json({
        success: false,
        error: `Bitrix-Auftrag-ID stimmt nicht überein (gespeichert: ${storedEntityId || '—'})`,
      });
    }

    const context = { id, source, entityId };
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
    await addOperationLog({
      event: allOk ? 'admin.bitrix.push.succeeded' : 'admin.bitrix.push.partial',
      message: `Admin-Push ${allOk ? 'erfolgreich' : 'teilweise fehlgeschlagen'} (${attachments.length} Anhänge, ${timelineResults.length} Kommentar(e)).`,
      context: { ...context, attachmentCount: attachments.length, skippedCount: skippedFiles.length, optimizedCount: optimizedFiles.length, timelineResults },
    });

    return res.json({ success: allOk, entityId, attachmentCount: attachments.length, skippedFiles, optimizedFiles, timelineResults });
  } catch (error) {
    await addOperationLog({ level: 'error', event: 'admin.bitrix.push.failed', message: error.message, context: { id: req.body?.id, entityId: req.body?.entityId } });
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/client-log', async (req, res) => {
  try {
    const payload = req.body || {};
    const event = String(payload.event || '');
    const allowedEvents = new Set([
      'client.validation.blocked',
      'client.error',
      'client.unhandled_rejection',
    ]);

    if (!allowedEvents.has(event)) {
      return res.status(400).json({ success: false, error: 'Log event not allowed' });
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
      },
    });

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
    logContext = buildRequestLogContext(parsed, req.files);
    await addOperationLog({
      event: 'submit.received',
      message: 'Absenden empfangen. Zuerst wird ein Recovery-Entwurf gespeichert.',
      context: logContext,
    });

    const payload = mergeUploadedFiles(pickPayload(parsed), req.files);
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

    await addOperationLog({
      event: 'submit.bitrix.started',
      message: 'Bitrix-Sendung gestartet. MongoDB-Transaktion ist dabei nicht offen.',
      context: logContext,
    });
    const bitrixSync = await trySendDocumentToBitrix(bitrixPayload, {
      onProgress: progress => addOperationLog({
        level: progress.level || 'info',
        event: progress.event,
        message: progress.message,
        context: {
          ...logContext,
          ...(progress.context || {}),
        },
      }),
    });
    try {
      assertBitrixSubmitSucceeded(bitrixSync);
    } catch (error) {
      await addOperationLog({
        level: 'error',
        event: 'submit.bitrix.failed',
        message: error.message,
        context: {
          ...logContext,
          bitrixSync,
        },
      });
      throw error;
    }
    await addOperationLog({
      event: 'submit.bitrix.succeeded',
      message: 'Bitrix hat die Dokumente akzeptiert. Danach startet die kurze MongoDB-Transaktion.',
      context: {
        ...logContext,
        bitrixAttempted: bitrixSync.attempted,
        bitrixSent: bitrixSync.sent,
      },
    });
    await addOperationLog({
      level: 'warn',
      event: 'submit.edge.bitrix_sent_before_mongo_commit',
      message: 'Bitrix ist erfolgreich, die finale MongoDB-Transaktion ist noch nicht abgeschlossen. Falls der Server genau jetzt stoppt, bleibt der Entwurf bestehen und Bitrix kann beim erneuten Versuch doppelte Dokumente erhalten.',
      context: logContext,
    });

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
            bitrixSync,
          },
          submittedId: submitted._id,
        };
      }

      const submitPayload = {
        ...draftData,
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
          bitrixSync,
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
    return res.status(submitResult.statusCode).json(submitResult.response);
  } catch (error) {
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
    if (error?.bitrixSync) response.bitrixSync = error.bitrixSync;

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
        bitrixSync: error?.bitrixSync,
      },
    });
    return res.status(error?.status || error?.statusCode || 400).json(response);
  }
});

module.exports = router;
