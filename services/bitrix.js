const BITRIX_WEBHOOK_BASE = () => process.env.BITRIX_WEBHOOK_BASE || '';

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
  const webhookBase = BITRIX_WEBHOOK_BASE();
  if (!webhookBase) {
    throw new Error('BITRIX_WEBHOOK_BASE is not configured.');
  }

  const qs = buildQS(paramsObj);
  const url = `${webhookBase}/${method}.json${qs ? `?${qs}` : ''}`;
  const response = await fetch(url, { method: 'GET' });
  const data = await response.json().catch(() => null);

  if (!data) throw new Error('Invalid JSON response from Bitrix');
  if (data.error) throw new Error(data.error_description || data.error);

  return data;
}

async function bxPost(method, body = {}) {
  const webhookBase = BITRIX_WEBHOOK_BASE();
  if (!webhookBase) {
    throw new Error('BITRIX_WEBHOOK_BASE is not configured.');
  }

  const url = `${webhookBase}/${method}.json`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);

  if (!data) throw new Error('Invalid JSON response from Bitrix');
  if (data.error) throw new Error(data.error_description || data.error);

  return data;
}

function postTimelineComment({ entityType, entityId, comment, attachments = [] }) {
  const fields = {
    ENTITY_ID: entityId,
    ENTITY_TYPE: entityType,
    COMMENT: comment,
  };

  if (attachments.length) {
    fields.FILES = attachments.map(att => [
      att.filename,
      att.base64,
    ]);
  }

  return bxPost('crm.timeline.comment.add', { fields });
}

function updateDealFields({ dealId, fields }) {
  return bxPost('crm.item.update', {
    entityTypeId: 2,
    id: dealId,
    fields,
    useOriginalUfNames: 'Y',
  });
}

module.exports = {
  buildQS,
  bxGet,
  bxPost,
  postTimelineComment,
  updateDealFields,
};
