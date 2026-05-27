# Environment Variables and Deployment

## Environment Variables

The application uses `dotenv` to load environment variables from a `.env` file in the project root.

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `MONGODB_URI` | MongoDB connection string | `mongodb+srv://user:pass@cluster.mongodb.net/` |

### Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |
| `MONGODB_DB` | _(from URI)_ | Database name override |
| `BITRIX_WEBHOOK_BASE` | _(empty)_ | Bitrix24 webhook base URL. If empty, Bitrix features throw errors. |
| `TESTMODUS_PASSWORD` | _(empty)_ | Password required to enable Testmodus in the frontend. If empty, Testmodus cannot be enabled. |
| `SMTP_HOST` | _(empty)_ | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_SECURE` | _(empty)_ | Set to `"true"` for TLS. Auto-enabled for port 465. |
| `SMTP_USER` | _(empty)_ | SMTP authentication username |
| `SMTP_PASS` | _(empty)_ | SMTP authentication password |
| `SMTP_FROM` | _(empty)_ | Sender email address |
| `ARBEITSBERICHT_PDF_URL` | `https://angebotskonfigurator-emc2-v2.fly.dev/api/arbeitsbericht/pdf` | External PDF generation endpoint |
| `EXTERNAL_OFFERS_API_BASE_URL` | `https://angebotskonfigurator-emc2-v2.fly.dev` | External offers API base (used for CSP connect-src) |
| `ALLOWED_ORIGINS` | _(empty)_ | Additional CORS origins, comma-separated |
| `NODE_ENV` | _(empty)_ | Set to `production` in Docker. Hides error stack traces in responses. |

### Local vs Production Database

Local development and Fly.io production should use different MongoDB database names even when they use the same MongoDB cluster.

Recommended setup:

```env
# Local .env
MONGODB_DB="BauDB-test"
```

```env
# Fly.io / production
MONGODB_DB="BauDB"
```

This keeps local drafts and production drafts separated. It is especially important because upload references are stored in MongoDB as `/uploads/...` paths, while the actual files are stored on the filesystem of the environment that received the upload.

### SMTP Configuration

Email sending requires both `SMTP_HOST` and `SMTP_FROM` to be set. If either is missing, the app falls back to generating `mailto:` URLs that open the user's local email client.

Full SMTP config example:
```env
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply@emc2.de
SMTP_PASS=secretpassword
SMTP_FROM=noreply@emc2.de
```

## Deployment

### Fly.io Configuration

