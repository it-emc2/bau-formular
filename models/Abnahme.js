const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  /* ── Step 1 ─ Grunddaten ─────────────────────────── */
  terminId:          { type: String, required: true },
  kundennummer:      { type: String, default: '' },
  artDesTermins:     { type: String, enum: ['Umbau', 'Nachbesserung', 'Service'], default: 'Umbau' },
  hinweiseAnFinance: { type: String, default: '' },
  anrede:            { type: String, enum: ['Frau', 'Herr', 'Familie', ''], default: '' },
  vorname:           { type: String, default: '' },
  nachname:          { type: String, default: '' },
  name:              { type: String, default: '' },
  adresse: {
    strasse:      { type: String, default: '' },
    adresszeile2: { type: String, default: '' },
    stadt:        { type: String, default: '' },
    plz:          { type: String, default: '' },
  },
  terminStatus: {
    type: String,
    enum: ['Erfolgreich beendet', 'Nicht erfolgreich beendet', ''],
    default: '',
  },

  /* ── Step 2 ─ Fotos / Video ─────────────────────── */
  bilderFertigerUmbau:   [String],
  grossesVideoNachgang:  { type: Boolean, default: false },
  videoDesAblaufs:       { type: String, default: '' },
  fotosAbdichtung:       [String],
  bilderBehobeneMaengel: [String],

  /* ── Step 3 ─ Weitere Bilder ────────────────────── */
  weitereBilder:  [String],
  weitereBilder2: [String],
  weitereBilder3: [String],

  /* ── Step 4 ─ Abschluss Umbau ───────────────────── */
  zusaetzlicheArbeiten:  { type: String, default: '' },
  preisZusaetzlich:      { type: Number, default: 0 },
  abgeschlossenAm:       { type: Date },
  alleArbeitenErledigt:  { type: String, enum: ['Ja', 'Nein', ''], default: '' },
  nichtErledigteArbeiten:{ type: String, default: '' },
  auftragsNummer:        { type: String, default: '' },
  unterschriftKunde:     { type: String, default: '' },   // base64 PNG
  unterschriftZeitpunkt: { type: Date },

  /* ── Step 5 ─ Mängelbeseitigung ─────────────────── */
  maengelAbgeschlossenAm:        { type: Date },
  unterschriftMaengel:           { type: String, default: '' },
  unterschriftMaengelZeitpunkt:  { type: Date },

  /* ── Step 6 ─ Nachbesserung ─────────────────────── */
  nachbesserungAbgeschlossenAm:  { type: Date },
  zusaetzlicheArbeitenNB:       { type: String, default: '' },
  preisZusaetzlichNB:            { type: Number, default: 0 },
  alleArbeitenNB:                { type: String, enum: ['Ja', 'Nein', ''], default: '' },
  nichtErledigteArbeitenNB:     { type: String, default: '' },
  unterschriftNB:                { type: String, default: '' },
  unterschriftNBZeitpunkt:       { type: Date },

  /* ── Step 7 ─ Hinweise ──────────────────────────── */
  hinweiseBuero: { type: String, default: '' },

  /* ── System ─────────────────────────────────────── */
  status:     { type: String, enum: ['draft', 'submitted'], default: 'draft' },
  shareToken: { type: String, unique: true, sparse: true },
}, {
  timestamps: true,
});

module.exports = mongoose.model('Abnahme', schema);
