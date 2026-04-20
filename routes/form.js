const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');

const Abnahme = require('../models/Abnahme');
const Entwurf = require('../models/Entwurf');
const { buildDocumentPackage } = require('../services/documentLetter');
const { postTimelineComment, updateDealFields } = require('../services/bitrix');
const { buildStepDocumentAttachments } = require('../services/stepDocuments');

const router = express.Router();
const uploadsDir = path.join(__dirname, '..', 'uploads');

fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
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

function mergeUploadedFiles(payload, files = []) {
  const groupedFiles = files.reduce((acc, file) => {
    if (!acc[file.fieldname]) acc[file.fieldname] = [];
    acc[file.fieldname].push(`/uploads/${file.filename}`);
    return acc;
  }, {});

  Object.entries(groupedFiles).forEach(([fieldName, urls]) => {
    payload[fieldName] = urls.length === 1 ? urls[0] : urls;
  });

  return payload;
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

const DEAL_FIELD_DOC_MAP = {
  '02-warenpruefung':                   'UF_CRM_1764230457968',
  '05-abschluss-und-unterschrift':      'UF_CRM_1764760728724',
  '06-checkliste':                      'UF_CRM_1764319514136',
  '07-bestaetigung-erfolgreicher-umbau': 'UF_CRM_1741678496329',
};

function findAttachmentForDealField(attachments, prefix) {
  return attachments.find(att => att.filename.startsWith(prefix));
}

async function trySendDocumentToBitrix(data = {}) {
  const entityId = Number(data.bitrixAuftragId || 0);

  if (!Number.isFinite(entityId) || entityId <= 0) {
    return { attempted: false, sent: false };
  }

  const document = buildDocumentPackage(data);
  const comment = [document.title, '', document.text].join('\n');
  const attachments = await buildStepDocumentAttachments(data, {
    includeDebug: String(data.debugMode || '').toLowerCase() === 'true',
  });

  try {
    await postTimelineComment({
      entityType: 'deal',
      entityId,
      comment,
      attachments,
    });

    // Upload PDFs to deal custom fields
    const dealFields = {};
    for (const [prefix, fieldName] of Object.entries(DEAL_FIELD_DOC_MAP)) {
      const att = findAttachmentForDealField(attachments, prefix);
      if (att) {
        dealFields[fieldName] = { fileData: [att.filename, att.base64] };
      }
    }

    if (Object.keys(dealFields).length) {
      try {
        await updateDealFields({ dealId: entityId, fields: dealFields });
      } catch (_err) {
        // Deal field update is best-effort; don't fail the whole submission
      }
    }

    return {
      attempted: true,
      sent: true,
      entityId,
    };
  } catch (error) {
    return {
      attempted: true,
      sent: false,
      entityId,
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
  try {
    const parsed = parsePayload(req);
    const payload = mergeUploadedFiles(pickPayload(parsed), req.files);
    const formId = parsed._id || parsed.id;

    if (formId) {
      const existing = await Entwurf.findById(formId);

      if (!existing) {
        return res.status(404).json({ success: false, error: 'Formular nicht gefunden' });
      }

      Object.assign(existing, payload);
      await existing.save();

      return res.json(buildSuccessResponse(existing));
    }

    const form = await Entwurf.create({
      ...payload,
      shareToken: createShareToken(),
      status: 'draft',
    });

    return res.status(201).json(buildSuccessResponse(form));
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
  try {
    const parsed = parsePayload(req);
    const payload = mergeUploadedFiles(pickPayload(parsed), req.files);
    const formId = parsed._id || parsed.id;
    let response;

    if (!formId) {
      const form = await Abnahme.create({
        ...payload,
        shareToken: createShareToken(),
        status: 'submitted',
      });

      response = buildSuccessResponse(form);
      const bitrixSync = await trySendDocumentToBitrix({ ...parsed, ...payload, ...form.toObject?.() });
      return res.status(201).json({
        ...response,
        bitrixSync,
      });
    }

    const draft = await Entwurf.findById(formId);

    if (draft) {
      const submitted = await Abnahme.create({
        ...sanitizeDocumentForCreate(draft.toObject()),
        ...payload,
        shareToken: draft.shareToken || createShareToken(),
        status: 'submitted',
      });

      await draft.deleteOne();

      response = buildSuccessResponse(submitted);
      const bitrixSync = await trySendDocumentToBitrix({
        ...sanitizeDocumentForCreate(draft.toObject()),
        ...parsed,
        ...payload,
        ...submitted.toObject?.(),
      });
      return res.json({
        ...response,
        bitrixSync,
      });
    }

    const form = await Abnahme.findById(formId);

    if (!form) {
      return res.status(404).json({ success: false, error: 'Formular nicht gefunden' });
    }

    Object.assign(form, payload, { status: 'submitted' });
    await form.save();

    response = buildSuccessResponse(form);
    const bitrixSync = await trySendDocumentToBitrix({
      ...parsed,
      ...payload,
      ...form.toObject?.(),
    });

    return res.json({
      ...response,
      bitrixSync,
    });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

module.exports = router;
