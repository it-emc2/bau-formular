# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**bau-formular** is a digital construction site inspection form application for emc2. It's a Node.js/Express backend with a vanilla JavaScript SPA frontend for managing multi-step inspection forms, document generation, and Bitrix24 CRM integration. All UI text is in German.

## Commands

```bash
npm run dev          # Start dev server with file watching (node --watch)
npm start            # Production server
npm test             # Run Jest tests (--runInBand --watchman=false)
npm run test:watch   # Run tests in watch mode
```

Run a single test file:
```bash
npm test -- __tests__/routes.form.test.js
```

Run a single test by name:
```bash
npm test -- --testNamePattern="POST /save creates a new draft"
```

Tests use Jest (node environment, no supertest). Test files live in `__tests__/`. Tests mock Mongoose models and services, then call route handlers directly via a `findRouteHandlers` helper that extracts middleware from the Express router stack. `server.js` exports `{ app, startServer, corsOrigin }` for test access.

## Architecture

**Backend (Express.js):**
- `server.js` — App entry point, middleware setup (Helmet, CORS), MongoDB connection, SPA route fallback
- `routes/form.js` — Form CRUD (`/api/form/*`): drafts, submit, document render/email, Arbeitsbericht PDF proxy, admin endpoints
- `routes/bitrix.js` — Bitrix CRM integration (`/api/bitrix/*`): contact lookup, deal listing, timeline comments
- `models/Abnahme.js` — Mongoose schema for submitted forms (10-step structure with `createAbnahmeSchema` factory)
- `models/Entwurf.js` — Draft model, reuses the same schema via `createAbnahmeSchema` but writes to a separate `Entwürfe` collection; drafts do not require `terminId`
- `services/bitrix.js` — Bitrix webhook REST client (all calls use GET, including writes — this is how Bitrix webhooks work). GET timeout 30s, POST timeout 60s (on the HTTP call only — compression happens before the timer starts).
- `services/documentLetter.js` — HTML/Word document generation from form data
- `services/stepDocuments.js` — PDF generation using pdf-lib. Exports `buildBitrixUploadAttachment` (compresses images via sharp at 1600px/q68 and video via ffmpeg at 1280×720 CRF30 `fast` preset), `buildStepDocumentAttachments`, `buildSelectedPdfAttachments`, `buildCustomerName`, `ADMIN_PDF_SPECS`, `compressUploadedFiles`. Images are compressed at upload time (in `uploadAny` middleware) and skipped during Bitrix attachment building if already compressed in the current server process (`uploadTimeCompressed` Set). Videos are compressed at Bitrix push time.
- `services/orphanUploads.js` — finds upload files on disk with no matching Abnahme or Entwurf in MongoDB

**Frontend (vanilla JS SPA in `public/`):**
- `app.js` (~2700 lines) — Main controller: form step navigation, state management, file uploads, signature capture (SignaturePad), Bitrix sidebar, draft management, dev mode
- `public/documentLetter.js` — Client-side copy of `services/documentLetter.js` for browser-side document preview. Changes to document generation logic must be synced between both files.
- `index.html` — SPA shell with step sections (data-step attributes)
- `style.css` — All styling including responsive layout
- No build tool — files served directly from `/public`

**Form Types:** Baustellenabnahme, Zusätzliche Leistungen, Nachbesserung, Schadensmeldung — each with different step workflows.

## Data Flow

- **Save (draft):** Form data → `POST /api/form/save` (multipart via multer) → `Entwurf` collection (status: `draft`)
- **Submit:** Form data → `POST /api/form/submit` → creates `Abnahme` document (status: `submitted`), deletes the `Entwurf` if one existed, then sends to Bitrix timeline
- **Share token:** Both drafts and submitted forms get a unique `shareToken` (32-char hex). `GET /api/form/token/:token` checks `Entwurf` first, then `Abnahme`
- **Uploads:** Physical media files are stored in `UPLOADS_DIR` (`./uploads` locally, `/data/uploads` on Fly). The upload route recreates the directory before writing files.
- `parsePayload` in `routes/form.js` handles both JSON body and multipart `formData` field (string or object)

