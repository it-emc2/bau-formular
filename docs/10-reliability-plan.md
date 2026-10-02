# Reliability Plan — "Nothing gets lost, the worker always knows what's happening"

Status: **active**, started 2026-10-02. This file is the hand-over between sessions.
Read it fully before starting any task below. Update the status table when a task lands.

## Goal

A professional web app for **non-technical workers on iPhones**:

1. **No data loss** — photos, videos, signatures and form fields survive tab reloads, crashes, dead spots and server failures.
2. **The worker is never left guessing** — every state (saving, uploading, offline, sent, failed) is shown in plain German with one clear next action.
3. **Everything is logged** — the office can reconstruct what happened to any job, and real errors reach a human.

## Status

| ID | Task | Status | Branch / commit |
|---|---|---|---|
| — | Step 1: upload each file once per draft | ✅ done, **live via manual `fly deploy`**, **not on main** | `form-submit-upload-once-v2` (`19d35cb`) |
| — | Fix 2 timing-out Bitrix retry tests | ✅ done | same branch (`4a2c30f`) |
| A1 | Auto-save on the phone (IndexedDB) | ✅ done, verified locally (Chromium); **iPhone test open**; not deployed | `plan/reliability-roadmap` (`b6306dd`) |
| B2 | Permanent status line | ✅ done (with A1); not deployed | same (`b6306dd`) |
| — | No 🟡 chat message on draft save (only 🟢 submit / 🔴 failure remain) | ✅ done; not deployed | same (`b6306dd`) |
| B1 | Fast green: Bitrix push in background + automatic retry + „Komplett neu senden“ | ✅ done. Background push live via manual `fly deploy` (owner, 2026-10-02); e2e on deal 65278 OK: green in 0.4 s, Bitrix `sent` 10 s later, 🟢 chat + n8n OK. „Komplett neu senden“ deployed; live-checked: *Laden* shows status, button refuses an already `sent` Abnahme; full resend of a `failed` Abnahme OK (6 attachments, 10 s, status → `sent`, timeline + Hinweis + n8n OK). Automatic retry path and final 🔴 alert only unit-tested | `plan/reliability-roadmap` |
| C2 | Real errors + failed pushes → Bitrix chat (with direct links) | 🟡 links + final-push-failure alert done with B1; client-error part after C1 | same |
| A2 | Background sync to server after each step/photo (+ continue server draft by `dealId`, 30-day draft cleanup) | ✅ done, verified locally against prod DB (Chromium): silent saves, photo added during an upload adopted correctly (1+1+1 uploads, no `adopt_skipped`), deal draft continued after local copy deleted. **live since 2026-10-02** (owner deploy), checked on live: silent save, no modal. **iPhone test open** | `plan/reliability-roadmap` |
| A3 | Outbox: submit queued while offline | ✅ done, verified locally (server stopped → queued → edited → server back → sent from the **home page**, exactly one Abnahme with the edit, Bitrix `sent`; repeat with same `submitId` → `duplicate: true`). **Live** checked too: queued → sent 7 s later, one Abnahme, Bitrix `sent`; live duplicate check OK. **iPhone test open** | same |
| A4 | `storage.persist()` + log (Home Screen install dropped) | ✅ done, verified locally (log arrives); not deployed | `plan/reliability-roadmap` |
| B3 | Upload progress | ⬜ | |
| B4 | Plain-German, persistent error messages | ⬜ | |
| B5 | Receipt screen after submit | ⬜ | |
| B6 | Request timeouts + automatic retry | ⬜ | |
| B7 | File size check at pick time | ⬜ | |
| C1 | Filter client-log noise | ⬜ | |
| C3 | One timeline per job in admin panel | ⬜ | |
| C4 | Longer retention for submit/Bitrix logs, protect "Logs löschen" | ⬜ | |
| C5 | Graceful shutdown on deploy | ⬜ | |
| C6 | Run tests in CI before deploy | ⬜ | |
| C7 | Compress video on upload, daily orphan cleanup, 80 % volume alarm | ✅ done, 90/90 tests; local e2e: 17.6 MB `.mov` → 186 KB `.mp4` in 1.6 s, original + temp removed. **Live** (owner deploy 2026-10-02 12:11): same test via `/debug-bitrix-payload` → 180 KB `.mp4` on the volume, no `.mov`/temp left; volume 28 %. The test file `1790943930554-c14ac81c-IMG_TEST.mp4` is an orphan on purpose: the daily cleanup should delete it after 24 h (`storage.orphans.deleted`) | `plan/reliability-roadmap` |

