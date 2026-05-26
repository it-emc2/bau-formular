const mongoose = require('mongoose');
const { createAbnahmeSchema } = require('./Abnahme');

const schema = createAbnahmeSchema('Entwürfe', { requireTerminId: false });

module.exports = mongoose.models.Entwurf || mongoose.model('Entwurf', schema);
