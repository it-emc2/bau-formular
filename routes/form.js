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
const { buildDocumentPackage } = require('../services/documentLetter');
const { postTimelineComment, updateDealFields } = require('../services/bitrix');
const { buildStepDocumentAttachments } = require('../services/stepDocuments');
const { getUploadsDir } = require('../services/uploadsPath');
const { cleanupOrphanUploads } = require('../services/orphanUploads');
const { addOperationLog, listOperationLogs } = require('../services/operationLogs');

const router = express.Router();
const uploadsDir = getUploadsDir();
const SINGLE_UPLOAD_FIELDS = new Set(['videoDesAblaufs']);
const MAX_MONGO_DOCUMENT_BYTES = 15 * 1024 * 1024;

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
  return {
    terminId: parsed.terminId,
    bitrixAuftragId: parsed.bitrixAuftragId,
    auftragsNummer: parsed.auftragsNummer,
    formId: parsed._id || parsed.id,
    uploadCount: files?.length || 0,
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

  const comment = [document.title, '', document.text].join('\n');
  stepStartedAt = Date.now();
  const attachments = await buildStepDocumentAttachments(data, {
    includeDebug: String(data.debugMode || '').toLowerCase() === 'true',
  });
  await onProgress({
    event: 'submit.bitrix.attachments.built',
    message: `${attachments.length} Bitrix-PDF-Anhaenge vorbereitet (${formatDuration(Date.now() - stepStartedAt)}).`,
    context: {
      durationMs: Date.now() - stepStartedAt,
      attachmentCount: attachments.length,
      attachmentSummary: buildAttachmentSummary(attachments),
    },
  });

  const requests = [];
  const timelineEntry = buildTimelineRequestEntry({ entityId, comment, attachments });

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
      message: `Bitrix-Timeline-Upload gestartet (${attachments.length} Anhaenge).`,
      context: { attachmentCount: attachments.length },
    });
    try {
      timelineEntry.response = await postTimelineComment({
        entityType: 'deal',
        entityId,
        comment,
        attachments,
      });
      timelineEntry.ok = true;
    } catch (err) {
      timelineEntry.ok = false;
      timelineEntry.error = err.message;
    }
    await onProgress({
      level: timelineEntry.ok ? 'info' : 'error',
      event: timelineEntry.ok ? 'submit.bitrix.timeline.succeeded' : 'submit.bitrix.timeline.failed',
      message: timelineEntry.ok
        ? `Bitrix-Timeline-Upload abgeschlossen (${formatDuration(Date.now() - timelineStartedAt)}).`
        : `Bitrix-Timeline-Upload fehlgeschlagen (${formatDuration(Date.now() - timelineStartedAt)}): ${timelineEntry.error}`,
      context: {
        durationMs: Date.now() - timelineStartedAt,
        attachmentCount: attachments.length,
        error: timelineEntry.error,
      },
    });
    return timelineEntry;
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

  const [finishedTimelineEntry, finishedDealEntry] = await Promise.all([timelinePromise, dealPromise]);
  requests.push(finishedTimelineEntry);
  if (finishedDealEntry) requests.push(finishedDealEntry);

  const sent = Boolean(timelineEntry.ok);
  const failed = requests.find(entry => !entry.ok);

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

router.post('/save', upload.any(), async (req, res) => {
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
    const attachments = await buildStepDocumentAttachments(parsed, {
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

router.post('/debug-bitrix-payload', upload.any(), async (req, res) => {
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
    const attachments = await buildStepDocumentAttachments(parsed, { includeDebug: true, forceAll: true });
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

router.post('/submit', upload.any(), async (req, res) => {
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
