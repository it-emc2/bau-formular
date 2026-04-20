# Architecture

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Browser (SPA)                         │
│  public/index.html + public/app.js + public/style.css   │
│  SignaturePad (CDN)                                      │
└─────────────────────────┬────────────────────────────────┘
                          │ HTTP (JSON + FormData)
                          ▼
┌──────────────────────────────────────────────────────────┐
│                Express.js Server                         │
│  server.js                                               │
│  ├── Middleware: Helmet, CORS, JSON/URL body parsing     │
│  ├── Static: /public, /uploads                           │
│  ├── /api/form/*   → routes/form.js                      │
│  ├── /api/bitrix/* → routes/bitrix.js                    │
│  └── SPA fallback  → index.html                          │
└────────┬──────────────┬───────────────┬──────────────────┘
         │              │               │
         ▼              ▼               ▼
    ┌─────────┐   ┌──────────┐   ┌──────────────┐
    │ MongoDB │   │ Bitrix24 │   │ Angebots-    │
    │ Atlas   │   │ CRM      │   │ konfigurator │
    │         │   │ (Webhook)│   │ (External)   │
    └─────────┘   └──────────┘   └──────────────┘
```

## Directory Structure

```
bau-formular/
├── server.js                 # Express app entry point, middleware, MongoDB connect
├── routes/
│   ├── form.js               # Form CRUD, document gen, email, Bitrix sync (470 lines)
│   └── bitrix.js             # Bitrix CRM proxy endpoints (151 lines)
├── models/
│   ├── Abnahme.js            # Mongoose schema for submitted forms (132 lines)
│   └── Entwurf.js            # Reuses Abnahme schema, different collection (6 lines)
├── services/
│   ├── bitrix.js             # Low-level Bitrix webhook client (54 lines)
│   ├── documentLetter.js     # HTML/Word confirmation letter generation (270 lines)
│   └── stepDocuments.js      # PDF generation for step-by-step inspection docs (359 lines)
├── public/
│   ├── index.html            # SPA shell with all form sections (800 lines)
│   ├── app.js                # Frontend controller (2582 lines)
│   ├── style.css             # All styling (1200+ lines)
│   └── emc2-logo.png         # Brand logo
├── __tests__/                # Jest test suite
│   ├── server.test.js
│   ├── routes.form.test.js
│   ├── routes.bitrix.test.js
│   ├── abnahme.model.test.js
│   └── stepDocuments.test.js
├── scripts/
│   └── run-jest.js           # Jest runner wrapper
├── uploads/                  # File upload storage (gitignored content)
├── templates/                # Empty/unused
├── Dockerfile                # Multi-stage Node.js 24.11.1-slim build
├── fly.toml                  # Fly.io config (fra region, 1 CPU, 1GB RAM)
├── .github/workflows/
│   └── fly-deploy.yml        # Auto-deploy on push to main
├── jest.config.js
├── package.json
└── .env                      # Environment variables (not committed)
```

## Request Flow

### Form Save (Draft)
```
Client: POST /api/form/save (FormData with JSON + files)
  → Multer parses file uploads → saves to /uploads/
  → parsePayload() extracts form data from JSON string
  → mergeUploadedFiles() adds file URLs to payload
  → If formId exists: update existing Entwurf document
  → If no formId: create new Entwurf with shareToken
  → Response: { success, id, shareToken, shareLink, data }
```

### Form Submit
```
Client: POST /api/form/submit (FormData with JSON + files)
  → Same file + payload parsing as save
  → If no formId: create new Abnahme (status: submitted)
  → If formId matches draft: create Abnahme from draft data, delete draft
  → If formId matches Abnahme: update existing Abnahme
  → trySendDocumentToBitrix() — if bitrixAuftragId is set:
    → buildDocumentPackage() generates letter text
    → buildStepDocumentAttachments() generates PDFs for each step
    → postTimelineComment() sends to Bitrix
  → Response: { success, id, shareToken, data, bitrixSync }
```

### Bitrix Contact Lookup
```
Client: GET /api/bitrix/contact/:id
  → bxGet('crm.contact.get', { id })
  → If no address on contact:
    → getRequisiteIdForContact() → find requisite
    → getAddressForRequisite() → get address from requisite
    → patchContactAddressFromReq() → merge into contact
  → Response: Bitrix contact object with resolved address
```

## Module Dependency Graph

```
server.js
  ├── routes/form.js
  │     ├── models/Abnahme.js
  │     ├── models/Entwurf.js (→ imports createAbnahmeSchema from Abnahme)
  │     ├── services/documentLetter.js
  │     ├── services/bitrix.js
  │     └── services/stepDocuments.js
  └── routes/bitrix.js
        └── services/bitrix.js
```

## Frontend Architecture

The frontend is a single IIFE (Immediately Invoked Function Expression) in `public/app.js`. All state is module-scoped variables. There is no component system, virtual DOM, or state management library.

### Initialization Flow
```
DOMContentLoaded
  → init()
    → syncDemoPresetSelection()
    → bindNavigation()
    → bindFormularTypeSelection()
    → bindDirtyTracking()
    → bindFileUploads()
    → bindConditionalFields()
    → bindAuftragsNrSync()
    → bindConfirmationLetterSync()
    → bindAdditionalServicesConfirmationSync()
    → bindBitrixAutofill()
    → bindDraftLookup()
    → bindArbeitsberichtLookup()
    → bindDocumentActions()
    → bindChecklistRules()
    → initSignaturePads()
    → initDevModeToggle()
    → bindDemoPresetSelection()
    → loadDraftIfNeeded() — checks URL for /form/:token
    → OR detect form type from route, show step 1
    → fetchBitrixDeals()
    → fetchDrafts()
```

### DOM Querying Convention
```javascript
const $  = (s, p = document) => p.querySelector(s);
const $$ = (s, p = document) => [...p.querySelectorAll(s)];
```
All DOM references are cached at the top of the IIFE. Form steps are `<section>` elements with `data-step="N"` attributes. Visibility is controlled by toggling the `active` and `hidden` CSS classes.

### Form Data Collection
`collectFormData()` walks the DOM to build a plain object:
- Text/number/date/email inputs and selects → direct values
- Nested fields (e.g., `adresse.strasse`) → nested objects
- Radio buttons → checked value
- Checkboxes → boolean
- Signatures → base64 PNG data URLs from SignaturePad
- Timestamps → ISO strings for signature timestamps

### File Upload System
- `fileStore` object: `{ fieldName: File[] }`
- Files are kept in memory until save/submit
- On save/submit, files are sent as FormData alongside JSON form data
- Drag & drop, file picker, and camera capture all funnel into `addFiles()`
- Camera uses `getUserMedia` API with a modal overlay
