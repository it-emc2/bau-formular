const express = require('express');

const router = express.Router();

const BITRIX_WEBHOOK_BASE = process.env.BITRIX_WEBHOOK_BASE || '';
const OWNER_TYPE = { contact: 3, company: 4 };
const DEFAULT_STAGE_ID = 'C22:UC_T5EXSL';

function isEmpty(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function buildQS(paramsObj) {
  const sp = new URLSearchParams();

  const add = (key, value) => {
    if (value !== undefined && value !== null) sp.append(key, String(value));
  };

  for (const [key, value] of Object.entries(paramsObj || {})) {
    if (Array.isArray(value)) {
      value.forEach(item => add(`${key}[]`, item));
    } else if (typeof value === 'object' && value !== null) {
      Object.entries(value).forEach(([nestedKey, nestedValue]) => add(`${key}[${nestedKey}]`, nestedValue));
    } else {
      add(key, value);
    }
  }

  return sp.toString();
}

async function bxGet(method, paramsObj = {}) {
  if (!BITRIX_WEBHOOK_BASE) {
    throw new Error('BITRIX_WEBHOOK_BASE is not configured.');
  }

  const qs = buildQS(paramsObj);
  const url = `${BITRIX_WEBHOOK_BASE}/${method}.json${qs ? `?${qs}` : ''}`;
  const response = await fetch(url, { method: 'GET' });
  const data = await response.json().catch(() => null);

  if (!data) throw new Error('Invalid JSON response from Bitrix');
  if (data.error) throw new Error(data.error_description || data.error);

  return data;
}

async function getRequisiteIdForContact(contactId) {
  const data = await bxGet('crm.requisite.list', {
    filter: { ENTITY_TYPE_ID: OWNER_TYPE.contact, ENTITY_ID: Number(contactId) },
    select: ['ID'],
    order: { ID: 'ASC' },
  });

  const arr = data.result;
  if (!Array.isArray(arr) || !arr.length) return null;
  return Number(arr[0].ID);
}

async function getAddressForRequisite(reqId) {
  const data = await bxGet('crm.address.list', {
    filter: { ENTITY_TYPE_ID: 8, ENTITY_ID: Number(reqId) },
    select: ['*'],
  });

  const arr = data.result;
  if (!Array.isArray(arr) || !arr.length) return null;
  return arr[0];
}

function patchContactAddressFromReq(contact, reqAddr) {
  const street = String(reqAddr?.ADDRESS_1 || '').trim();
  const zip = String(reqAddr?.POSTAL_CODE || '').trim();
  const city = String(reqAddr?.CITY || '').trim();

  if (street) contact.ADDRESS = street;
  if (zip) contact.ADDRESS_POSTAL_CODE = zip;
  if (city) contact.ADDRESS_CITY = city;

  return contact;
}

router.get('/contact/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ error: 'id is required' });

    const contactResp = await bxGet('crm.contact.get', { id });
    const contact = contactResp?.result;

    if (!contact) {
      return res.status(404).json({ error: 'Contact not found' });
    }

    const hasAnyAddress =
      !isEmpty(contact.ADDRESS) ||
      !isEmpty(contact.ADDRESS_CITY) ||
      !isEmpty(contact.ADDRESS_POSTAL_CODE);

    if (!hasAnyAddress) {
      const reqId = await getRequisiteIdForContact(contact.ID || id);
      if (reqId) {
        const reqAddr = await getAddressForRequisite(reqId);
        if (reqAddr) {
          patchContactAddressFromReq(contact, reqAddr);
          contactResp.__addressSource = `REQUISITE:${reqId}`;
        }
      }
    }

    return res.json(contactResp);
  } catch (err) {
    console.error('GET /api/bitrix/contact/:id error:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

router.post('/timeline/comment', express.json({ limit: '1mb' }), async (req, res) => {
  try {
    const entityType = String(req.body?.entityType || '').trim();
    const entityIdRaw = req.body?.entityId;
    const comment = String(req.body?.comment || '').trim();

    if (!entityType) return res.status(400).json({ error: 'entityType is required' });
    if (entityIdRaw === undefined || entityIdRaw === null || String(entityIdRaw).trim() === '') {
      return res.status(400).json({ error: 'entityId is required' });
    }
    if (!comment) return res.status(400).json({ error: 'comment is required' });

    const entityId = Number(entityIdRaw);
    if (!Number.isFinite(entityId) || entityId <= 0) {
      return res.status(400).json({ error: 'entityId must be a positive number' });
    }

    const data = await bxGet('crm.timeline.comment.add', {
      fields: {
        ENTITY_ID: entityId,
        ENTITY_TYPE: entityType,
        COMMENT: comment,
      },
    });

    return res.json(data);
  } catch (err) {
    console.error('POST /api/bitrix/timeline/comment error:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

router.get('/items/by-stage', async (req, res) => {
  try {
    const entityTypeId = Number(req.query.entityTypeId);
    const stageId = String(req.query.stageId || DEFAULT_STAGE_ID).trim();
    const start = req.query.start === undefined ? undefined : Number(req.query.start);
    const useOriginalUfNames = String(req.query.useOriginalUfNames || 'Y').trim().toUpperCase();
    const select = typeof req.query.select === 'string'
      ? req.query.select.split(',').map(field => field.trim()).filter(Boolean)
      : ['id', 'title', 'stageId', 'createdTime', 'assignedById'];

    if (!Number.isInteger(entityTypeId) || entityTypeId <= 0) {
      return res.status(400).json({ error: 'entityTypeId is required and must be a positive integer' });
    }

    if (!stageId) {
      return res.status(400).json({ error: 'stageId is required' });
    }

    if (start !== undefined && (!Number.isInteger(start) || start < 0)) {
      return res.status(400).json({ error: 'start must be a non-negative integer' });
    }

    const data = await bxGet('crm.item.list', {
      entityTypeId,
      select,
      filter: { STAGE_ID: stageId },
      order: { id: 'DESC' },
      start,
      useOriginalUfNames,
    });

    return res.json(data);
  } catch (err) {
    console.error('GET /api/bitrix/items/by-stage error:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  }
});

module.exports = router;
