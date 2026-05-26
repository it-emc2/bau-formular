# Data Model

## MongoDB Collections

The application uses two MongoDB collections that share the same schema:

| Collection | Mongoose Model | Purpose |
|-----------|---------------|---------|
| `Abnahmen` | `Abnahme` | Submitted (final) forms |
| `Entwürfe` | `Entwurf` | Draft (in-progress) forms |

Both are defined through `createAbnahmeSchema()` in `models/Abnahme.js`. The `Entwurf` model in `models/Entwurf.js` calls `createAbnahmeSchema('Entwürfe', { requireTerminId: false })` so incomplete forms can be saved as drafts.

## Schema Definition

The schema has **10 logical steps** plus system fields. For submitted forms, all fields except `terminId` are optional. Drafts may be saved before `terminId` is known.

### System Fields

| Field | Type | Description |
|-------|------|-------------|
| `status` | String enum: `draft`, `submitted` | Form lifecycle state |
| `shareToken` | String (unique, sparse) | 32-char hex token for shareable URLs |
| `createdAt` | Date (auto) | Mongoose timestamp |
| `updatedAt` | Date (auto) | Mongoose timestamp |

### Step 1 — Grunddaten (Basic Data)

| Field | Type | Description |
|-------|------|-------------|
| `terminId` | String (**required for submitted forms**) | Appointment/termin ID, e.g., "UT-12345" or "BITRIX-123" |
| `formularTyp` | String enum | `baustellenabnahme` (default), `zusaetzliche_leistungen`, `nachbesserung`, `schadensmeldung` |
| `kundennummer` | String | Customer number |
| `artDesTermins` | String enum | `Umbau` (default), `Nachbesserung`, `Service` |
| `anrede` | String enum | `Frau`, `Herr`, `Familie`, `` |
| `vorname` | String | First name |
| `nachname` | String | Last name |
| `name` | String | Full name (computed on save) |
| `adresse.strasse` | String | Street address |
| `adresse.adresszeile2` | String | Address line 2 |
| `adresse.stadt` | String | City |
| `adresse.plz` | String | Postal code |
| `terminStatus` | String enum | `Erfolgreich beendet`, `Nicht erfolgreich beendet`, `` |
| `bitrixAuftragId` | String | Bitrix deal ID for CRM sync |
| `bitrixZusatzfeld` | String | Extra Bitrix field value |
| `auszufuehrendeTaetigkeiten` | String | Activities to be performed (from Bitrix) |
| `bitrixExecutionActivities` | String | Mirror of auszufuehrendeTaetigkeiten |
| `auftragsNummer` | String | Order number, e.g., "A-AN-BAD-2026-001" |

### Step 2 — Warenprüfung (Goods Inspection)

Each goods item has a status field with enum values `io` (in order), `nicht-io` (not in order), or empty string.

| Field | Type | Description |
|-------|------|-------------|
| `warenpruefungDatum` | Date | Inspection date |
| `wareWandverkleidungenStatus` | String enum | Wall cladding status |
| `wareDuschabtrennungenStatus` | String enum | Shower partition status |
| `wareDuschwanneStatus` | String enum | Shower tray status |
| `wareBadewannentuerStatus` | String enum | Bathtub door status |
| `wareWaschtischStatus` | String enum | Washbasin status |
| `wareToiletteStatus` | String enum | Toilet status |
| `wareHaltegriffStatus` | String enum | Grab rail status |
| `wareBoedenStatus` | String enum | Floor status |
| `wareGelaenderStatus` | String enum | Railing (FlexoFit) status |
| `wareSonstigesStatus` | String enum | Other items status |
| `warenpruefungKommentar` | String | Inspection comments |
| `unterschriftWarenpruefung` | String | Signature as base64 PNG data URL |

### Step 3 — Montage-Checkliste (Assembly Checklist)

All boolean fields default to `false`. These are checkboxes.

| Field | Type | Description |
|-------|------|-------------|
| `checklistFotosWaerendUmsetzung` | Boolean | Photos during execution |
| `checklistFinaleFotos` | Boolean | Final photos taken |
| `checklistFotosHandwerkskoordination` | Boolean | Photos sent to coordination |
| `checklistFotoUebermittlung` | String enum | `iMessage`, `WhatsApp`, `FortyTools`, `` |
| `checklistVerbrauchsmaterialErfasst` | Boolean | Consumables recorded |
| `checklistWarenkorbGeschickt` | Boolean | Shopping cart sent |
| `checklistDokumentWarenpruefung` | Boolean | Goods inspection signed (auto-checked) |
| `checklistArbeitszeitenErfasst` | Boolean | Work hours recorded |
| `checklistBestaetigungKasse` | Boolean | Insurance confirmation signed (auto-checked) |
| `checklistDokumentArbeitsbericht` | Boolean | Work report signed (auto-checked) |
| `checklistFlyerBadewannentuer` | Boolean | Bathtub door flyer given |
| `checklistFlyerBadumbau` | Boolean | Bathroom renovation flyer given |
| `checklistFlyerHaltegriffe` | Boolean | Grab rails flyer given |
| `checklistBroschuerePflegehinweise` | Boolean | Care instructions brochure given |
| `checklistSilikonDuschabzieher` | Boolean | Silicone shower squeegee given |
| `checklistHinweisSilikonfugen` | Boolean | Silicone joint notice left |
| `checklistGratisHaltegriffMontiert` | Boolean | Free grab rail installed |
| `checklistGratisHaltegriffKommentar` | String | Comment if not installed |

