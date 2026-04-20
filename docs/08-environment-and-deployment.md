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

Uploaded files are stored on the server filesystem in `/uploads/`. On Fly.io with `auto_stop_machines`, the filesystem is **ephemeral** — files may be lost when machines restart. For production use, this should be migrated to a persistent volume or cloud storage (S3, etc.).

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