## Key Integrations

- **MongoDB** (Mongoose) — `MONGODB_URI`, `MONGODB_DB` env vars
- **Bitrix24 CRM** — Webhook-based REST via `BITRIX_WEBHOOK_BASE` env var
- **SMTP Email** — Nodemailer with `SMTP_HOST/PORT/USER/PASS/FROM` env vars, falls back to mailto: links
- **Arbeitsbericht PDF** — Proxied from external service (`ARBEITSBERICHT_PDF_URL`)
- **External Offers App** — `EXTERNAL_OFFERS_API_BASE_URL` (default: angebotskonfigurator-emc2-v2.fly.dev), also used in CSP connect-src
- **CORS** — `ALLOWED_ORIGINS` env var (comma-separated) merged with hardcoded defaults

## Admin / Testmodus

All admin UI is hidden behind the dev-mode password toggle (Testmodus). When active, three extra panels appear in the sidebar:

**1. Orphan Uploads prüfen / löschen** (`adminCleanupPanel`)
- Dry-run and delete buttons → `POST /api/form/admin/orphan-uploads`
- Finds upload files on disk with no matching Abnahme or Entwurf in MongoDB

**2. Logs aktualisieren** (`adminLogPanel`)
- `POST /api/form/admin/logs` → renders operation log table (submit events, Bitrix timeline attempts, compression stats)

**3. Bitrix Neu-Push** (`adminPushPanel`)
- Enter **Bitrix-Auftrag-ID only** — the server looks up the matching document automatically (`findAdminFormByBitrixId`): prefers most-recent `Abnahme`, falls back to most-recent `Entwurf`; shows a warning toast if multiple documents share that ID
- Click **Laden** → `POST /api/form/admin/inspect` → returns three file categories with disk-existence flags
- Three collapsible sections with checkboxes: **Bilder** (image fields), **Videos** (`videoDesAblaufs`), **PDFs** (8 generated documents)
- Click **Zu Bitrix senden** → `POST /api/form/admin/push` → compresses selected files, generates selected PDFs, posts to Bitrix using the same single-comment → batch-fallback logic as normal submit
- `POST /api/form/admin/submitted/:id/bitrix/video` — legacy single-video re-push endpoint (kept for backwards compat)

**Bitrix submit flow (normal + admin push):**
1. All media compressed first (`sharp` for images at upload time; `ffmpeg` for video at push time) — no timeout applies here
2. Single `postTimelineComment` with all attachments → 60s HTTP timeout
3. If that fails: wait 10s, retry up to 2 more times (3 attempts total), each with its own 60s window
4. If all 3 attempts fail: split into ≤8 MB base64 batches, each with its own 60s window
5. Files that individually exceed 8 MB after compression are skipped and noted in the comment text

**ffmpeg video compression flags:** `scale` with `force_divisible_by=2` (required — rotation metadata on portrait videos causes odd pixel widths without it), `libx264 fast`, `CRF 30`, max 1280×720.

## Deployment

- Hosted on Fly.io (Frankfurt region, app name: `bau-formular`)
- GitHub Actions CI/CD deploys on push to main (`.github/workflows/fly-deploy.yml`)
- Docker container using Node.js 24.11.1-slim base image
- Auto-stop/auto-start machines enabled, min 0 running

## Frontend State

State is managed via module-scope JS variables in `app.js`: `currentStep`, `formId`, `shareToken`, `fileStore`, `signaturePads`, `devMode`, `bitrixDeals`, `drafts`. Testmodus requires a server-side password and persists across page navigations via `sessionStorage` (cleared on tab close or explicit "Testmodus: Aus" click). localStorage persists demo presets.

## Client-Side Routes

`/` and `/home` (type selector), `/form/:token` (shared form), `/AbschlussderBaustelle`, `/BeauftragungzusatzlicheLeistungen`, `/Nachbesserung`, `/Schadensmeldung`