Recommended order: ~~A1+B2~~ → ~~B1+C2~~ → ~~A2+A3~~ → ~~A4~~ → ~~C7~~ → **C6** → C1+C2 rest → B4 → the rest (small items, any order).

Branches: `plan/reliability-roadmap` (local, **not pushed**) = `form-submit-upload-once-v2` + this plan + A1/B2 (`b6306dd`). Nothing of A1/B2 is live yet.

### ⚠️ Open deployment issue — read first

Production currently runs `form-submit-upload-once-v2` because it was deployed by hand with `fly deploy --remote-only` from a worktree. **`main` still has the old code.** GitHub Actions deploys `main` on every push, so the next push to `main` silently reverts production to the old upload behaviour.
→ Before or together with the first task of this plan: merge `form-submit-upload-once-v2` (or this branch, which contains it) into `main`. The owner said they will do this themselves; confirm with them before merging.

---

## Background: what was found (research 2026-10-02)

### Production data (OperationLogs, last 30 days, read-only query)

| Fact | Value | Consequence |
|---|---|---|
| Devices | 160 iPhone Safari/WebView · 26 Mac · 2 Android | Design and test for **iOS Safari** first |
| Wait at *Absenden* (`client.submit.success`) | median **86 s**, p90 170 s, max **267 s** | Worker stands next to the customer for minutes → B1 |
| Draft saves vs submits | **8 saves for 21 submits** | Most jobs live **only in phone RAM** until submit → A1/A2 |
| Server-side submit failures | 0 | Server path is solid; the risk is the client |
| Client errors | 161, all noise: `Script error.` (84), `window.ethereum` (22), `__firefox__` (34), `prompt() is not supported` (21) | Real errors would be invisible → C1 |

### Gaps in the code

| Gap | Where | Effect |
|---|---|---|
| No local persistence; no `beforeunload`; no service worker | `public/app.js` (only `localStorage` use is demo presets) | iOS often reloads a tab after camera use → photos, checkboxes and **customer signature** lost silently |
| No offline detection, no fetch timeout, no `AbortController` | `saveForm` in `public/app.js` | On bad LTE the button stays grey indefinitely |
| Single toast, auto-hides after 3.5 s, errors included | `showToast` at the end of `public/app.js` | Errors missed |
| Raw technical error text shown | `parseJsonResponse` (`Unerwartete Server-Antwort (HTTP 502): <html…>`, `Load failed`) | Worker can't act on it |
| No progress during the 1–4 min submit | `saveForm` only disables buttons | "Is it frozen? Press again?" |
| `UPLOAD_MAX_MB` exists in `.env` but is never read | `routes/form.js` `multer({ storage })` has no `limits` | Huge video fails late with unclear error |
| No SIGTERM handling | `server.js` | A deploy can cut off an in-flight submit (Bitrix sent, Mongo not committed → duplicates on retry; see log event `submit.edge.bitrix_sent_before_mongo_commit`) |
| CI deploys without tests | `.github/workflows/fly-deploy.yml` | Broken change can go live |
| Raw phone video kept forever; ffmpeg output deleted after Bitrix push | `services/stepDocuments.js` (`fs.rmSync(outputPath)` after compression) | Volume (2 GB) fills fast |
| Testmodus password asked via `window.prompt` | `public/app.js` (several places) | Doesn't work in in-app/embedded browsers (cause of the 21 `prompt()` errors) |

### iOS platform constraints (verified)

