const mongoose = require('mongoose');
const { createAbnahmeSchema } = require('./Abnahme');

const schema = createAbnahmeSchema('Entwürfe');

module.exports = mongoose.models.Entwurf || mongoose.model('Entwurf', schema);
