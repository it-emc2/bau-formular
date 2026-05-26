#!/usr/bin/env node

require('dotenv').config();

const mongoose = require('mongoose');

const { getUploadsDir } = require('../services/uploadsPath');
const { cleanupOrphanUploads, formatBytes } = require('../services/orphanUploads');

const SHOULD_DELETE = process.argv.includes('--delete');

async function main() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/bau-formular';
  const mongoOptions = process.env.MONGODB_DB ? { dbName: process.env.MONGODB_DB } : {};
  const uploadsDir = getUploadsDir();

  await mongoose.connect(mongoUri, mongoOptions);

  const report = await cleanupOrphanUploads({
    deleteFiles: SHOULD_DELETE,
    uploadsDir,
  });

  console.log(`Mode: ${SHOULD_DELETE ? 'DELETE' : 'DRY RUN'}`);
  console.log(`Uploads directory: ${report.uploadsDir}`);
  console.log(`Mongo database: ${report.databaseName || '(from URI)'}`);
  console.log(`Mongo documents scanned: ${report.documentsScanned.abnahmen} Abnahmen, ${report.documentsScanned.entwuerfe} Entwuerfe`);
  console.log(`Mongo upload references found: ${report.referencesFound}`);
  console.log(`Files stored on disk: ${report.storedFiles}`);
  console.log(`Orphan files found: ${report.orphanCount} (${report.totalBytesLabel})`);

  if (report.orphanFiles.length) {
    console.log('');
    report.orphanFiles.forEach(file => {
      console.log(`${formatBytes(file.size).padStart(9)}  ${file.modifiedAt.toISOString()}  ${file.fullPath}`);
    });
  }

  if (SHOULD_DELETE) {
    console.log('');
    console.log(`Deleted ${report.deletedCount} orphan file(s), freeing ${report.deletedBytesLabel}.`);
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
