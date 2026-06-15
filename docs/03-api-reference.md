# API Reference

All API endpoints return JSON. Error responses follow the format `{ success: false, error: "message" }`. Some validation, upload, and parsing failures also include a `details` array with field-level diagnostics:

```json
{
  "success": false,
  "error": "Abnahme validation failed: terminId: Path `terminId` is required.",
  "details": [
    {
      "field": "terminId",
      "kind": "required",
      "message": "Path `terminId` is required."
    }
  ]
}
```

## Form Routes (`/api/form`)

### GET /api/form/health

Health check endpoint.

**Response:**
```json
{ "ok": true }
```

---

### GET /api/form/drafts

List draft forms, optionally filtered by search query.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `q` | string | Search term (searches terminId, kundennummer, auftragsNummer, vorname, nachname, name) |

**Response:**
```json
{
  "success": true,
  "drafts": [
    {
      "_id": "665...",
      "shareToken": "abc123...",
      "terminId": "UT-12345",
      "kundennummer": "1001",
      "auftragsNummer": "A-AN-001",
      "vorname": "Max",
      "nachname": "Mustermann",
      "name": "Max Mustermann",
      "status": "draft",
      "updatedAt": "2026-04-20T10:00:00.000Z"
    }
  ]
}
```

Notes:
- Returns max 20 drafts, sorted by `updatedAt` descending
- Search uses case-insensitive regex matching
- Only returns drafts (status: 'draft')

---

### GET /api/form/drafts/:id

Get a single draft by MongoDB `_id`.

**Response:**
```json
{
  "success": true,
  "data": { /* full Entwurf document */ }
}
```

**Errors:**
- `404` — Draft not found

---

### POST /api/form/save

Save or update a draft form. Accepts `multipart/form-data` for file uploads.

**Request Body (FormData):**
| Field | Type | Description |
|-------|------|-------------|
| `formData` | JSON string | Serialized form data object |
| `[fieldName]` | File(s) | Uploaded files keyed by field name |

**Behavior:**
- If `formData` contains `_id` or `id`: updates existing draft
- If `_id`/`id` belongs to an already submitted form: creates a new draft copy with a fresh `shareToken`
- Otherwise: creates new draft with generated `shareToken`
- Uploaded files are saved to the configured uploads directory and exposed as `/uploads/...` URLs merged into the payload

**Response:**
```json
{
  "success": true,
  "id": "665...",
  "shareToken": "abc123...",
  "shareLink": "/form/abc123...",
  "data": { /* full Entwurf document */ }
}
```

---

### POST /api/form/submit

Submit a form (final). Accepts `multipart/form-data`.

**Request Body:** Same as `/save`

**Behavior:**
1. Saves/updates a recovery draft first.
2. Attempts Bitrix sync outside any MongoDB transaction.
3. If Bitrix fails, keeps the recovery draft and returns an error with the draft id/share link.
4. If Bitrix succeeds, opens a short MongoDB transaction to create/update the Abnahme and delete the recovery draft.

**Response:**
```json
{
  "success": true,
  "id": "665...",
  "shareToken": "abc123...",
  "shareLink": "/form/abc123...",
  "data": { /* full Abnahme document */ },
  "bitrixSync": {
    "attempted": true,
    "sent": true,
    "entityId": 12345
  }
}
```

**bitrixSync states:**
- `{ attempted: false, sent: false }` — no bitrixAuftragId provided
- `{ attempted: true, sent: true, entityId }` — successfully posted to Bitrix
- `{ attempted: true, sent: false, entityId, error }` — Bitrix posting failed; the recovery draft remains available

---

### GET /api/form/token/:token

Load a form (draft or submitted) by its share token.

**Response:**
```json
{
  "success": true,
  "data": { /* Entwurf or Abnahme document */ }
}
```

Notes:
- Searches Entwurf collection first, then Abnahme
- Returns `404` if no form found with that token

---

### POST /api/form/document/render

Generate a confirmation letter document from form data.

**Request Body:**
```json
{
  "formData": { /* form data object */ }
}
```

