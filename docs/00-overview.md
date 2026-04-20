# Project Overview

## What is bau-formular?

**bau-formular** (German: "construction form") is a full-stack web application built for **emc2 — Dienstleister fürs Leben**, a German company that performs barrier-free bathroom renovations, handrail installations, and bathtub door modifications for elderly and disabled customers, often funded by German care insurance (Pflegekasse, SGB XI).

The app digitises the on-site construction inspection workflow. Field workers (Monteure) use it on a tablet or phone to walk through a multi-step form **together with the customer**, documenting the work, capturing signatures, taking photos, and generating confirmation letters — all synced back to the company's Bitrix24 CRM.

## Business Context

German care insurance (Pflegekasse) provides grants under **§40 SGB XI Abs. 4** for home modifications that improve accessibility. After the work is completed, the customer must sign a confirmation letter that the renovation was performed successfully. This letter, along with inspection documents, is sent to the insurance company for reimbursement.

bau-formular automates this entire documentation chain:
1. Select a Bitrix24 deal (customer order)
2. Walk through the inspection steps with the customer
3. Capture signatures, photos, and checklists
4. Generate and send confirmation letters
5. Post documentation back to Bitrix24 CRM timeline

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Runtime | Node.js | 24.11.1 |
| Backend Framework | Express.js | ^4.21.2 |
| Database | MongoDB (via Mongoose ODM) | ^9.3.2 |
| Frontend | Vanilla JavaScript SPA | No framework |
| Signature Capture | SignaturePad | 4.2.0 (CDN) |
| PDF Generation | pdf-lib | ^1.17.1 |
| Email | Nodemailer | ^8.0.5 |
| Security | Helmet | ^8.1.0 |
| File Upload | Multer | ^1.4.5-lts.1 |
| Testing | Jest + Supertest | ^29.7.0 / ^7.2.2 |
| Deployment | Docker on Fly.io | Frankfurt region |
| CI/CD | GitHub Actions | Deploys on push to main |
| CRM | Bitrix24 | Webhook REST API |

## Key Design Decisions

1. **No frontend framework**: The entire SPA is a single vanilla JS file (`public/app.js`, ~2600 lines). There is no build step — files are served as-is from `/public`. This keeps deployment simple but means the frontend is monolithic.

2. **No authentication**: The app is intended for internal company use. There is no login or user management. Forms are shared via unique tokens.

3. **Dual collection storage**: Drafts (`Entwurf`) and submitted forms (`Abnahme`) share the same Mongoose schema but are stored in separate MongoDB collections (`Entwürfe` and `Abnahmen`). On submission, the draft is deleted and a new Abnahme document is created.

4. **Webhook-based Bitrix integration**: All Bitrix communication goes through a webhook URL (no OAuth). The app calls Bitrix REST methods by appending them to the webhook base URL.

5. **Graceful email degradation**: If SMTP is not configured, the app falls back to `mailto:` links that open the user's local email client.

6. **Files stored on disk**: Uploaded images/videos are stored in the `/uploads` directory on the server filesystem, not in a cloud storage service.

## Application URL

- **Production**: `https://bau-formular.fly.dev`
- **Local development**: `http://localhost:3000`

## Related Services

- **Angebotskonfigurator** (`https://angebotskonfigurator-emc2-v2.fly.dev`): A separate emc2 application for offer/quote configuration. bau-formular proxies Arbeitsbericht (work report) PDF generation through this service.
- **Bitrix24**: The company's CRM system, accessed via webhook REST API.