### Step 4 — Abschlusskontrolle (Final Inspection)

| Field | Type | Description |
|-------|------|-------------|
| `abschlusskontrolleBaustelleSauber` | Boolean | Site left clean |
| `abschlusskontrolleVerpackungEntsorgt` | Boolean | Packaging disposed |
| `abschlusskontrolleFunktionstest` | Boolean | Function test performed |
| `abschlusskontrolleKundeEingewiesen` | Boolean | Customer briefed |
| `abschlusskontrolleWerkzeugeMitgenommen` | Boolean | Tools taken |
| `sonstigeBemerkungenBaustelle` | String | Additional notes |
| `unterschriftMonteur1` | String | Technician 1 signature (base64 PNG) |
| `unterschriftMonteur2` | String | Technician 2 signature (base64 PNG) |
| `unterschriftMonteurDatum` | Date | Technician signature date |

### Step 5 — Fotos / Video

| Field | Type | Description |
|-------|------|-------------|
| `bilderFertigerUmbau` | [String] | Array of uploaded image URLs |
| `grossesVideoNachgang` | Boolean | Large video to be uploaded later |
| `videoDesAblaufs` | String | Video URL showing water drainage |
| `fotosAbdichtung` | [String] | Sealing photos |
| `bilderBehobeneMaengel` | [String] | Photos of fixed defects |

### Step 6 — Weitere Bilder (More Images)

| Field | Type | Description |
|-------|------|-------------|
| `weitereBilder` | [String] | Additional images set 1 |
| `weitereBilder2` | [String] | Additional images set 2 |
| `weitereBilder3` | [String] | Additional images set 3 |

### Step 7 — Abschluss Umbau (Completion)

| Field | Type | Description |
|-------|------|-------------|
| `zusaetzlicheArbeiten` | String | Description of additional work |
| `preisZusaetzlich` | Number | Price of additional work (EUR) |
| `unterschriftZusaetzlicheLeistungen` | String | Additional services signature (base64) |
| `unterschriftZusaetzlicheLeistungenZeitpunkt` | Date | Signature timestamp |
| `abgeschlossenAm` | Date | Completion date |
| `alleArbeitenErledigt` | String enum | `Ja`, `Nein`, `` |
| `nichtErledigteArbeiten` | String | Description of incomplete work |
| `unterschriftKunde` | String | Customer signature (base64 PNG) |
| `unterschriftZeitpunkt` | Date | Customer signature timestamp |

### Step 8 — Mängelbeseitigung (Defect Resolution)

| Field | Type | Description |
|-------|------|-------------|
| `maengelAbgeschlossenAm` | Date | Defect resolution completion date |
| `unterschriftMaengel` | String | Defect resolution signature (base64) |
| `unterschriftMaengelZeitpunkt` | Date | Signature timestamp |

### Step 9 — Nachbesserung (Rework)

| Field | Type | Description |
|-------|------|-------------|
| `nachbesserungAbgeschlossenAm` | Date | Rework completion date |
| `zusaetzlicheArbeitenNB` | String | Additional work during rework |
| `preisZusaetzlichNB` | Number | Price of additional rework |
| `alleArbeitenNB` | String enum | `Ja`, `Nein`, `` |
| `nichtErledigteArbeitenNB` | String | Incomplete rework description |
| `unterschriftNB` | String | Rework signature (base64) |
| `unterschriftNBZeitpunkt` | Date | Rework signature timestamp |

### Step 10 — Hinweise (Notes)

| Field | Type | Description |
|-------|------|-------------|
| `hinweiseBuero` | String | Notes for the office |
| `emailEmpfaenger` | String | Email recipient for document delivery |

## Signature Storage

All signature fields store **base64-encoded PNG data URLs** (e.g., `data:image/png;base64,...`). These are captured client-side by the SignaturePad library from `<canvas>` elements and stored as strings in MongoDB. The base64 data can be quite large (10-50 KB per signature).

## Share Tokens

Each form (draft or submitted) gets a unique `shareToken` — a 32-character hex string generated by `crypto.randomBytes(16).toString('hex')`. This token enables shareable URLs like `/form/abc123...` that load the form without authentication.

## Draft → Submission Lifecycle

```
1. User fills form → POST /api/form/save
   → Creates Entwurf (status: 'draft') in 'Entwürfe' collection

2. User continues editing → POST /api/form/save (with _id)
   → Updates existing Entwurf

   If the _id belongs to an already submitted Abnahme, the save endpoint creates a new Entwurf copy with a fresh shareToken instead of failing.

3. User submits → POST /api/form/submit (with _id of draft)
   → Creates new Abnahme (status: 'submitted') in 'Abnahmen' collection
   → Copies all data from Entwurf + any new fields
   → Preserves the shareToken
   → Deletes the Entwurf
   → Optionally syncs to Bitrix
```