**Response:**
```json
{
  "success": true,
  "document": {
    "title": "Bestaetigung erfolgreicher Umbau",
    "subject": "Bestaetigung Umbau A-AN-001",
    "fileName": "bestaetigung-max-mustermann.doc",
    "html": "<!DOCTYPE html>...",
    "text": "Max Mustermann\nMusterstraße 42\n..."
  }
}
```

---

### POST /api/form/document/email

Send the confirmation letter via email.

**Request Body:**
```json
{
  "to": "kunde@example.com",
  "subject": "Optional custom subject",
  "formData": { /* form data object */ }
}
```

**Response (SMTP configured):**
```json
{
  "success": true,
  "delivery": "smtp",
  "document": { /* same as render */ }
}
```

**Response (SMTP not configured):**
```json
{
  "success": true,
  "delivery": "mailto",
  "mailtoUrl": "mailto:kunde%40example.com?subject=...",
  "document": { /* same as render */ }
}
```

---

### POST /api/form/document/bitrix

Post confirmation letter as a timeline comment to a Bitrix deal.

**Request Body:**
```json
{
  "entityId": 12345,
  "formData": { /* form data object */ }
}
```

**Response:**
```json
{
  "success": true,
  "result": { /* Bitrix API response */ },
  "document": { /* same as render */ }
}
```

Notes:
- Also generates and attaches step-by-step PDF documents
- If `debugMode` is `"true"` in form data, includes additional debug documents (Mängelbeseitigung, Nachbesserung)

---

### POST /api/form/arbeitsbericht/pdf

Proxy endpoint for generating work report PDFs from the external Angebotskonfigurator service.

**Request Body:**
```json
{ /* payload passed through to external service */ }
```

**Response:** Binary PDF with appropriate Content-Type and Content-Disposition headers.

---

---

## Admin Routes (`/api/form/admin`)

All admin endpoints require a `password` field in the request body (verified against `TESTMODUS_PASSWORD` env var).

---

### POST /api/form/admin/inspect

Look up a form by Bitrix Auftrag ID and return its file categories for selection.

**Request Body:**
```json
{
  "password": "...",
  "entityId": 12345
}
```

**Behavior:**
- Searches `Abnahme` collection first (most recent match), then `Entwurf`
- Queries by `bitrixAuftragId` field (matches both numeric and string-stored values)
- Returns file metadata with disk-existence flags for each file

**Response:**
```json
{
  "success": true,
  "source": "abnahme",
  "multipleCount": 1,
  "form": {
    "_id": "665...",
    "customerName": "Max Mustermann",
    "bitrixAuftragId": 12345,
    "auftragsNummer": "A-AN-001",
    "terminId": "UT-12345"
  },
  "categories": {
    "bilder": [
      { "field": "bilderFertigerUmbau", "filename": "1234-abc-foto.jpg", "label": "Bilder fertiger Umbau", "exists": true }
    ],
    "video": [
      { "field": "videoDesAblaufs", "filename": "1234-abc-video.webm", "exists": true }
    ],
    "pdfs": [ /* ADMIN_PDF_SPECS — 8 PDF definitions */ ]
  }
}
```

Notes:
- `multipleCount > 1` means multiple documents share this Bitrix ID; the most recent was used
- `exists: false` means the file reference is in MongoDB but the file is missing from the volume

**Errors:**
- `403` — Invalid password
- `400` — Missing or invalid `entityId`
- `404` — No document found with that Bitrix Auftrag ID

---

### POST /api/form/admin/push

Compress and upload selected files/PDFs to a Bitrix deal timeline.

**Request Body:**
```json
{
  "password": "...",
  "entityId": 12345,
  "files": [
    { "field": "bilderFertigerUmbau", "filename": "1234-abc-foto.jpg" }
  ],
  "pdfKeys": ["01-abschluss-der-baustelle", "05-abschluss-und-unterschrift"]
}
```

**Behavior:**
- Looks up the form by `entityId` (same logic as `/admin/inspect`)
- Images: re-compressed via sharp before sending (unless already compressed in the same process session)
- Videos: always re-encoded via ffmpeg (1280×720, CRF30) from the original on the volume
- PDFs: generated fresh from form data in MongoDB
- Tries a single timeline comment first; falls back to ≤8 MB batches on failure

