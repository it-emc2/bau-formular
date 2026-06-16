const fs = require('fs/promises');
const path = require('path');

const Abnahme = require('../models/Abnahme');
const Entwurf = require('../models/Entwurf');
const { getUploadsDir } = require('./uploadsPath');

const UPLOAD_URL_PREFIX = '/uploads/';

function formatBytes(bytes) {
  if (!bytes) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function normalizeUploadReference(value) {
  if (typeof value !== 'string') return null;

  const index = value.indexOf(UPLOAD_URL_PREFIX);
  if (index === -1) return null;

  const rawPath = value
    .slice(index + UPLOAD_URL_PREFIX.length)
    .split(/[?#]/, 1)[0];

  if (!rawPath) return null;

  const decodedPath = decodeURIComponent(rawPath);
  const normalizedPath = path.posix.normalize(decodedPath).replace(/^\/+/, '');

  if (!normalizedPath || normalizedPath.startsWith('../') || normalizedPath === '..') {
    return null;
  }

  return normalizedPath;
}

function collectUploadReferences(value, references) {
  const normalizedPath = normalizeUploadReference(value);
  if (normalizedPath) {
    references.add(normalizedPath);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach(item => collectUploadReferences(item, references));
    return;
  }

  if (value && typeof value === 'object') {
    Object.values(value).forEach(item => collectUploadReferences(item, references));
  }
}

async function collectReferencesFromModel(Model, references) {
  let count = 0;
  const cursor = Model.find({}).lean().cursor();

  for await (const doc of cursor) {
    count += 1;
    collectUploadReferences(doc, references);
  }

  return count;
}

async function listStoredFiles(rootDir, currentDir = rootDir) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listStoredFiles(rootDir, fullPath));
      continue;
    }

    if (!entry.isFile()) continue;

    const stats = await fs.stat(fullPath);
    const relativePath = path
      .relative(rootDir, fullPath)
      .split(path.sep)
      .join(path.posix.sep);

    files.push({
      relativePath,
      fullPath,
      size: stats.size,
      sizeLabel: formatBytes(stats.size),
      modifiedAt: stats.mtime,
    });
  }

  return files;
}

async function buildOrphanUploadsReport({ uploadsDir = getUploadsDir() } = {}) {
  const references = new Set();
  const abnahmeCount = await collectReferencesFromModel(Abnahme, references);
  const entwurfCount = await collectReferencesFromModel(Entwurf, references);

  let storedFiles = [];
  try {
    storedFiles = await listStoredFiles(uploadsDir);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  const orphanFiles = storedFiles
    .filter(file => !references.has(file.relativePath))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const totalBytes = orphanFiles.reduce((sum, file) => sum + file.size, 0);

  return {
    uploadsDir,
    databaseName: process.env.MONGODB_DB || null,
    documentsScanned: {
      abnahmen: abnahmeCount,
      entwuerfe: entwurfCount,
    },
    referencesFound: references.size,
    storedFiles: storedFiles.length,
    orphanFiles,
    orphanCount: orphanFiles.length,
    totalBytes,
    totalBytesLabel: formatBytes(totalBytes),
  };
}

async function cleanupOrphanUploads({ deleteFiles = false, uploadsDir = getUploadsDir() } = {}) {
  const report = await buildOrphanUploadsReport({ uploadsDir });

  if (deleteFiles) {
    for (const file of report.orphanFiles) {
      await fs.rm(file.fullPath, { force: true });
    }
  }

  return {
    ...report,
    deleted: Boolean(deleteFiles),
    deletedCount: deleteFiles ? report.orphanCount : 0,
    deletedBytes: deleteFiles ? report.totalBytes : 0,
    deletedBytesLabel: deleteFiles ? report.totalBytesLabel : '0 B',
  };
}

async function getDraftFileReferences() {
  const references = new Set();
  await collectReferencesFromModel(Entwurf, references);
  return references;
}

module.exports = {
  cleanupOrphanUploads,
  getDraftFileReferences,
  formatBytes,
};
