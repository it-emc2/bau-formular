# bau-formular — Improvement Assessment

An honest review of the app, grounded in the actual code. First the storage question
(Fly volume vs. Bitrix Drive), then the full list of improvements.

---

## Why the Fly volume exists (and whether it should)

**Why it's there:** Fly machines have an ephemeral root filesystem and this app scales to
zero. Multer writes uploads to disk ([routes/form.js:29-39](routes/form.js#L29-L39)), and
those files must survive restarts because they're needed *later*:

- Drafts reference them by filename.
- The Bitrix push (and its 3-attempt retry + batch fallback) reads them back from disk.
- Admin re-push ([routes/form.js:1640](routes/form.js#L1640)) and ZIP export
  ([routes/form.js:1058-1071](routes/form.js#L1058-L1071)) need them.
- Video re-push does too.

Without a volume, a machine restart between draft-save and submit would silently lose every
photo. So the volume isn't wrong — it's the simplest durable store that doesn't add a
third-party dependency.

**Why not Bitrix Drive as the primary store?** You can't fully replace the volume with it,
because you need *somewhere* for multer to land the file and for sharp/ffmpeg to work on it
before it goes anywhere. But you absolutely should reconsider what happens **after submit** —
and here Bitrix Drive is genuinely better than what you have:

- Your current pain — the ≤8 MB base64 batching, the 60s timeout dance, and especially
  **files that exceed 8 MB base64 after compression getting silently skipped** — exists
  because you push everything inline into timeline comments. A compressed 720p CRF30 video
  over ~1 minute will regularly blow past ~6 MB real size and get dropped. That's a real
  product gap: the customer's walkthrough video just doesn't arrive in Bitrix.
- `disk.folder.uploadfile` supports a two-step flow: call it without `fileContent` and it
  returns an `uploadUrl` you POST the file to as **multipart (raw binary, no base64 bloat,
  much higher size ceiling)**. Upload each file to a per-deal Drive folder, then post one
  timeline comment linking the folder/files. No batching logic, no skipping, videos of any
  reasonable size arrive intact, and files live where your team already looks for deal
  documents.

**Recommendation — hybrid:**

1. Keep the volume, but demote it to a **staging area**: file lands, gets compressed, gets
   pushed.
2. After a *confirmed* Bitrix push, **delete the local files immediately** (keep only files
   referenced by open drafts). This replaces the 30-day cleanup cron/admin ceremony with
   event-driven cleanup, shrinks the volume to a fraction of its size, and makes the
   orphan-uploads tool nearly obsolete.
3. Push media to a Drive folder attached to the deal; keep the timeline comment as text +
   links (or small images inline).

If you'd rather not restructure the Bitrix side, the same "delete after confirmed push"
change alone is still worth doing.

---

## Every other improvement

### 🔴 Security (do these first)

1. **`/uploads` is served statically with zero auth** ([server.js:77](server.js#L77)).
   Customer photos, signed documents, and site videos are publicly reachable by anyone who
   knows/guesses a filename. Filenames are `timestamp-4randombytes-name` — 4 bytes of
   randomness is thin. At minimum use 16+ random bytes; better, serve files through an
   authenticated/tokenized route.
2. **Multer has no limits at all** (`multer({ storage })`,
   [routes/form.js:39](routes/form.js#L39)). Anyone can POST unlimited files of unlimited
   size to `/api/form/save` and fill your volume until the app falls over. Add
   `limits: { fileSize, files }` and a mimetype allowlist (images + video only).
3. **Verify admin endpoints are protected server-side.** Testmodus is a client-side gate via
   sessionStorage; if `POST /api/form/admin/*` routes don't independently verify the
   password/token per request, anyone can call orphan-cleanup, storage delete, and Bitrix
   push directly with curl. (Worth an explicit check — not confirmed present in the code read.)
4. **Share tokens never expire.** A leaked `/form/:token` link works forever. Consider expiry
   after submit + N days.
5. **Rate-limit** the dev-mode verify endpoint (password brute-force) and the save/submit
   endpoints.

### 🟠 Reliability — the biggest UX win for field workers

6. **Submit is fully synchronous** ([routes/form.js:1910](routes/form.js#L1910)): the worker
   stands on-site with the customer, taps "Absenden", and their phone waits through
   compression + up to 3×60s Bitrix attempts + batch fallback — potentially several minutes
   on a construction site's flaky LTE, and if their connection drops mid-wait they don't know
   if it worked. **Decouple it:** save to Mongo, respond "Gespeichert ✓" in ~2s, run the
   Bitrix push as a background job (persisted outbox document in Mongo with status), and show
   sync status on the form card. The admin re-push panel already proves the retry machinery
   works standalone — this is mostly reshuffling.
7. **Server-side idempotency for submit.** `saveInProgress` is client-only; a double-tap or
   retry after network timeout can create duplicate Abnahmen + duplicate Bitrix comments.
   Send a client-generated idempotency key.
8. **`uploadTimeCompressed` is an in-memory Set** — after a machine restart (which happens
   constantly with auto-stop/min 0), already-compressed images get re-compressed at push
   time. Persist the flag (e.g., a filename suffix like `-c.jpg` or a field in the DB record).
9. **Upload progress bars.** `fetch` gives you nothing; workers uploading 8 photos + a video
   on 2 bars of signal see a frozen button. Use XHR with `upload.onprogress` or streams.
10. **Offline resilience.** This is a field app — the single most valuable feature you could
    add: PWA with service worker + IndexedDB queue. Worker fills the form and captures photos
    with no signal in the basement; it syncs when they're back in the truck. Even a
    lightweight version (persist form state + files locally, retry submit automatically)
    prevents the worst failure mode: losing a signed form.

### 🟡 Efficiency

11. **Compress images client-side before upload** (canvas/`createImageBitmap` downscale to
    1600px). You're currently shipping 12 MP HEIC/JPEG originals over mobile data just to have
    sharp shrink them server-side. This cuts upload time and workers' data usage by ~80% and
    makes #9 less painful.
12. **Chunked/resumable video upload** for `videoDesAblaufs` — one dropped packet at 95% of a
    60 MB video currently restarts everything.

### 🟢 Code health

13. **Split `app.js`** (~3,500 lines). No build tool needed — native ES modules
    (`<script type="module">`) work fine: `state.js`, `steps.js`, `uploads.js`,
    `bitrix-sidebar.js`, `admin.js`, `drafts.js`.
14. **Kill the duplicated `documentLetter.js`.** Make `services/documentLetter.js` isomorphic
    (UMD-ish export) and serve the same file to the browser — the "must be synced manually"
    rule in CLAUDE.md is a standing invitation for drift bugs.
15. Consider **supertest** for route tests instead of the router-stack introspection helper —
    less brittle against Express internals.

### 🔵 Product polish

16. **Alerting instead of log-checking:** a failed Bitrix push currently sits in the admin log
    panel until someone looks. Send an email/Bitrix notification on final failure so re-push
    happens the same day, not when someone notices.
17. **Autosave drafts** every N seconds / on step change, so a killed browser tab on-site
    loses nothing.
18. **PWA manifest + icon** so workers install it on their home screen instead of hunting a
    bookmark.

---

## Suggested priority order

1. **#1 and #2** this week (small changes, real exposure).
2. **#6 + delete-after-push** (the volume question answers itself once files are transient).
3. **#10 / #11** as the field-worker experience upgrade.
