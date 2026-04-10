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

function postTimelineComment({ entityType, entityId, comment }) {
  return bxGet('crm.timeline.comment.add', {
    fields: {
      ENTITY_ID: entityId,
      ENTITY_TYPE: entityType,
      COMMENT: comment,
    },
  });
}

module.exports = {
  buildQS,
  bxGet,
  postTimelineComment,
};