**Response:**
```json
{
  "success": true,
  "entityId": 12345,
  "attachmentCount": 5,
  "skippedFiles": [],
  "optimizedFiles": [
    { "filename": "1234-abc-video.webm", "originalSizeKB": 45000, "optimizedSizeKB": 12000, "kind": "video" }
  ],
  "timelineResults": [
    { "ok": true, "mode": "single", "attachmentCount": 5 }
  ]
}
```

**Errors:**
- `403` — Invalid password
- `400` — Missing/invalid `entityId`, no files selected, or no attachments could be prepared
- `404` — No document found with that Bitrix Auftrag ID

---

### POST /api/form/admin/submitted/:id/bitrix/video

Re-push the `videoDesAblaufs` from an already-submitted `Abnahme` to its Bitrix deal timeline as a separate comment. Useful when a video was skipped during the original submission (e.g. ffmpeg was not available at that time).

**URL Parameters:**
| Parameter | Description |
|-----------|-------------|
| `id` | MongoDB `_id` of the `Abnahme` |

**Request Body:**
```json
{
  "password": "...",
  "entityId": 12345,
  "comment": "Optional custom comment text"
}
```

`entityId` is optional — falls back to `form.bitrixAuftragId` if not provided.

**Behavior:**
- Compresses the video via ffmpeg before uploading (same parameters as normal submit)
- Posts a single timeline comment with the compressed video as attachment
- Logs all stages to the operation log (`admin.bitrix.video.started`, `.succeeded`, `.failed`)

**Response:**
```json
{
  "success": true,
  "entityId": 12345,
  "attachment": { "filename": "01-videoDesAblaufs.mp4", "base64Length": 123456 },
  "optimizedFile": { "filename": "...", "originalSizeKB": 13000, "optimizedSizeKB": 180, "kind": "video" },
  "response": { /* Bitrix API response */ }
}
```

**Errors:**
- `403` — Invalid password
- `400` — No valid `entityId`, or video could not be compressed/prepared
- `404` — Abnahme not found, or no `videoDesAblaufs` stored in that document

---

### POST /api/form/admin/orphan-uploads

Find (or delete) upload files on disk that have no matching document in MongoDB.

**Request Body:**
```json
{ "password": "...", "delete": false }
```

Set `delete: true` to permanently remove orphaned files.

---

### POST /api/form/admin/logs

Return the last N operation log entries.

**Request Body:**
```json
{ "password": "...", "limit": 100 }
```

---

### POST /api/form/admin/logs/clear

Delete all operation log entries.

---

## Bitrix Routes (`/api/bitrix`)

### GET /api/bitrix/contact/:id

Fetch a Bitrix contact with address resolution.

**Behavior:**
1. Fetches contact via `crm.contact.get`
2. If contact has no address fields: looks up requisite → address chain
3. Patches address from requisite onto contact object

**Response:** Raw Bitrix API response with `result` containing the contact object, plus optional `__addressSource` field indicating where the address was resolved from.

---

### POST /api/bitrix/timeline/comment

Add a timeline comment to a Bitrix entity.

**Request Body:**
```json
{
  "entityType": "deal",
  "entityId": 12345,
  "comment": "Comment text here"
}
```

**Response:** Raw Bitrix API response.

---

### GET /api/bitrix/items/by-stage

List CRM items filtered by pipeline stage.

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `entityTypeId` | integer (required) | — | Bitrix entity type ID (2 = deal) |
| `stageId` | string | `C22:UC_T5EXSL` | Pipeline stage ID |
| `start` | integer | — | Pagination offset |
| `useOriginalUfNames` | string | `Y` | Whether to use original UF field names |
| `select` | string | `id,title,...` | Comma-separated list of fields to return |

**Response:** Raw Bitrix API response with `result.items` array.

---

## CORS Configuration

Allowed origins (default):
- `https://bau-formular.fly.dev`
- `https://angebotskonfigurator-emc2-v2.fly.dev`
- `http://localhost:3000`

Additional origins can be added via the `ALLOWED_ORIGINS` environment variable (comma-separated).

## Request Size Limits

- JSON body: 50 MB
- URL-encoded body: 50 MB
- Bitrix timeline comment: 1 MB (separate limit)