The app is deployed on [Fly.io](https://fly.io) in the Frankfurt (fra) region.

**`fly.toml`:**
```toml
app = 'bau-formular'
primary_region = 'fra'

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = 'stop'
  auto_start_machines = true
  min_machines_running = 0

[[vm]]
  memory = '1gb'
  cpus = 1
```

Key settings:
- **auto_stop_machines**: Machines stop when idle (cost saving)
- **auto_start_machines**: Machines start on incoming requests
- **min_machines_running = 0**: All machines can be stopped (cold start possible)
- **force_https**: All HTTP redirected to HTTPS

### Docker Build

**`Dockerfile`:**
```dockerfile
# Build stage
FROM node:24.11.1-slim AS build
RUN apt-get install build-essential node-gyp pkg-config python-is-python3
COPY package*.json ./
RUN npm ci
COPY . .

# Production stage
FROM node:24.11.1-slim
COPY --from=build /app /app
EXPOSE 3000
CMD ["npm", "run", "start"]
```

Multi-stage build:
1. **Build stage**: Installs native build tools and runs `npm ci` (includes devDependencies for native modules)
2. **Production stage**: Copies the full `/app` directory (node_modules included)

### CI/CD Pipeline

**`.github/workflows/fly-deploy.yml`:**
```yaml
name: Fly Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    concurrency: deploy-group
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

- Triggers on every push to `main`
- Uses `--remote-only` to build the Docker image on Fly.io's builders
- `concurrency: deploy-group` ensures only one deployment runs at a time
- Requires `FLY_API_TOKEN` secret in GitHub repository settings

### File Storage Caveat

Uploaded files are stored on disk and exposed through the `/uploads/...` URL path.

- Locally, files are stored in `uploads/` unless `UPLOADS_DIR` is set.
- On Fly.io, `fly.toml` sets `UPLOADS_DIR=/data/uploads`.
- The Fly volume `bau_uploads` is mounted at `/data`, so production uploads are persistent across app restarts.
- Relative `UPLOADS_DIR` values such as `./uploads` are resolved from the repository/app root, so all upload readers and writers use the same physical folder.
- The upload route recreates the uploads directory before writing each incoming file. If a local `uploads/` folder or Fly `/data/uploads` directory is missing, the next upload request creates it automatically.

MongoDB stores upload references as URL paths such as `/uploads/filename.png`; it does not store the physical disk path. If local and production share the same MongoDB database, local uploads can create Mongo records whose files exist only in the local `uploads/` directory, not on the Fly volume.

Deleting the uploads directory removes the physical media files only. Existing drafts/submissions may still open because their form data is in MongoDB, but image/video previews and exports for those records will be missing unless the files also exist in the active uploads directory.

### Cleaning Orphan Uploads

Use `scripts/cleanup-orphan-uploads.js` to find uploaded files that exist on disk but are no longer referenced by either MongoDB collection:

- `Abnahmen`
- `Entwürfe`

The script is safe by default. Without `--delete`, it only prints a dry-run report.

The same cleanup is also available in the app UI for password-gated Testmodus/admin users:

1. Open the hosted Fly.io app.
2. Enable Testmodus with the admin password.
3. Click **Orphan Uploads prüfen**.
4. Review the reported database, uploads directory, orphan count, and file list.
5. Click **Orphan Uploads löschen** only after confirming the preview.

When used on Fly.io, the button checks production MongoDB (`BauDB`) against the Fly volume (`/data/uploads`). When used locally, it only checks the local `.env` database, for example `BauDB-test`, against the local `uploads/` folder.

### Admin Operation Logs

Save and submit diagnostics are stored in the MongoDB collection `OperationLogs` in the active database:

- local development writes to `BauDB-test`
- Fly.io production writes to `BauDB`

The app creates the collection automatically on the first save/submit log entry. Logs are visible only in Testmodus/admin mode via **Logs aktualisieren**. Entries include timestamp, deal/termin id, draft id, submitted form id, the completed step, and sanitized error details. Large payloads, signatures, and passwords are redacted before storage.

The collection has a 30-day TTL index on `createdAt`, so old diagnostic records are removed automatically by MongoDB.

#### Local Cleanup

Run this from the repository root:

```bash
node scripts/cleanup-orphan-uploads.js
```

Review the orphan list. To delete those local files:

```bash
node scripts/cleanup-orphan-uploads.js --delete
```

Local cleanup uses:

- `MONGODB_URI` and `MONGODB_DB` from `.env`, if present
- otherwise `mongodb://localhost:27017/bau-formular`
- `UPLOADS_DIR` from `.env`, if present
- otherwise `uploads/`

Be careful when local `.env` points to the production MongoDB. In that setup, the script compares production Mongo references against local files, which is useful for cleaning local test uploads but should not be confused with cleaning the Fly volume.

#### Fly.io Volume Cleanup

Deploy the current code first so the cleanup script exists in the running image:

```bash
fly deploy -a bau-formular
```

Open a shell on the Fly machine:

```bash
fly ssh console -a bau-formular
```

Run the dry-run from inside the machine:

```bash
cd /app
node scripts/cleanup-orphan-uploads.js
```

Review the printed list. To delete the orphan files from `/data/uploads`:

```bash
node scripts/cleanup-orphan-uploads.js --delete
```

The report includes:

- scanned Mongo document counts
- number of upload references found in MongoDB
- number of stored files
- orphan count
- total space that would be freed

To inspect the volume manually:

```bash
ls -lah /data/uploads
```

## Development Setup

```bash
# Install dependencies
npm install

# Create .env file with at minimum:
echo "MONGODB_URI=mongodb://localhost:27017/bau-formular" > .env

# Start development server (auto-reload on file changes)
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

The dev server uses Node.js `--watch` flag for auto-reloading on file changes (no nodemon needed).

## Testing

### Test Framework

- **Jest** (v29.7.0) — test runner and assertion library
- **Supertest** (v7.2.0) — HTTP assertion for Express routes
- Custom Jest runner: `scripts/run-jest.js` wraps Jest to pass CLI args

### Test Configuration (`jest.config.js`)

```javascript
module.exports = {
  testEnvironment: 'node',
  clearMocks: true,
  watchman: false,
  collectCoverageFrom: [
    'server.js',
    'routes/**/*.js',
    'models/**/*.js',
  ],
};
```

### Test Files

| File | Tests |
|------|-------|
| `__tests__/server.test.js` | Express app setup, middleware, MongoDB connection |
| `__tests__/routes.form.test.js` | Form CRUD endpoints, email, document generation |
| `__tests__/routes.bitrix.test.js` | Bitrix proxy endpoints |
| `__tests__/abnahme.model.test.js` | Mongoose schema validation |
| `__tests__/stepDocuments.test.js` | PDF generation service |

### Test Mocking Pattern

Tests mock Mongoose models and external services:

```javascript
jest.mock('../models/Abnahme', () => ({
  create: jest.fn(),
  find: jest.fn(),
  findById: jest.fn(),
  findOne: jest.fn(),
}));

jest.mock('../services/bitrix', () => ({
  postTimelineComment: jest.fn(),
}));
```

Route handlers are tested by extracting them from the Express router stack and invoking directly with mock req/res objects, rather than using Supertest against the full Express app. This avoids needing a real MongoDB connection in tests.

## Security

### Helmet Configuration

```javascript
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "script-src": ["'self'", "https://cdn.jsdelivr.net"],
      "connect-src": ["'self'", externalOffersOrigin],
      "frame-src": ["'self'", "blob:"],
      "img-src": ["'self'", "data:", "blob:"],
      "media-src": ["'self'", "blob:"],
    },
  },
}));
```

- **script-src**: Only self and jsdelivr CDN (for SignaturePad)
- **connect-src**: Self and external offers API (for Arbeitsbericht)
- **frame-src**: Self and blob: URLs (for document preview iframes)
- **img-src**: Self, data: (for base64 signatures), blob: (for file previews)
- **media-src**: Self and blob: (for video previews)

### CORS

```javascript
app.use(cors({
  origin: corsOrigin,  // Whitelist-based origin check
  credentials: true,
}));
```

### File Upload Safety

- Multer disk storage with sanitized filenames
- Original filename stripped of non-alphanumeric characters
- Timestamp + random hex prefix prevents collisions
- No file type or size validation (50MB JSON body limit applies)
