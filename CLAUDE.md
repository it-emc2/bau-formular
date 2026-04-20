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

Tests use Jest + Supertest. Test files live in `__tests__/`.

## Architecture

**Backend (Express.js):**
- `server.js` — App entry point, middleware setup (Helmet, CORS), MongoDB connection, SPA route fallback
- `routes/form.js` — Form CRUD (`/api/form/*`): drafts, submit, document render/email, Arbeitsbericht PDF proxy
- `routes/bitrix.js` — Bitrix CRM integration (`/api/bitrix/*`): contact lookup, deal listing, timeline comments
- `models/Abnahme.js` — Mongoose schema for submitted forms (10-step structure). `Entwurf.js` reuses same schema for drafts
- `services/bitrix.js` — Bitrix webhook REST client
- `services/documentLetter.js` — HTML/Word document generation from form data
- `services/stepDocuments.js` — PDF generation using pdf-lib

**Frontend (vanilla JS SPA in `public/`):**
- `app.js` (~2600 lines) — Main controller: form step navigation, state management, file uploads, signature capture (SignaturePad), Bitrix sidebar, draft management, dev mode
- `index.html` — SPA shell with step sections (data-step attributes)
- `style.css` — All styling including responsive layout
- No build tool — files served directly from `/public`

**Form Types:** Baustellenabnahme, Zusätzliche Leistungen, Nachbesserung, Schadensmeldung — each with different step workflows.

## Key Integrations

- **MongoDB** (Mongoose) — `MONGODB_URI`, `MONGODB_DB` env vars
- **Bitrix24 CRM** — Webhook-based REST via `BITRIX_WEBHOOK_BASE` env var
- **SMTP Email** — Nodemailer with `SMTP_HOST/PORT/USER/PASS/FROM` env vars, falls back to mailto: links
- **Arbeitsbericht PDF** — Proxied from external service (`ARBEITSBERICHT_PDF_URL`)

## Deployment

- Hosted on Fly.io (Frankfurt region)
- GitHub Actions CI/CD deploys on push to main (`.github/workflows/fly-deploy.yml`)
- Docker container using Node.js 24.11.1-slim base image

## Frontend State

State is managed via module-scope JS variables in `app.js`: `currentStep`, `formId`, `shareToken`, `fileStore`, `signaturePads`, `devMode`, `bitrixDeals`, `drafts`. localStorage persists dev mode toggle and demo presets.

## Client-Side Routes

`/` and `/home` (type selector), `/form/:token` (shared form), `/AbschlussderBaustelle`, `/BeauftragungzusatzlicheLeistungen`, `/Nachbesserung`, `/Schadensmeldung`
