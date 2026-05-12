# Frontend Details

## SPA Architecture

The frontend is a **single-page application** built with vanilla JavaScript — no framework, no build step, no module bundler. The entire application logic lives in `public/app.js` (~2582 lines) wrapped in an IIFE to avoid global scope pollution.

### Files

| File | Size | Purpose |
|------|------|---------|
| `public/index.html` | ~800 lines | HTML structure with all form sections, modals, sidebar |
| `public/app.js` | ~2582 lines | All application logic, state management, API calls |
| `public/style.css` | ~1200 lines | All styling, responsive design, print styles |
| `public/emc2-logo.png` | — | Brand logo displayed in header |

### External Dependencies (CDN)

```html
<script src="https://cdn.jsdelivr.net/npm/signature_pad@4.2.0/dist/signature_pad.umd.min.js"></script>
```

This is the only external JavaScript dependency. SignaturePad provides touch/mouse-based signature drawing on `<canvas>` elements.

## State Management

All state is stored in module-scoped variables inside the IIFE. There is no reactive state system.

### Core State Variables

```javascript
let currentStep = 0;              // Current visible step number
let formId = null;                // MongoDB _id after first save
let shareToken = null;            // Unique share token for form URL
let fileStore = {};               // { fieldName: File[] } — files pending upload
let signaturePads = {};           // { fieldName: SignaturePad } — active pad instances
let devMode = false;              // Dev/test mode toggle
let currentFormularTyp = '';      // Selected form type
let hasUnsavedChanges = false;    // Dirty tracking flag
let suppressDirtyTracking = false; // Temporarily disable dirty tracking during programmatic changes
```

### Bitrix State

```javascript
let bitrixDeals = [];             // Fetched Bitrix deal items
let activeBitrixDealId = null;    // Currently selected deal
let bitrixSearchTerm = '';        // Search filter for deal list
```

### Draft State

```javascript
let drafts = [];                  // Fetched draft list
let activeDraftId = null;         // Currently loaded draft
let draftSearchTerm = '';         // Search filter for draft list
```

### Arbeitsbericht State

```javascript
let arbeitsberichtResults = [];   // Search results from external service
let activeArbeitsberichtSelection = null; // { kind, identifier }
let arbeitsberichtSearchTerm = '';
let arbeitsberichtPreviewUrl = null; // Blob URL for PDF preview
```

### Document State

```javascript
let documentPreviewUrl = null;    // Blob URL for letter HTML preview
let documentDownloadUrl = null;   // Blob URL for .doc download
let documentDownloadFilename = null;
```

### localStorage Keys

| Key | Type | Purpose |
|-----|------|---------|
| `bauFormularDemoPreset` | `"badumbau"/"badewannentuer"/"handlaeufe"` | Selected demo data preset |

## Client-Side Routing

The app uses simple path-based routing. The Express server serves `index.html` for all SPA routes:

```
/                              → Step 0 (type selector)
/home                          → Step 0 (type selector)
/AbschlussderBaustelle         → baustellenabnahme, jump to step 1
/BeauftragungzusatzlicheLeistungen → zusaetzliche_leistungen, jump to step 1
/Nachbesserung                 → nachbesserung, jump to step 1
/Schadensmeldung               → schadensmeldung, jump to step 1
/form/:token                   → Load form by share token
```

On init:
1. Check if URL is `/form/:token` → load draft/form by token
2. Check if URL matches a form type path → select that type, show step 1
3. Otherwise → show step 0 (type selector)

Form type selection updates the URL via `history.replaceState()` (not `pushState`), so browser back/forward does not navigate between form types.

## Form Data Collection

`collectFormData()` walks the DOM to build a serializable object:

```javascript
// Text inputs, numbers, dates, emails, selects, textareas
$$('input[type="text"], input[type="number"], ...', form).forEach(el => {
  // Handle dotted names like "adresse.strasse" → { adresse: { strasse: value } }
  if (el.name.includes('.')) { /* nested */ }
  else { data[el.name] = el.value; }
});

// Radio buttons → data[name] = checked value
// Checkboxes → data[name] = boolean
// Signatures → data[name] = base64 PNG data URL
// Timestamps → ISO string for signature timestamps
```

## Form Population

`populateForm(data)` reverses the collection process:
1. Sets `formularTyp` and applies type-specific UI
2. Splits legacy `name` field into anrede/vorname/nachname if needed
3. Populates all input fields from data object
4. Checks appropriate radio buttons and checkboxes
5. Draws base64 signatures onto SignaturePad canvases via Image → canvas draw
6. Renders existing file URLs as image/video thumbnails in upload previews
7. Triggers conditional field visibility updates

