const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');

const Abnahme = require('../models/Abnahme');

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
  if (req.body?.formData) {
    return JSON.parse(req.body.formData);
  }

  return { ...req.body };
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

router.get('/health', (_req, res) => {
  res.json({ ok: true });
});

router.post('/save', upload.any(), async (req, res) => {
  try {
    const parsed = parsePayload(req);
    const payload = mergeUploadedFiles(pickPayload(parsed), req.files);
    const formId = parsed._id || parsed.id;

    if (formId) {
      const existing = await Abnahme.findById(formId);

      if (!existing) {
        return res.status(404).json({ success: false, error: 'Formular nicht gefunden' });
      }

      Object.assign(existing, payload);
      await existing.save();

      return res.json(buildSuccessResponse(existing));
    }

    const form = await Abnahme.create({
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
    const form = await Abnahme.findOne({ shareToken: req.params.token });

    if (!form) {
      return res.status(404).json({ success: false, error: 'Formular nicht gefunden' });
    }

    return res.json({ success: true, data: form });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

router.post('/submit', upload.any(), async (req, res) => {
  try {
    const parsed = parsePayload(req);
    const payload = mergeUploadedFiles(pickPayload(parsed), req.files);
    const formId = parsed._id || parsed.id;

    if (!formId) {
      return res.status(400).json({ success: false, error: 'Formular-ID fehlt' });
    }

    const form = await Abnahme.findById(formId);

    if (!form) {
      return res.status(404).json({ success: false, error: 'Formular nicht gefunden' });
    }

    Object.assign(form, payload, { status: 'submitted' });
    await form.save();

    return res.json(buildSuccessResponse(form));
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
});

module.exports = router;
