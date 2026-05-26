const path = require('path');

function getUploadsDir() {
  const configured = process.env.UPLOADS_DIR;
  if (!configured) return path.join(__dirname, '..', 'uploads');

  return path.isAbsolute(configured)
    ? configured
    : path.resolve(__dirname, '..', configured);
}

module.exports = { getUploadsDir };
