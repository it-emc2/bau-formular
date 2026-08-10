const BITRIX_WEBHOOK_BASE = () => process.env.BITRIX_WEBHOOK_BASE || '';
const BITRIX_IM_WEBHOOK_BASE = () => process.env.BITRIX_IM_WEBHOOK_BASE || '';
const BITRIX_CHAT_ID = () => process.env.BITRIX_CHAT_ID || '';

const BITRIX_GET_TIMEOUT_MS = 30_000;
const BITRIX_POST_TIMEOUT_MS = 60_000;

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

  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(BITRIX_GET_TIMEOUT_MS),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`Bitrix GET Timeout nach ${BITRIX_GET_TIMEOUT_MS / 1000}s (${method})`);
    }
    throw new Error(`Bitrix GET Netzwerkfehler (${method}): ${err.message}`);
  }

  if (response.ok === false) {
    const errData = await response.json().catch(() => null);
    const errMsg = errData?.error_description || errData?.error || `HTTP ${response.status}`;
    throw new Error(`Bitrix GET fehlgeschlagen (${method}, HTTP ${response.status}): ${errMsg}`);
  }

  const data = await response.json().catch(() => null);
  if (!data) throw new Error(`Ungueltige JSON-Antwort von Bitrix (${method})`);
  if (data.error) throw new Error(data.error_description || data.error);

  return data;
}

async function bxPost(method, body = {}, webhookBase = BITRIX_WEBHOOK_BASE()) {
  if (!webhookBase) {
    throw new Error('BITRIX_WEBHOOK_BASE is not configured.');
  }

  const url = `${webhookBase}/${method}.json`;
  const bodyJson = JSON.stringify(body);
  const bodySizeKB = Math.round(bodyJson.length / 1024);

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyJson,
      signal: AbortSignal.timeout(BITRIX_POST_TIMEOUT_MS),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(`Bitrix POST Timeout nach ${BITRIX_POST_TIMEOUT_MS / 1000}s (${method}, Body ${bodySizeKB} KB)`);
    }
    throw new Error(`Bitrix POST Netzwerkfehler (${method}, Body ${bodySizeKB} KB): ${err.message}`);
  }

  if (response.ok === false) {
    const errData = await response.json().catch(() => null);
    const errMsg = errData?.error_description || errData?.error || `HTTP ${response.status}`;
    throw new Error(`Bitrix POST fehlgeschlagen (${method}, HTTP ${response.status}, Body ${bodySizeKB} KB): ${errMsg}`);
  }

  const data = await response.json().catch(() => null);
  if (!data) throw new Error(`Ungueltige JSON-Antwort von Bitrix (${method}, HTTP ${response.status})`);
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

function postChatMessage(message, { chatId = BITRIX_CHAT_ID() } = {}) {
  const imWebhookBase = BITRIX_IM_WEBHOOK_BASE();
  if (!imWebhookBase || !chatId) {
    throw new Error('BITRIX_IM_WEBHOOK_BASE oder BITRIX_CHAT_ID ist nicht konfiguriert.');
  }

  return bxPost('im.message.add', { DIALOG_ID: `chat${chatId}`, MESSAGE: message }, imWebhookBase);
}

module.exports = {
  buildQS,
  bxGet,
  bxPost,
  postTimelineComment,
  updateDealFields,
  postChatMessage,
};
