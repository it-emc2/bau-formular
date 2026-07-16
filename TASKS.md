# bau-formular — Task List

Derived from [IMPROVEMENTS.md](IMPROVEMENTS.md). Ordered by priority.

## Phase 1 — Security (do first, small & high-impact)

- [ ] **Add multer limits + mimetype allowlist** — `multer({ storage, limits: { fileSize, files } })` and reject non-image/video types ([routes/form.js:39](routes/form.js#L39))
- [ ] **Lock down `/uploads` static serving** — require auth/token, or serve through a gated route; widen filename randomness from 4 → 16+ bytes ([server.js:77](server.js#L77), [routes/form.js:33-36](routes/form.js#L33-L36))
- [ ] **Verify admin endpoints check auth server-side** — confirm every `POST /api/form/admin/*` independently validates the password/token per request (not just the client Testmodus gate)
- [ ] **Expire share tokens** — invalidate `/form/:token` links after submit + N days
- [ ] **Rate-limit** dev-mode verify + save/submit endpoints

## Phase 2 — Storage restructure (answers the volume question)

- [ ] **Delete local files after confirmed Bitrix push** — keep only files still referenced by open drafts; retire the 30-day cleanup ceremony
- [ ] **Push media to a per-deal Bitrix Drive folder** — use `disk.folder.uploadfile` two-step `uploadUrl` (raw multipart, no base64 8 MB cap); timeline comment links the folder
- [ ] **Stop silently skipping >8 MB files** — no longer needed once Drive upload replaces inline base64 batching
- [ ] **Demote the Fly volume to a staging area** once the above land

## Phase 3 — Reliability (biggest field-worker UX win)

- [ ] **Make submit asynchronous** — save to Mongo, respond in ~2s, run Bitrix push as a persisted background outbox job with status ([routes/form.js:1910](routes/form.js#L1910))
- [ ] **Show sync status on the form/draft card** — pending / sent / failed
- [ ] **Server-side idempotency key on submit** — prevent duplicate Abnahmen + duplicate Bitrix comments on double-tap/retry
- [ ] **Persist the `uploadTimeCompressed` flag** — filename suffix (`-c.jpg`) or DB field so restarts don't re-compress
- [ ] **Alert on final Bitrix push failure** — email/Bitrix notification instead of waiting for someone to check the admin log

## Phase 4 — Field experience

- [ ] **Client-side image compression before upload** — downscale to ~1600px via canvas/`createImageBitmap` (~80% less data)
- [ ] **Upload progress bars** — switch fetch → XHR `upload.onprogress` (or streams)
- [ ] **Offline resilience (PWA)** — service worker + IndexedDB queue; capture form + photos offline, auto-sync when back online
- [ ] **Autosave drafts** — on step change / every N seconds
- [ ] **Chunked/resumable video upload** for `videoDesAblaufs`
- [ ] **PWA manifest + icon** — installable to home screen

## Phase 5 — Code health

- [ ] **Split `app.js`** (~3,500 lines) into native ES modules — `state.js`, `steps.js`, `uploads.js`, `bitrix-sidebar.js`, `admin.js`, `drafts.js`
- [ ] **De-duplicate `documentLetter.js`** — make `services/documentLetter.js` isomorphic and serve the same file to the browser
- [ ] **Migrate route tests to supertest** — less brittle than router-stack introspection