`suppressDirtyTracking` is set to `true` during population to prevent triggering the unsaved changes flag.

## File Upload System

### Upload Widgets

File upload areas are defined in HTML with data attributes:

```html
<div class="file-upload" data-name="bilderFertigerUmbau" data-multiple="true" data-accept="image/*">
  <div class="file-drop">...</div>
  <div class="file-preview"></div>
  <input type="file" accept="image/*" multiple hidden />
</div>
```

### Input Methods

1. **File picker**: Click the drop zone or upload button → opens native file dialog
2. **Drag & drop**: Drag files onto the drop zone
3. **Camera capture**: Opens device camera via `getUserMedia()` in a modal
4. **Video recording**: Records video via MediaRecorder API

### File Flow

```
User selects file(s)
  → addFiles(fieldName, files, previewEl, multi)
    → Stores File objects in fileStore[fieldName]
    → Creates thumbnail previews (img for images, video for videos)
    → Each thumbnail has a remove button

On save/submit:
  → collectFormData() returns JSON (no files)
  → saveForm() creates FormData:
    → fd.append('formData', JSON.stringify(data))
    → for each fieldName in fileStore:
        files.forEach(f => fd.append(fieldName, f))
  → POST /api/form/{save|submit} with FormData body
```

### Camera Modal

The camera modal (`#cameraModal`) provides:
- Photo mode: single frame capture from video stream → JPEG file
- Video mode: toggle recording via MediaRecorder → WebM file

Uses `navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })` to prefer the rear camera on mobile devices.

## Signature Pads

Signature canvases are initialized by `initSignaturePads()`:

```javascript
$$('.signature-wrapper').forEach(wrapper => {
  const pad = new SignaturePad(canvas, {
    backgroundColor: 'rgb(255,255,255)',
    penColor: 'rgb(0, 0, 0)',
  });
  signaturePads[wrapper.dataset.name] = pad;
});
```

Signatures are:
- Captured as strokes on `<canvas>` elements
- Exported as base64 PNG data URLs via `pad.toDataURL('image/png')`
- Stored in MongoDB as strings
- Embedded in PDFs and HTML documents as images

Canvas resizing handles device pixel ratio for sharp rendering on retina displays.

## Confirmation Letter Preview (Step 6)

Step 6 shows a live preview of the confirmation letter, dynamically updated as the user types. The preview mirrors the final generated document:

- Address block (name, street, city, PLZ)
- Date line (city, month/year)
- Formal letter body with dynamic measure type and order number
- Signature area

Updated by `updateConfirmationLetterPreview()`, which reads current form values and updates display elements via CSS class selectors (`.kunde-name-display`, `.adresse-strasse-display`, etc.).

## Toast Notifications

`showToast(msg, type)` displays a temporary notification:
- Types: `success`, `error`, or empty
- Auto-hides after 3.5 seconds
- Styled with CSS class `.toast.visible`

## Dev Mode Features

### Demo Data Prefill

`prefillDemoData()` fills the entire form with realistic test data:
- Customer: Max Mustermann, Musterstraße 42, 04109 Leipzig
- All text fields populated with preset-specific content
- All checkboxes checked
- All radio buttons selected
- Demo signatures drawn (zigzag pattern)
- Demo SVG image files and WebM video files created in memory

### Demo Presets

Three presets available via the sidebar dropdown:

| Preset | Label | Activity Value |
|--------|-------|---------------|
| `badumbau` | Badumbau | [HD] Badumbau |
| `badewannentuer` | Badewannentür | [HD] Badewannentüre |
| `handlaeufe` | Handläufe / Haltegriffe | [HD] Handläufe, [HD] Haltegriffe |

Each preset customizes: terminId, auftragsNummer, comments, checklist selections, image labels.

## Sidebar (Step 1)

The right sidebar on step 1 contains:

1. **Bitrix-Aufträge** (only in dev mode):
   - Search bar for filtering deals
   - Deal cards with customer name, ID, stage, amount, date
   - "In Formular laden" button to pre-fill form from deal
   - "Aktualisieren" button to refresh deal list

2. **Entwürfe** (only in dev mode):
   - Search bar for filtering drafts
   - Draft cards with customer name, termin-ID, update date
   - "Entwurf laden" button to load a saved draft

3. **Musterdaten** (only in dev mode):
   - Preset type dropdown
   - "Musterdaten einfüllen" button

The sidebar is hidden when dev mode is off (`syncDevSidebarVisibility()`).

## Modals

| Modal | Purpose | Trigger |
|-------|---------|---------|
| `#cameraModal` | Camera/video capture | Camera/video buttons on file upload widgets |
| `#draftModal` | Shows share link after saving draft | Successful draft save |