- **No Background Sync / Periodic Sync / Background Fetch on iOS.** Retrying must happen while the page is open, or on the next open. Do not design anything that relies on the phone sending later by itself.
- **IndexedDB works and can store `Blob`/`File`**, but Safari's ITP deletes script-writable storage after **7 days without interaction**. Apps added to the **Home Screen** are exempt. Call `navigator.storage.persist()`.
- Sources: [MagicBell — PWA iOS limitations 2026](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide), [CODERCOPS — PWAs in 2026](https://blog.codercops.com/blog/progressive-web-apps-2026), [MDN — Storage quotas and eviction](https://developer.mozilla.org/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)

---

## What step 1 (done) changed — needed to build on it

Before: the client kept every picked `File` in `fileStore` forever, so every save and the final submit re-uploaded everything, creating orphaned files on the volume.

Now (`public/app.js`):
- `fileStore` — `{ field: File[] }` files picked but **not yet saved**.
- `existingFileStore` — `{ field: "/uploads/…"[] }` files the server already has.
- `pendingFileRefs` — `{ field: { file, url }[] }` one ref per fresh thumbnail; `url` is filled in after a save so the ✕ button removes the right thing.
- `adoptSavedFiles(json.data)` — after a successful `/save`, moves fresh files into `existingFileStore` using the URLs from the response. **Count guard:** if `urls.length !== existing + fresh` (or `!== 1` for single-file fields like `videoDesAblaufs`), it keeps the files in `fileStore` (old re-upload behaviour) and logs `client.save.adopt_skipped`.
- Server: `mergeUploadedFiles` (`routes/form.js`) appends new upload URLs after the URLs the client sends. The client relies on that order. `/save` returns the full document as `json.data` (`buildSuccessResponse`).
- `/client-log` has an **allowlist** of event names (`routes/form.js`). Any new client event must be added there or it is rejected with 400.

Verified end-to-end on production (2026-10-02, deal 65278): saves uploaded 3 → 1 → 1 images (old behaviour: 3 → 4 → 5); all 12 attachments (6 media + 6 PDFs) arrived on the Bitrix timeline; no `adopt_skipped`.

---

## Phase A — Nothing gets lost

### A1 · Auto-save on the phone *(done — see "As built" below)*
- Persist form state locally on every change: field values, signatures (data URLs), `existingFileStore`, and **fresh `File` blobs** from `fileStore` (IndexedDB stores Blobs; `localStorage` cannot).
- Key the local record by deal/`terminId` + form type, plus `formId`/`shareToken` once known.
- On load: if a local record exists that is newer than the server draft, offer to restore it: *"Ihr Stand von 10:42 wurde wiederhergestellt."* Never silently overwrite a server draft.
- Delete the local record after a successful submit.
- Debounce writes (e.g. 500 ms) and write signatures on pad `endStroke`.
- Restoring must re-create thumbnails through the same code paths as today (`addFiles` for fresh files, the `loadFormData` loop for saved URLs) so `pendingFileRefs` stays consistent.
- Watch out: signature pads are re-applied after canvases are sized (`signaturePadDataUrls` cache, `drawSignatureFitted`) — restore must use that path, not draw directly.
- Acceptance: fill steps 1–3 with photos and a signature, reload the tab (or kill Safari), reopen → everything is back, with no network involved.

**As built (`b6306dd`, `public/app.js` section "Local auto-save (IndexedDB)"):**
- DB `bauFormular` v1, stores `forms` (key = `location.pathname + location.search`, i.e. per `?dealId`; workers normally open the form from the Bitrix link with `dealId`) and `files` (key = `<formKey>|<id>`, each picked `File` written **once**, tracked via a `WeakMap`; blobs of removed/adopted thumbnails are pruned on each snapshot).
- Record: `{ data: collectFormData(), files: {field: [fileId]}, step, formId, shareToken, dirty, serverSavedAt, savedAt }`.
- `scheduleLocalSave()` (500 ms debounce) runs from `markFormDirty`, `showStep`, pad `endStroke`, after a successful `/save`; flushed on `visibilitychange → hidden`. Skipped on step 0 and for untouched forms (`!hasUnsavedChanges && !formId`).
- `restoreLocalSnapshot(serverData)` in `init` after `loadDraftIfNeeded` (which now returns the draft data or `null`): server draft with `updatedAt >= savedAt` wins and the local record is deleted; otherwise `resetFormState` → `populateForm` → `addFiles(..., multi=true)` → `showStep(record.step)` + toast *"Ihr Stand von HH:MM wurde wiederhergestellt."*. The `?dealId` Bitrix autofill is skipped when restored.
- `deleteLocalSnapshot()` after successful submit and on *Zurück zum Hauptmenü*.
- `collectFormData` now prefers `signaturePadDataUrls[name]` over the canvas (fixes lost signatures on hidden/still-painting pads).
- Client log events `client.local.restored` / `client.local.failed` (added to the `/client-log` allowlist).
- B2: `#saveStatus` (sticky, under the step indicator), `renderSaveStatus()`; texts: ⏳ Wird gespeichert / gesendet · ⚠ Sicherung auf dem Handy nicht möglich · ⚠ Kein Netz · ✓ Alles gespeichert · 💾 Auf dem Handy gesichert.
- **iPhone test (owner, 2026-10-02, iOS 18.7, Safari + Brave):** A2 silent saves (each file once, incl. a 57 MB `.mov`), A3 airplane mode → *Absenden* → sent 14–16 s after the click, exactly one Abnahme, Bitrix `sent` (video 57 MB → 1.2 MB). `storage.persist()` denied on both (36–39 GB free; iOS grants it mostly to Home Screen apps, no prompt). Restore after killing Safari left no log entry (no `client.local.restored` / `client.draft.loaded_by_deal`), so that step is not confirmed by logs.
- Brave on iOS injects scripts that raise 8 `client.error` entries per page load (`__firefox__`, `window.ethereum`, `Script error.`) → C1. Known limit: pages without `?dealId` share one record per form type (rare). No "Verwerfen" button; *Zurück zum Hauptmenü* discards.

### A2 · Background sync to the server
- After each step change and after each photo/video is added, run a silent `/save` (no modal) when online. Reuses the step 1 adoption, so each file goes up once.
- Must not open the draft-name modal or show the big toast; feed the status line (B2) instead.
- Serialise saves (the existing `saveInProgress` flag); if a change happens during a save, schedule one more.
- Acceptance: a job where the worker never presses *Zwischenspeichern* still has a server draft with all media after step 3.

**A2 decisions (owner, 2026-10-02):**
- Triggers: step change (immediately), photo/video added (after 3 s), back online, tab hidden. Text-only edits ride along with the next step change.
- Silent: no draft-name modal, no toast, buttons stay usable; only the status line (B2) changes. Failures are logged once per streak (`client.autosave.failed`) and retried on the next trigger.
- **Fix needed first:** `adoptSavedFiles` must only adopt the files that request actually sent (a photo added or removed during an upload otherwise trips the count guard). Dirty state is cleared only if nothing changed during the save (`changeSeq`).
- *Absenden* / *Zwischenspeichern* during an auto-save wait for it instead of failing with "Speichern läuft bereits".
- No auto-save once a submit is queued (A3) or done, otherwise a late save would recreate a draft from the submitted Abnahme.
- Request timeout: 60 s + 1 s per 125 KB sent (≈ 1 Mbit/s floor), for auto-save and submit.
- **Continue the server draft by deal:** workers always open the form via the `?dealId=` link (Bitrix automation → field → FortyTools); currently only `/AbschlussderBaustelle`. On load without a newer local copy, `GET /api/form/drafts/by-deal/:dealId` loads the newest Baustellenabnahme draft for that deal ("Gespeicherter Stand von HH:MM geladen."), so a second phone or a lost local copy does not start a second draft.
- **Draft cleanup:** drafts **created on/after 2026-10-02** and untouched for 30 days are deleted daily with their files (files still referenced by an Abnahme or another draft are kept). Older drafts are never touched. Logged as `draft.cleanup.*`.

### A3 · Outbox for submit
- If *Absenden* happens offline or fails on the network, store the submit intent locally and show: *"Kein Netz – wird automatisch gesendet, sobald Empfang da ist. Bitte Seite offen lassen."*
- Retry on the `online` event, on `visibilitychange` back to visible, on page load, and with backoff while the page is open (no Background Sync on iOS).
- The server must make submit **idempotent** per draft (e.g. a client-generated submit id stored on the Abnahme) so a retry after a lost response cannot create a second Abnahme or a second Bitrix post.

**A3 decisions (owner, 2026-10-02):**
- Queue only on network failure (fetch error, timeout, HTTP 502/503/504). Validation errors (4xx) are shown as today.
- The outbox is the A1 record with `outbox: { submitId, queuedAt }`. A sender builds the request from the stored record (data + blobs), so it works from any page of the app, not only the open form.
- Retries: page load (any route), `online`, tab visible again, and 30 s → 1 → 2 → 5 min while open.
- **Editing stays allowed** while queued; each attempt sends the latest local state.
- `submitId` (`crypto.randomUUID()`) is created on the first *Absenden* and sent on every attempt, including the first direct one. Server: unique sparse index on `Abnahme.submitId`; a known `submitId` returns the existing Abnahme (`submit.duplicate_ignored`), also when two attempts race (E11000).
- Status line: *📤 Kein Netz – wird automatisch gesendet, sobald Empfang da ist. Bitte Seite offen lassen.*
- Known limit: `client.outbox.queued` is logged while offline and therefore usually lost; `client.outbox.sent` carries the delay since the click instead.
- **Found on live (fixed):** `indexedDB.open()` can stay pending forever (e.g. another tab blocks a pending delete; WebKit has similar glitches). Because `init` awaits the local restore, the form then hung on step 0. `openLocalDb` now gives up after 3 s; the form loads without local backup and the status line warns. Verified locally and on live with two tabs (form loads after ~3 s with the warning).
- Testing tip: on live, simulate "no signal" by wrapping `window.fetch` in the tab to reject `/api/form/submit` with `TypeError('Load failed')`, then restore it and dispatch `online`. Close other tabs of the same origin before deleting the IndexedDB, or the delete blocks every open.
- Testing tip: stopping the local server (`preview_stop`) while the page is open simulates "no signal"; restarting it via `preview_start` reloads the tab to `/`, which also exercises sending from another page.

### A4 · Keep local data *(reduced, decided 2026-10-02)*
- **Built:** `requestPersistentStorage()` at the end of `init` asks `navigator.storage.persist()` on every page load and logs once per tab session `client.storage.persist` (*Speicher dauerhaft: granted/denied/unsupported · belegt X MB von Y MB · Home-Bildschirm-App: ja/nein*, plus the user agent in `context.browser`). Use these logs to see how many phones grant it and whether workers use Safari or FortyTools' in-app browser.
- **Dropped: manifest + "Zum Home-Bildschirm".** Workers always open jobs via the deal link from FortyTools; on iOS links from other apps open in Safari / the in-app browser, never in a Home Screen app, and a Home Screen app has its own separate storage. So it would not protect the data of jobs opened via the link.
- Why the 7-day ITP eviction is no longer a real risk: since A2 a job is on the server within seconds; the local copy only matters until the first save, or for a queued submit (A3) left more than 7 days without opening the app.

## Phase B — The worker always knows what's happening

### B1 · Fast green: Bitrix push in the background
Today `/submit` (`routes/form.js`) does, inside one request: recovery draft → PDFs + ffmpeg + Bitrix upload (`trySendDocumentToBitrix`, 60 s timeout, 3 attempts with 10 s pause, then 8 MB batch fallback) → Mongo transaction → chat notify → **n8n Abnahme-Check** → response.

Target:
1. Recovery draft (unchanged) → Mongo transaction creates the Abnahme with `bitrixStatus: 'pending'` and deletes the draft → **respond 200 immediately**.
2. After the response, in the same process: Bitrix push → set `bitrixStatus: 'sent' | 'failed'` + `bitrixError` + `bitrixSync` summary → chat notify → n8n Abnahme-Check.
- Schema: add `bitrixStatus` (`pending`/`sent`/`failed`), `bitrixError`, `bitrixSentAt` to `models/Abnahme.js` (shared factory `createAbnahmeSchema`, so also on Entwurf — harmless).
- **n8n Abnahme-Check dependency:** it currently runs after `notifyBaustellenabnahmeChat('submitted', …)` and uses `bitrixSync.attachmentSummary` and the returned chat id. It must move into the background step, after the Bitrix push.
- Guard against double sending: the background push and the admin re-push (`/admin/push`, "Bitrix Neu-Push") only run when `bitrixStatus !== 'sent'`.
- This closes the `submit.edge.bitrix_sent_before_mongo_commit` window, because Mongo commits first.
- Infra: requires the machine to stay up. Already done on `main`: `fly.toml` has `auto_stop_machines = 'off'`, `min_machines_running = 1`.
- **Automatic retry (decided 2026-10-02):** the push's own retry (3 × 60 s + 8 MB batch fallback) can still fail after the worker already saw green. A timer in the server (every 10 min + once at startup) picks up Abnahmen that are `failed`, or `pending` with no push running in this process, whose last attempt is > 10 min old, and runs the same push again.
  - Fields: `bitrixAttempts` (incremented at the **start** of each attempt, so a push that crashes the process still counts) and `bitrixLastAttemptAt`.
  - Max 4 attempts in total (1 at submit + 3 automatic). Then `bitrixStatus: 'failed'` is final and a C2 chat alert asks the office to use Bitrix Neu-Push.
  - Every attempt is logged with the existing `submit.bitrix.*` events plus `submit.bitrix.auto_retry.*`; nothing is removed from the audit log.
  - This also covers a process restart during a push: the Abnahme stays `pending`, the timer picks it up after 10 min.
  - Single machine: an in-memory set of running pushes prevents two pushes of the same Abnahme. Needs a DB lock if we ever run > 1 machine.
- **„Komplett neu senden“** (Neu-Push panel, after *Laden*): `POST /api/form/admin/resend-full` runs exactly the same push as after submit (text, files, PDFs, deal fields, Hinweis, 🟢 chat, n8n), `trigger: admin`. Only for submitted Abnahmen, refused while a push runs or when already `sent`. The 🔴 final-failure alert points to this button. *Laden* now also shows `bitrixStatus`, attempts and the last error. (The old „Zu Bitrix senden“ only posts selected files with a short comment.)
- Admin re-push guard: a manual Neu-Push is refused while an automatic push of that deal is running. A successful Neu-Push sets `bitrixStatus: 'sent'`, which stops automatic retries (the office fixed it by hand). Not blocked when already `sent`, because Neu-Push is also used to send missing files (e.g. video) afterwards.
- Retries use the stored Abnahme document as payload (same as Neu-Push); the first push uses the in-memory request data.
- Client: on 200 show the receipt (B5), not "an Bitrix gesendet" — the Bitrix result is not known yet.
- Tests in `__tests__/routes.form.test.js` that assert Bitrix-before-response must be rewritten.

### B2 · Permanent status line *(with A1)*
One always-visible line (like Google Docs): *"✓ Alles gespeichert · 10:42"*, *"⏳ 2 Fotos werden hochgeladen"*, *"💾 Auf dem Handy gesichert – wird hochgeladen, sobald Empfang da ist"*, *"⚠ Kein Netz"*. Driven by A1/A2/A3 state and `navigator.onLine`.

### B3 · Upload progress
`fetch` cannot report upload progress; use `XMLHttpRequest` with `upload.onprogress` for save/submit. Show *"Foto 3 von 5 wird hochgeladen…"* / a percentage.

### B4 · Plain-German, persistent messages
- Replace raw texts (`HTTP 502`, `Load failed`, `Failed to fetch`, `Unerwartete Server-Antwort…`) with messages that say what happened, that the data is safe (when it is), and one action: *"Senden hat nicht geklappt. Ihre Daten sind sicher. [Erneut versuchen]"*.
- Errors stay until dismissed (today `showToast` hides everything after 3.5 s).
- Keep the technical detail in the client log, not on screen.

### B5 · Receipt screen after submit
*"Abnahme übermittelt ✓ – Sie können das Handy jetzt weglegen."* Show customer name, deal number, time. Optional: later status (gesendet an Bitrix) for the office view.

### B6 · Timeouts + retry
`AbortController` timeout on every API call; automatic retry with backoff for `/save`; never leave a button disabled without a visible reason.

### B7 · File size check at pick time
Read `UPLOAD_MAX_MB` (currently unused) into multer `limits`, expose the limit to the client, and reject at pick time: *"Video zu groß (900 MB) – bitte kürzer aufnehmen."*

## Phase C — The office sees everything

- **C1** Drop known noise in `/client-log` before persisting: `Script error.`, `window.ethereum`, `__firefox__`, and similar extension-injected errors. Keep a counter if useful.
- **C2** Post real errors and failed background pushes to the Bitrix chat with deal number and customer name (reuse `postChatMessage` / `notifyBaustellenabnahmeChat` in `routes/form.js`).
  - Every chat message carries **direct links**, so nobody has to search: 🔗 the Bitrix deal (`/crm/deal/details/<id>/`) and 📝 the form itself (`<APP_BASE_URL>/form/<shareToken>`, default `https://bau-formular.fly.dev`).
  - Final push failure (after all automatic retries) → 🔴 alert for **every** form type, not only Baustellenabnahme (otherwise failed pushes of other types would be silent now that the worker sees green). Text says what to do: *Bitte im Testmodus „Bitrix Neu-Push“ mit Auftrag-ID ausführen.*
  - Client-side real errors → after C1 (noise filter), otherwise the chat gets spammed.
- **C3** Admin panel: filter logs by deal/draft id to show one job's full timeline (logs already carry `bitrixAuftragId`, `draftId`, `formId`).
- **C4** `models/OperationLog.js` has a 30-day TTL on everything. Keep `submit.*`, `draft.save.*`, `bitrix.*` events longer (separate TTL or collection). Make "Logs löschen" require a confirmation phrase or remove it.
- **C5** Handle `SIGTERM`/`SIGINT` in `server.js`: stop accepting requests, wait for in-flight submits/background pushes (with a cap), then exit. Check Fly `kill_timeout`.
- **C6** Add `npm ci && npm test` before `flyctl deploy` in `.github/workflows/fly-deploy.yml`.
- **C7** Volume `bau_uploads` (2 GB). **Measured 2026-10-02** (`fly ssh console -C "df -h /data"`): 514 MB used (28 %), 308 files; 17 videos > 10 MB = 426 MB (83 %); 15 files older than 30 days = 81 MB.
  Today photos are compressed on upload (`compressUploadedFile`, replaced in place as `.jpg`), but videos are kept as sent by the phone and only compressed at Bitrix push time (`optimizeVideoBuffer`), where the output is deleted afterwards.
  **Decisions (owner, 2026-10-02):**
  1. **Compress videos on upload** in `uploadAny`, same ffmpeg settings as for Bitrix (≤ 1280×720, CRF 30); the `.mp4` replaces the original and `file.filename` is updated before `mergeUploadedFiles`, so drafts/Abnahmen reference the compressed file. Originals are **not** kept. Mark it like images (`uploadTimeCompressed`) so the Bitrix push skips re-encoding. Cost: a save with a video takes ~30 s longer on the server (runs in the A2 background save).
  2. **Daily orphan cleanup** (`cleanupOrphanUploads`) on the background-job timer, with a new **minimum age of 24 h** (file mtime) so files of uploads in flight are never deleted. Logged.
  3. **Volume alarm:** daily `statfs` on the uploads dir; above 80 % → 🔴 Bitrix chat message with usage (C2 style), logged.
  - Not done: the 17 existing videos stay as they are (owner). No automatic age-based deletion; "Alte Dateien löschen" stays a manual button (owner).
  - Forecast after C7: ~5 MB per job, ~100 MB/month at current volume → > 1 year of headroom.
  - **As built:** `compressUploadedVideo` in `services/stepDocuments.js` (shared `videoFfmpegArgs`; temp file `.upload-*`, renamed to `<name>.mp4`, falls back to the original on any error); `runDailyMaintenance` in `routes/form.js` = `cleanupExpiredDrafts` → `cleanupOrphanFiles` (24 h min age, `storage.orphans.*`) → `checkVolumeUsage` (`storage.volume.alarm` + chat). Runs 60 s after start and every 24 h.

## Out of scope for now
Native app (Home Screen PWA is enough) · Tigris/R2 object storage (`docs/TODO.md`; only if the volume still runs short after C7; Tigris free tier is 5 GB, $0.02/GB after, no egress fees) · server-side job queue (only if background pushes actually get lost).

---

## Working notes for the next session

### Local dev in a worktree
- `.env` is gitignored and **not** copied into new worktrees. Copy it from the main checkout: `cp /Users/digital_neu/Documents/GitHub/bau-formular/.env .env`.
- ⚠️ That `.env` points at the **production MongoDB** and the **live Bitrix webhook**. Local `/save` creates real drafts; local `/submit` posts to real Bitrix deals and the real chat. Only submit against the test deal.
- Use a free port and allow it for CORS: set `PORT=3007` and add `ALLOWED_ORIGINS=http://localhost:3007` (the default CORS list only contains port 3000). `node --watch` does **not** reload `.env` — restart the server after editing it.
- Local uploads go to `./uploads` in the worktree (production uses `/data/uploads` on the Fly volume).

### Testing
- `npm test` — 74 tests, all green (as of `b6306dd`). If old worktrees exist under `.claude/worktrees/`, plain `npm test` also picks up their copies and shows ~35 unrelated failures; run `npx jest --runInBand --watchman=false --testPathIgnorePatterns /.claude/`.
- Local server for the in-app browser: `.claude/launch.json` (untracked) starts `PORT=3007 ALLOWED_ORIGINS=http://localhost:3007 node server.js`. Local client logs go to the **production** OperationLogs.
- `public/app.js` is a single IIFE with no exports; client logic can't be unit-tested directly. Verify client changes in a real browser.
- **Test deal: `65278` — Stefan Wolfrum** (`/AbschlussderBaustelle?dealId=65278` pre-fills step 1). Use it for any end-to-end submit. Put a "TESTLAUF – bitte ignorieren" note in *Hinweise für das Büro*. Kept on purpose: test Abnahmen `6abf7207d8e9ae2c375c6b8a` (B1), `6abf8217d36c55305dcefa56` (A3 local) `6abf8f4282c15f31f67a064a` (A3 live) and `6abf9a8a48193d3ffd89683c` (iPhone Brave test), all 2026-10-02, on this deal; plus `6abf997248193d3ffd89680a` (iPhone Safari test with demo data, no deal, Bitrix `skipped`).
- In the browser, test media can be generated on a `<canvas>` (photos via `toBlob`, video via `MediaRecorder` on `canvas.captureStream()`) and handed to the file inputs with a `DataTransfer` — the form treats them exactly like gallery picks.
- The Claude Code integrated browser blocks `window.prompt`, so Testmodus cannot be switched on there. Use Claude in Chrome, and let the owner enter the Testmodus password in that tab (it lives in `sessionStorage`, per tab). Never type the password yourself on production.
- Bitrix timeline can be read (read-only) with the app's own `BITRIX_WEBHOOK_BASE` from `.env`: `crm.timeline.comment.list` filtered by `ENTITY_ID`/`ENTITY_TYPE=deal`, then `crm.timeline.comment.get` for `FILES`.

### Deploy
- Push to `main` → GitHub Actions → `flyctl deploy --remote-only`. **No tests run** (until C6).
- Manual deploy from a worktree: `fly deploy --remote-only` deploys the working tree; `.env` is excluded by `.dockerignore`. A later push to `main` overwrites it.
- Rollback: `fly releases --image`, then `fly deploy --image <previous-image-ref>`.
