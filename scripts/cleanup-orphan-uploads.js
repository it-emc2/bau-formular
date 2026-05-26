#!/usr/bin/env node

require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');

const Abnahme = require('../models/Abnahme');
const Entwurf = require('../models/Entwurf');
const { getUploadsDir } = require('../services/uploadsPath');

const SHOULD_DELETE = process.argv.includes('--delete');
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
      modifiedAt: stats.mtime,
    });
  }

  return files;
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bau-formular';
  const mongoOptions = process.env.MONGODB_DB ? { dbName: process.env.MONGODB_DB } : {};
  const uploadsDir = getUploadsDir();

  await mongoose.connect(mongoUri, mongoOptions);

  const references = new Set();
  const abnahmeCount = await collectReferencesFromModel(Abnahme, references);
  const entwurfCount = await collectReferencesFromModel(Entwurf, references);

  let storedFiles = [];
  try {
    storedFiles = await listStoredFiles(uploadsDir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      storedFiles = [];
    } else {
      throw err;
    }
  }

  const orphanFiles = storedFiles
    .filter(file => !references.has(file.relativePath))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const totalBytes = orphanFiles.reduce((sum, file) => sum + file.size, 0);

  console.log(`Mode: ${SHOULD_DELETE ? 'DELETE' : 'DRY RUN'}`);
  console.log(`Uploads directory: ${uploadsDir}`);
  console.log(`Mongo documents scanned: ${abnahmeCount} Abnahmen, ${entwurfCount} Entwuerfe`);
  console.log(`Mongo upload references found: ${references.size}`);
  console.log(`Files stored on disk: ${storedFiles.length}`);
  console.log(`Orphan files found: ${orphanFiles.length} (${formatBytes(totalBytes)})`);

  if (orphanFiles.length) {
    console.log('');
    orphanFiles.forEach(file => {
      console.log(`${formatBytes(file.size).padStart(9)}  ${file.modifiedAt.toISOString()}  ${file.fullPath}`);
    });
  }

  if (SHOULD_DELETE) {
    for (const file of orphanFiles) {
      await fs.rm(file.fullPath, { force: true });
    }

    console.log('');
    console.log(`Deleted ${orphanFiles.length} orphan file(s), freeing ${formatBytes(totalBytes)}.`);
  } else {
    console.log('');
    console.log('No files were deleted. Re-run with --delete after reviewing the list.');
  }

  await mongoose.disconnect();
}

main().catch(async err => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
