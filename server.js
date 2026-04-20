require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');

const formRoutes = require('./routes/form');
const bitrixRoutes = require('./routes/bitrix');

const app = express();
const PORT = process.env.PORT || 3000;
const externalOffersOrigin = process.env.EXTERNAL_OFFERS_API_BASE_URL || 'https://angebotskonfigurator-emc2-v2.fly.dev';
const defaultAllowedOrigins = [
  'https://bau-formular.fly.dev',
  'https://angebotskonfigurator-emc2-v2.fly.dev',
  'http://localhost:3000',
];
const allowedOrigins = [...new Set([
  ...defaultAllowedOrigins,
  ...(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean),
])];

function corsOrigin(origin, callback) {
  if (!origin) return callback(null, true);
  if (!allowedOrigins.length) return callback(null, true);
  if (allowedOrigins.includes(origin)) return callback(null, true);
  return callback(new Error(`Origin ${origin} not allowed by CORS`));
}

// ── Middleware ──────────────────────────────────────────────
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
app.use(cors({
  origin: corsOrigin,
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Routes ─────────────────────────────────────────────────
app.use('/api/form', formRoutes);
app.use('/api/bitrix', bitrixRoutes);

app.use((err, req, res, next) => {
  if (!err) return next();

  console.error('API error:', {
    method: req.method,
    path: req.path,
    message: err.message,
    stack: err.stack,
  });

  if (req.path.startsWith('/api/')) {
    const status = err.status || err.statusCode || 500;
    return res.status(status).json({
      success: false,
      error: err.message || 'Internal Server Error',
      ...(process.env.NODE_ENV === 'production' ? {} : { stack: err.stack }),
    });
  }

  return next(err);
});

// Serve the SPA for root and shareable links
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/home', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/AbschlussderBaustelle', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/BeauftragungzusatzlicheLeistungen', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/Nachbesserung', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/Schadensmeldung', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/form/:token', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

async function startServer() {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bau-formular';
    const mongoOptions = {};

    if (process.env.MONGODB_DB) {
      mongoOptions.dbName = process.env.MONGODB_DB;
    }

    await mongoose.connect(mongoUri, mongoOptions);
    console.log('✅  MongoDB verbunden');
    return app.listen(PORT, () => console.log(`🚀  Server läuft auf http://localhost:${PORT}`));
  } catch (err) {
    console.error('❌  MongoDB Verbindungsfehler:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, corsOrigin };
