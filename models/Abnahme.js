const mongoose = require('mongoose');

const schemaDefinition = {
  /* ── Step 1 ─ Grunddaten ─────────────────────────── */
  terminId:          { type: String, required: true },
  formularTyp:       { type: String, enum: ['baustellenabnahme', 'zusaetzliche_leistungen', 'nachbesserung', 'schadensmeldung'], default: 'baustellenabnahme' },
  kundennummer:      { type: String, default: '' },
  artDesTermins:     { type: String, enum: ['Umbau', 'Nachbesserung', 'Service'], default: 'Umbau' },
  anrede:            { type: String, enum: ['Frau', 'Herr', 'Familie', ''], default: '' },
  vorname:           { type: String, default: '' },
  nachname:          { type: String, default: '' },
  name:              { type: String, default: '' },
  entwurfsName:      { type: String, default: '' },
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
  grundNichtErfolgreich: { type: String, default: '' },
  bitrixAuftragId:     { type: String, default: '' },
  bitrixZusatzfeld:    { type: String, default: '' },
  auszufuehrendeTaetigkeiten: { type: String, default: '' },
  bitrixExecutionActivities:  { type: String, default: '' },

  /* ── Step 2 ─ Warenpruefung ─────────────────────── */
  warenpruefungDatum:            { type: Date },
  wareWandverkleidungenStatus:   { type: String, enum: ['io', 'nicht-io', ''], default: '' },
  wareDuschabtrennungenStatus:   { type: String, enum: ['io', 'nicht-io', ''], default: '' },
  wareDuschwanneStatus:          { type: String, enum: ['io', 'nicht-io', ''], default: '' },
  wareBadewannentuerStatus:      { type: String, enum: ['io', 'nicht-io', ''], default: '' },
  wareWaschtischStatus:          { type: String, enum: ['io', 'nicht-io', ''], default: '' },
  wareToiletteStatus:            { type: String, enum: ['io', 'nicht-io', ''], default: '' },
  wareHaltegriffStatus:          { type: String, enum: ['io', 'nicht-io', ''], default: '' },
  wareBoedenStatus:              { type: String, enum: ['io', 'nicht-io', ''], default: '' },
  wareGelaenderStatus:           { type: String, enum: ['io', 'nicht-io', ''], default: '' },
  wareSonstigesStatus:           { type: String, enum: ['io', 'nicht-io', ''], default: '' },
  warenpruefungKommentar:        { type: String, default: '' },
  unterschriftWarenpruefung:     { type: String, default: '' },

  /* ── Step 3 ─ Montage-Checkliste ────────────────── */
  checklistFotosWaerendUmsetzung:           { type: Boolean, default: false },
  checklistFinaleFotos:                     { type: Boolean, default: false },
  checklistFotosHandwerkskoordination:      { type: Boolean, default: false },
  checklistFotoUebermittlung:               { type: String, enum: ['Über Link', 'iMessage', 'WhatsApp', 'FortyTools', ''], default: 'Über Link' },
  checklistFotoUebermittlungGrund:          { type: String, default: '' },
  checklistVerbrauchsmaterialErfasst:       { type: Boolean, default: false },
  checklistWarenkorbGeschickt:              { type: Boolean, default: false },
  checklistDokumentWarenpruefung:           { type: Boolean, default: false },
  checklistArbeitszeitenErfasst:            { type: Boolean, default: false },
  checklistBestaetigungKasse:               { type: Boolean, default: false },
  checklistDokumentArbeitsbericht:          { type: Boolean, default: false },
  checklistFlyerBadewannentuer:             { type: Boolean, default: false },
  checklistFlyerBadumbau:                   { type: Boolean, default: false },
  checklistFlyerHaltegriffe:                { type: Boolean, default: false },
  checklistBroschuerePflegehinweise:        { type: Boolean, default: false },
  checklistSilikonDuschabzieher:            { type: Boolean, default: false },
  checklistHinweisSilikonfugen:             { type: Boolean, default: false },
  checklistGratisHaltegriffMontiert:        { type: Boolean, default: false },
  checklistGratisHaltegriffKommentar:       { type: String, default: '' },

  /* ── Step 4 ─ Abschlusskontrolle ────────────────── */
  abschlusskontrolleBaustelleSauber:        { type: Boolean, default: false },
  abschlusskontrolleVerpackungEntsorgt:     { type: Boolean, default: false },
  abschlusskontrolleFunktionstest:          { type: Boolean, default: false },
  abschlusskontrolleKundeEingewiesen:       { type: Boolean, default: false },
  abschlusskontrolleWerkzeugeMitgenommen:   { type: Boolean, default: false },
  sonstigeBemerkungenBaustelle:             { type: String, default: '' },
  unterschriftMonteur1:                     { type: String, default: '' },
  unterschriftMonteur2:                     { type: String, default: '' },
  unterschriftMonteurDatum:                 { type: Date },

  /* ── Step 5 ─ Fotos / Video ─────────────────────── */
  bilderFertigerUmbau:   [String],
  grossesVideoNachgang:  { type: Boolean, default: false },
  videoDesAblaufs:       { type: String, default: '' },
  fotosAbdichtung:       [String],
  bilderBehobeneMaengel: [String],

  /* ── Step 6 ─ Weitere Bilder ────────────────────── */
  weitereBilder:  [String],
  weitereBilder2: [String],
  weitereBilder3: [String],

  /* ── Step 7 ─ Abschluss Umbau ───────────────────── */
  zusaetzlicheArbeiten:  { type: String, default: '' },
  preisZusaetzlich:      { type: Number, default: 0 },
  unterschriftZusaetzlicheLeistungen: { type: String, default: '' },
  unterschriftZusaetzlicheLeistungenZeitpunkt: { type: Date },
  abgeschlossenAm:       { type: Date },
  alleArbeitenErledigt:  { type: String, enum: ['Ja', 'Nein', ''], default: '' },
  nichtErledigteArbeiten:{ type: String, default: '' },
  auftragsNummer:        { type: String, default: '' },
  unterschriftKunde:     { type: String, default: '' },   // base64 PNG
  unterschriftZeitpunkt: { type: Date },

  /* ── Step 7.5 ─ Produktverkauf vor Ort ─────────── */
  produktverkaufVorOrt:           { type: String, enum: ['Ja', 'Nein', ''], default: '' },
  produktverkaufProdukt1:         { type: Boolean, default: false },
  produktverkaufProdukt2:         { type: Boolean, default: false },
  produktverkaufProdukt2Variante: { type: String, enum: ['Klebepad', 'Haken', ''], default: '' },
  produktverkaufProdukt3:         { type: Boolean, default: false },
  produktverkaufProdukt4:         { type: Boolean, default: false },
  produktverkaufProdukt5:         { type: Boolean, default: false },
  unterschriftProduktverkauf:           { type: String, default: '' },
  unterschriftProduktverkaufZeitpunkt:  { type: Date },

  /* ── Step 8 ─ Einwilligung zur Abrechnung ──────── */
  einwilligungGeburtsdatum:           { type: String, default: '' },
  unterschriftEinwilligung:           { type: String, default: '' },
  unterschriftEinwilligungZeitpunkt:  { type: Date },

  /* ── Step 9 ─ Mängelbeseitigung ─────────────────── */
  maengelAbgeschlossenAm:        { type: Date },
  unterschriftMaengel:           { type: String, default: '' },
  unterschriftMaengelZeitpunkt:  { type: Date },

  /* ── Step 9 ─ Nachbesserung ─────────────────────── */
  nachbesserungAbgeschlossenAm:  { type: Date },
  zusaetzlicheArbeitenNB:       { type: String, default: '' },
  preisZusaetzlichNB:            { type: Number, default: 0 },
  alleArbeitenNB:                { type: String, enum: ['Ja', 'Nein', ''], default: '' },
  nichtErledigteArbeitenNB:     { type: String, default: '' },
  unterschriftNB:                { type: String, default: '' },
  unterschriftNBZeitpunkt:       { type: Date },

  /* ── Step 10 ─ Hinweise ─────────────────────────── */
  hinweiseBuero: { type: String, default: '' },
  emailEmpfaenger: { type: String, default: '' },

  /* ── System ─────────────────────────────────────── */
  status:     { type: String, enum: ['draft', 'submitted'], default: 'draft' },
  shareToken: { type: String, unique: true, sparse: true },
};

function createAbnahmeSchema(collectionName, options = {}) {
  const definition = {
    ...schemaDefinition,
    terminId: {
      ...schemaDefinition.terminId,
      required: options.requireTerminId !== false,
    },
  };

  return new mongoose.Schema(definition, {
    timestamps: true,
    collection: collectionName,
  });
}

const schema = createAbnahmeSchema('Abnahmen');

module.exports = mongoose.models.Abnahme || mongoose.model('Abnahme', schema);
module.exports.createAbnahmeSchema = createAbnahmeSchema;
