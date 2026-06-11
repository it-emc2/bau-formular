# Bitrix24 CRM Integration

## Overview

bau-formular integrates with Bitrix24 CRM to:
1. **Pull**: Fetch deals (customer orders) and contact data to pre-fill forms
2. **Push**: Post inspection documentation to deal timelines on form submission

All communication uses Bitrix24's **webhook-based REST API** — no OAuth, no user authentication. The webhook URL is configured via the `BITRIX_WEBHOOK_BASE` environment variable.

## Webhook Architecture

The Bitrix webhook URL has the format:
```
https://<portal>.bitrix24.de/rest/<userId>/<webhookToken>/
```

The `bxGet()` function in `services/bitrix.js` appends REST method names to this base:
```
${BITRIX_WEBHOOK_BASE}/<method>.json?<queryString>
```

Despite the function name `bxGet`, all requests use HTTP GET — even writes like `crm.timeline.comment.add`. Bitrix24 accepts both GET and POST for webhook calls, but this app uses GET exclusively.

## Query String Serialization

The `buildQS()` function handles Bitrix's unusual query parameter format:
- Simple values: `key=value`
- Arrays: `key[]=value1&key[]=value2`
- Objects: `key[nestedKey]=value`

This is necessary because Bitrix expects filter, select, and order parameters as nested structures.

## Bitrix REST Methods Used

| Method | Purpose | Used In |
|--------|---------|---------|
| `crm.contact.get` | Fetch contact details | `routes/bitrix.js` |
| `crm.requisite.list` | Find contact requisites (for address) | `routes/bitrix.js` |
| `crm.address.list` | Get address from requisite | `routes/bitrix.js` |
| `crm.item.list` | List CRM items by pipeline stage | `routes/bitrix.js` |
| `crm.timeline.comment.add` | Post comment to entity timeline | `services/bitrix.js` |

## Contact Address Resolution

Bitrix contacts may not have address fields directly populated. The address resolution chain is:

```
Contact (crm.contact.get)
  → Has ADDRESS fields? → Use them
  → No address? 
    → Find Requisite (crm.requisite.list, ENTITY_TYPE_ID=3)
      → Found? → Get Address (crm.address.list, ENTITY_TYPE_ID=8)
        → Patch ADDRESS, ADDRESS_POSTAL_CODE, ADDRESS_CITY onto contact
```

Entity Type IDs:
- `3` = Contact
- `4` = Company
- `8` = Requisite (for address lookup)

## Deal Pipeline Configuration

The app is configured to fetch deals from a specific pipeline stage:

| Setting | Value | Description |
|---------|-------|-------------|
| Entity Type ID | `2` | Deals |
| Default Stage ID | `C22:UC_T5EXSL` | Specific pipeline stage for active work orders |

These are hardcoded in `routes/bitrix.js` (`DEFAULT_STAGE_ID`) and `public/app.js` (`BITRIX_TEST_ENTITY_TYPE_ID`, `BITRIX_STAGE_ID`).

## Frontend → Form Pre-fill Flow

When a user selects a Bitrix deal in the sidebar:

```
1. User clicks "In Formular laden" on a deal card
2. loadBitrixDeal(deal) is called
3. applyBitrixItemToForm(item):
   → terminId = "BITRIX-{deal.id}"
   → auftragsNummer = deal.title
   → kundennummer = deal.contactId
   → bitrixAuftragId = deal.id
   → bitrixZusatzfeld = deal.title
   → Resolves "Auszuführende Tätigkeiten" from UF fields
   → Updates checklist variant based on activity type
4. fetchBitrixContact(contactId):
   → GET /api/bitrix/contact/{id}
5. applyBitrixContactToForm(contact):
   → anrede = normalized from HONORIFIC/POST
   → vorname = NAME
   → nachname = LAST_NAME
   → adresse.strasse = ADDRESS
   → adresse.stadt = ADDRESS_CITY
   → adresse.plz = ADDRESS_POSTAL_CODE
```

## Auszuführende Tätigkeiten (Activities to Perform)

