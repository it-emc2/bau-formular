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
- `routes/form.js` — Form CRUD (`/api/form/*`): drafts, submit, document render/email, Arbeitsbericht PDF proxy
- `routes/bitrix.js` — Bitrix CRM integration (`/api/bitrix/*`): contact lookup, deal listing, timeline comments
- `models/Abnahme.js` — Mongoose schema for submitted forms (10-step structure with `createAbnahmeSchema` factory)
- `models/Entwurf.js` — Draft model, reuses the same schema via `createAbnahmeSchema` but writes to a separate `Entwürfe` collection
- `services/bitrix.js` — Bitrix webhook REST client (all calls use GET, including writes — this is how Bitrix webhooks work)
- `services/documentLetter.js` — HTML/Word document generation from form data
- `services/stepDocuments.js` — PDF generation using pdf-lib

**Frontend (vanilla JS SPA in `public/`):**
- `app.js` (~2600 lines) — Main controller: form step navigation, state management, file uploads, signature capture (SignaturePad), Bitrix sidebar, draft management, dev mode
- `public/documentLetter.js` — Client-side copy of `services/documentLetter.js` for browser-side document preview. Changes to document generation logic must be synced between both files.
- `index.html` — SPA shell with step sections (data-step attributes)
- `style.css` — All styling including responsive layout
- No build tool — files served directly from `/public`

**Form Types:** Baustellenabnahme, Zusätzliche Leistungen, Nachbesserung, Schadensmeldung — each with different step workflows.

## Data Flow

- **Save (draft):** Form data → `POST /api/form/save` (multipart via multer) → `Entwurf` collection (status: `draft`)
- **Submit:** Form data → `POST /api/form/submit` → creates `Abnahme` document (status: `submitted`), deletes the `Entwurf` if one existed, then sends to Bitrix timeline
- **Share token:** Both drafts and submitted forms get a unique `shareToken` (32-char hex). `GET /api/form/token/:token` checks `Entwurf` first, then `Abnahme`
- `parsePayload` in `routes/form.js` handles both JSON body and multipart `formData` field (string or object)

## Key Integrations

- **MongoDB** (Mongoose) — `MONGODB_URI`, `MONGODB_DB` env vars
- **Bitrix24 CRM** — Webhook-based REST via `BITRIX_WEBHOOK_BASE` env var
- **SMTP Email** — Nodemailer with `SMTP_HOST/PORT/USER/PASS/FROM` env vars, falls back to mailto: links
- **Arbeitsbericht PDF** — Proxied from external service (`ARBEITSBERICHT_PDF_URL`)
- **External Offers App** — `EXTERNAL_OFFERS_API_BASE_URL` (default: angebotskonfigurator-emc2-v2.fly.dev), also used in CSP connect-src
- **CORS** — `ALLOWED_ORIGINS` env var (comma-separated) merged with hardcoded defaults

## Deployment

- Hosted on Fly.io (Frankfurt region, app name: `bau-formular`)
- GitHub Actions CI/CD deploys on push to main (`.github/workflows/fly-deploy.yml`)
- Docker container using Node.js 24.11.1-slim base image
- Auto-stop/auto-start machines enabled, min 0 running

## Frontend State

State is managed via module-scope JS variables in `app.js`: `currentStep`, `formId`, `shareToken`, `fileStore`, `signaturePads`, `devMode`, `bitrixDeals`, `drafts`. localStorage persists dev mode toggle and demo presets.

## Client-Side Routes

`/` and `/home` (type selector), `/form/:token` (shared form), `/AbschlussderBaustelle`, `/BeauftragungzusatzlicheLeistungen`, `/Nachbesserung`, `/Schadensmeldung`