Bitrix deals have a custom user field (`UF_CRM_1725521281342` / `ufCrm_1725521281342`) that contains activity type codes. The frontend maps these codes to human-readable labels:

| Code | Label |
|------|-------|
| `4024` | [HD] Umbau Dusche zu Dusche |
| `4026` | [HD] Umbau Wanne zu Dusche |
| `4706` | [HD] Badrenovierung |
| `4704` | [HD] Badewannentüre |
| `7730` | [HD] Badumbau |
| `4032` | [HD] Haltegriffe |
| `4034` | [HD] Handläufe |
| `5666` | [HMS] Objektbetreuung |
| `8162` | [HMS] Gartenarbeiten |
| `4564` | [AH] Alltagsbegleitung |
| `4566` | [AH] Haushaltsnahe Dienstleistungen |
| `6820` | [HD] Entrümpelung |
| `4052` | [HD] Winterdienst |
| `7030` | [KFZ] Autoreparatur |
| `4158` | Sonstige |

These activity labels determine the checklist variant (Badumbau, Badewannentür, or Handläufe).

## Submission → Bitrix Sync

On form submission, if `bitrixAuftragId` is set, the system automatically:

1. **Generates confirmation letter** (`buildDocumentPackage()`) — plain text version
2. **Generates step PDFs** (`buildStepDocumentAttachments()`) — one PDF per inspection step:
   - `01-abschluss-der-baustelle-{customer}.pdf` — Basic info summary
   - `02-warenpruefung-{customer}.pdf` — Goods inspection with signature
   - `03-fotos-und-video-{customer}.pdf` — File count summary
   - `04-weitere-bilder-{customer}.pdf` — Additional images count
   - `05-abschluss-und-unterschrift-{customer}.pdf` — Completion with customer signature
   - `06-checkliste-{variant}-{customer}.pdf` — Assembly checklist with technician signature
   - `07-maengelbeseitigung-{customer}.pdf` — (debug mode only)
   - `08-nachbesserung-{customer}.pdf` — (debug mode only)
3. **Posts timeline comment** to the Bitrix deal with the letter text and PDF attachments

The comment format is:
```
Bestaetigung erfolgreicher Umbau

[Full letter text]
```

## Admin Re-Push (Bitrix Neu-Push)

The admin panel provides a manual re-push tool for cases where the automatic submission sync failed or needs to be repeated.

**How it works:**
1. Admin enters the **Bitrix-Auftrag-ID** (the numeric Bitrix deal ID)
2. The server runs `findAdminFormByBitrixId()` — queries `Abnahme` first (most recent), then `Entwurf` as fallback
3. Returns three selectable categories: **Bilder** (images), **Videos**, **PDFs**
4. Admin selects files and clicks "Zu Bitrix senden"
5. Server compresses selected media and generates selected PDFs, then posts to the deal timeline using the same single-comment → retry → batch-fallback logic as a normal submit

**File handling during admin push:**
- **Images**: re-compressed via sharp (1600px, q68 JPEG) before sending. If the result is not smaller than the source, the original is used.
- **Videos**: re-encoded via ffmpeg (1280×720, CRF30, `fast` preset) from the original file on the volume. The volume file itself is never modified.
- **PDFs**: generated fresh from the form data stored in MongoDB — the volume is not involved.

**Multiple documents warning:** If multiple Abnahmen or Entwürfe share the same Bitrix Auftrag ID, the most recently updated document is used and a warning toast is shown (`multipleCount > 1` in the inspect response).

---

## Error Handling

Submit success means both Bitrix and MongoDB finished successfully. The app first saves a recovery draft, then sends to Bitrix outside a MongoDB transaction. If Bitrix fails, the response includes `bitrixSync.sent: false` and the recovery draft remains available for an admin/user retry.

After Bitrix succeeds, the app opens a short MongoDB transaction to create/update the Abnahme and delete the recovery draft. If this final MongoDB commit fails, the draft remains and the admin operation logs show the edge case so a retry can be handled deliberately.
