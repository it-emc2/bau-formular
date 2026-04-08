/* ═══════════════════════════════════════════════════════════
   BAU-FORMULAR  –  Frontend Controller
   ═══════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  // ── DOM Cache ──────────────────────────────────────────
  const $  = (s, p = document) => p.querySelector(s);
  const $$ = (s, p = document) => [...p.querySelectorAll(s)];

  const form          = $('#abnahmeForm');
  const stepIndicator = $('#stepIndicator');
  const stepCounter   = $('#stepCounter');
  const btnBack       = $('#btnBack');
  const btnNext       = $('#btnNext');
  const btnDraft      = $('#btnDraft');
  const btnSubmit     = $('#btnSubmit');
  const devModeToggle = $('#devModeToggle');
  const devToolsPanel = $('#devToolsPanel');
  const devModeBadge  = $('#devModeBadge');
  const bitrixTestActions = $('#bitrixTestActions');
  const btnBitrixAutofill = $('#btnBitrixAutofill');
  const btnBitrixRefresh = $('#btnBitrixRefresh');
  const btnDemoPrefill = $('#btnDemoPrefill');
  const bitrixSearch  = $('#bitrixSearch');
  const bitrixDealList = $('#bitrixDealList');
  const draftSearch = $('#draftSearch');
  const btnDraftRefresh = $('#btnDraftRefresh');
  const draftList = $('#draftList');
  const toast         = $('#toast');

  const TOTAL_STEPS = 9;
  const BITRIX_TEST_ENTITY_TYPE_ID = 2;
  const BITRIX_STAGE_ID = 'C22:UC_T5EXSL';
  let currentStep   = 1;
  let formId        = null;     // Mongo _id once saved
  let shareToken    = null;
  let fileStore     = {};       // { fieldName: File[] }
  let signaturePads = {};       // { fieldName: SignaturePad }
  let devMode       = localStorage.getItem('bauFormularDevMode') === 'true';
  let bitrixDeals   = [];
  let activeBitrixDealId = null;
  let bitrixSearchTerm = '';
  let drafts = [];
  let activeDraftId = null;
  let draftSearchTerm = '';

  function buildFullName(data) {
    return [data.anrede, data.vorname, data.nachname]
      .map(value => (value || '').trim())
      .filter(Boolean)
      .join(' ');
  }

  function splitLegacyName(fullName = '') {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    const knownSalutations = ['Herr', 'Frau', 'Familie'];
    const parsed = { anrede: '', vorname: '', nachname: '' };

    if (!parts.length) return parsed;

    if (knownSalutations.includes(parts[0])) {
      parsed.anrede = parts.shift();
    }

    parsed.vorname = parts.shift() || '';
    parsed.nachname = parts.join(' ');

    return parsed;
  }

  // ── Initialisation ─────────────────────────────────────
  function init() {
    buildStepDots();
    bindNavigation();
    bindFileUploads();
    bindConditionalFields();
    bindAuftragsNrSync();
    bindBitrixAutofill();
    bindDraftLookup();
    initSignaturePads();
    initDevModeToggle();
    loadDraftIfNeeded();
    showStep(1);
    fetchBitrixDeals();
    fetchDrafts();
  }

  // ── Step Indicator Dots ────────────────────────────────
  function buildStepDots() {
    stepIndicator.innerHTML = '';
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      const dot = document.createElement('div');
      dot.className = 'step-dot';
      dot.textContent = i;
      dot.dataset.step = i;
      stepIndicator.appendChild(dot);
    }
  }

  function updateStepDots() {
    $$('.step-dot', stepIndicator).forEach(dot => {
      const s = +dot.dataset.step;
      dot.classList.remove('active', 'completed');
      if (s < currentStep)  dot.classList.add('completed');
      if (s === currentStep) dot.classList.add('active');
    });
  }

  // ── Show / Hide Steps ─────────────────────────────────
  function showStep(n) {
    currentStep = n;
    $$('.form-step', form).forEach(sec => {
      sec.classList.toggle('active', +sec.dataset.step === n);
    });
    updateStepDots();
    stepCounter.textContent = `${n}/${TOTAL_STEPS}`;

    // Button visibility
    btnBack.style.display   = n === 1 ? 'none' : 'inline-flex';
    btnNext.style.display   = n === TOTAL_STEPS ? 'none' : 'inline-flex';
    btnSubmit.style.display = n === TOTAL_STEPS ? 'inline-flex' : 'none';

    // Re-init signature pads when step becomes visible (canvas resize)
    requestAnimationFrame(() => resizeAllSignatureCanvases());

    // Scroll to top of card
    $('.form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Navigation ─────────────────────────────────────────
  function bindNavigation() {
    btnNext.addEventListener('click', () => {
      if (devMode || validateStep(currentStep)) {
        showStep(Math.min(currentStep + 1, TOTAL_STEPS));
      }
    });

    btnBack.addEventListener('click', () => {
      showStep(Math.max(currentStep - 1, 1));
    });

    btnDraft.addEventListener('click', () => saveForm('save'));
    btnSubmit.addEventListener('click', () => {
      if (validateAllSteps()) saveForm('submit');
    });

    // Draft modal buttons
    $('#btnCopyLink').addEventListener('click', () => {
      const input = $('#draftLink');
      input.select();
      navigator.clipboard.writeText(input.value).then(() => showToast('Link kopiert!', 'success'));
    });
    $('#btnCloseDraft').addEventListener('click', () => $('#draftModal').classList.remove('open'));
  }

  function initDevModeToggle() {
    if (!devModeToggle) return;

    updateDevModeToggle();
    devModeToggle.addEventListener('click', () => {
      devMode = !devMode;
      localStorage.setItem('bauFormularDevMode', String(devMode));
      updateDevModeToggle();
      showToast(
        devMode
          ? 'Testmodus aktiv: Seitenwechsel ohne Pflichtfelder.'
          : 'Testmodus deaktiviert: Validierung wieder aktiv.',
        'success'
      );
    });
  }

  function updateDevModeToggle() {
    if (!devModeToggle) return;

    devModeToggle.classList.toggle('active', devMode);
    devModeToggle.setAttribute('aria-pressed', String(devMode));
    devModeToggle.textContent = `Testmodus: ${devMode ? 'An' : 'Aus'}`;
    if (devModeBadge) devModeBadge.classList.toggle('hidden', !devMode);
    if (bitrixTestActions) bitrixTestActions.classList.toggle('hidden', !devMode);
  }

  function bindBitrixAutofill() {
    if (btnBitrixRefresh) {
      btnBitrixRefresh.addEventListener('click', fetchBitrixDeals);
    }

    if (bitrixSearch) {
      bitrixSearch.addEventListener('input', () => {
        bitrixSearchTerm = bitrixSearch.value.trim().toLowerCase();
        renderBitrixDeals(getFilteredBitrixDeals());
      });
    }

    if (btnBitrixAutofill) {
      btnBitrixAutofill.addEventListener('click', async () => {
        if (!bitrixDeals.length) await fetchBitrixDeals();
        if (bitrixDeals.length) loadBitrixDeal(bitrixDeals[0]);
      });
    }

    if (btnDemoPrefill) {
      btnDemoPrefill.addEventListener('click', prefillDemoData);
    }
  }

  function bindDraftLookup() {
    if (draftSearch) {
      draftSearch.addEventListener('input', () => {
        draftSearchTerm = draftSearch.value.trim();
        fetchDrafts();
      });
    }

    if (btnDraftRefresh) {
      btnDraftRefresh.addEventListener('click', fetchDrafts);
    }
  }

  async function fetchBitrixDeals() {
    if (!bitrixDealList) return;

    if (btnBitrixRefresh) btnBitrixRefresh.disabled = true;
    renderBitrixDeals([], 'Bitrix-Deals werden geladen...');

    try {
      const itemRes = await fetch(
        `/api/bitrix/items/by-stage?entityTypeId=${BITRIX_TEST_ENTITY_TYPE_ID}&stageId=${encodeURIComponent(BITRIX_STAGE_ID)}&useOriginalUfNames=N&select=id,title,stageId,contactId,opportunity,assignedById,createdTime,begindate,closeDate`
      );
      const itemJson = await itemRes.json();
      const items = itemJson?.result?.items || itemJson?.result || [];

      if (!items.length) {
        bitrixDeals = [];
        renderBitrixDeals([], 'Keine Bitrix-Deals in diesem Status gefunden.');
        return;
      }

      bitrixDeals = await enrichBitrixDeals(items);
      renderBitrixDeals(getFilteredBitrixDeals());
      showToast('Bitrix-Deals geladen.', 'success');
    } catch (error) {
      bitrixDeals = [];
      renderBitrixDeals([], 'Fehler beim Laden der Bitrix-Deals.');
      showToast('Fehler beim Laden der Bitrix-Deals: ' + error.message, 'error');
    } finally {
      if (btnBitrixRefresh) btnBitrixRefresh.disabled = false;
    }
  }

  function renderBitrixDeals(deals, emptyMessage = 'Noch keine Bitrix-Deals geladen.') {
    if (!bitrixDealList) return;

    if (!deals.length) {
      bitrixDealList.innerHTML = `<p class="bitrix-empty">${emptyMessage}</p>`;
      return;
    }

    bitrixDealList.innerHTML = '';

    deals.forEach(deal => {
      const card = document.createElement('article');
      card.className = 'bitrix-deal-card';
      if (String(deal.id) === String(activeBitrixDealId)) card.classList.add('active');

      const dateLabel = deal.createdTime || deal.begindate || deal.closeDate || '';
      const amountLabel = deal.opportunity ? `${deal.opportunity} EUR` : null;
      const contactLine = buildBitrixContactLine(deal);
      const displayTitle = buildBitrixDisplayTitle(deal);
      const offerType = buildBitrixOfferType(deal);

      card.innerHTML = `
        <div class="bitrix-deal-top">
          <div>
            <div class="bitrix-deal-title">${escapeHtml(displayTitle)}</div>
            ${offerType ? `<div class="bitrix-deal-offer">${escapeHtml(offerType)}</div>` : ''}
            <div class="bitrix-deal-sub">ID ${escapeHtml(String(deal.id))}</div>
            ${contactLine ? `<div class="bitrix-deal-contact">${escapeHtml(contactLine)}</div>` : ''}
          </div>
          <div class="bitrix-deal-meta">
            <span class="bitrix-chip">${escapeHtml(deal.stageId || BITRIX_STAGE_ID)}</span>
            ${amountLabel ? `<span class="bitrix-chip">${escapeHtml(amountLabel)}</span>` : ''}
            ${dateLabel ? `<span class="bitrix-chip">${escapeHtml(formatShortDate(dateLabel))}</span>` : ''}
          </div>
        </div>
        <button type="button" class="bitrix-deal-action">In Formular laden</button>
      `;

      $('.bitrix-deal-action', card).addEventListener('click', () => loadBitrixDeal(deal));
      bitrixDealList.appendChild(card);
    });
  }

  function getFilteredBitrixDeals() {
    if (!bitrixSearchTerm) return bitrixDeals;

    return bitrixDeals.filter(deal => {
      const haystack = [
        deal.id,
        deal.title,
        deal.stageId,
        deal.contactId,
        deal._contact?.NAME,
        deal._contact?.LAST_NAME,
        buildBitrixOfferType(deal),
      ]
        .map(value => String(value || '').toLowerCase())
        .join(' ');

      return haystack.includes(bitrixSearchTerm);
    });
  }

  async function loadBitrixDeal(item) {
    activeBitrixDealId = item.id;
    renderBitrixDeals(bitrixDeals);

    try {
      applyBitrixItemToForm(item);

      if (item.contactId) {
        const contact = item._contact || await fetchBitrixContact(item.contactId);
        if (contact) {
          applyBitrixContactToForm(contact);
        } else {
          showToast('Deal geladen, aber kein Kontakt gefunden.', 'error');
          return;
        }
      }

      showToast('Bitrix-Deal in Auftrag geladen.', 'success');
    } catch (error) {
      showToast('Fehler beim Laden des Deals: ' + error.message, 'error');
    }
  }

  async function fetchDrafts() {
    if (!draftList) return;

    if (btnDraftRefresh) btnDraftRefresh.disabled = true;
    renderDrafts([], 'Entwürfe werden geladen...');

    try {
      const query = draftSearchTerm ? `?q=${encodeURIComponent(draftSearchTerm)}` : '';
      const res = await fetch(`/api/form/drafts${query}`);
      const json = await res.json();

      if (!json.success) throw new Error(json.error || 'Entwürfe konnten nicht geladen werden');

      drafts = json.drafts || [];
      renderDrafts(drafts, draftSearchTerm ? 'Keine passenden Entwürfe gefunden.' : 'Noch keine Entwürfe gespeichert.');
    } catch (error) {
      drafts = [];
      renderDrafts([], 'Fehler beim Laden der Entwürfe.');
      showToast('Fehler beim Laden der Entwürfe: ' + error.message, 'error');
    } finally {
      if (btnDraftRefresh) btnDraftRefresh.disabled = false;
    }
  }

  function renderDrafts(items, emptyMessage = 'Noch keine Entwürfe gespeichert.') {
    if (!draftList) return;

    if (!items.length) {
      draftList.innerHTML = `<p class="bitrix-empty">${emptyMessage}</p>`;
      return;
    }

    draftList.innerHTML = '';

    items.forEach(item => {
      const card = document.createElement('article');
      const isActive = String(item._id) === String(activeDraftId || formId || '');
      card.className = 'draft-card';
      if (isActive) card.classList.add('active');

      const displayTitle = buildDraftTitle(item);
      const subtitle = buildDraftSubtitle(item);
      const updatedAt = item.updatedAt ? formatShortDate(item.updatedAt) : '';

      card.innerHTML = `
        <div class="draft-card-top">
          <div>
            <div class="draft-card-title">${escapeHtml(displayTitle)}</div>
            ${subtitle ? `<div class="draft-card-subtitle">${escapeHtml(subtitle)}</div>` : ''}
            <div class="draft-card-meta">ID ${escapeHtml(String(item._id || ''))}${updatedAt ? ` · aktualisiert ${escapeHtml(updatedAt)}` : ''}</div>
          </div>
          ${item.terminId ? `<span class="bitrix-chip">${escapeHtml(item.terminId)}</span>` : ''}
        </div>
        <button type="button" class="draft-card-action">Entwurf laden</button>
      `;

      $('.draft-card-action', card).addEventListener('click', () => loadDraftById(item._id));
      draftList.appendChild(card);
    });
  }

  function buildDraftTitle(item) {
    return [item.vorname, item.nachname]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .join(' ') || item.name || item.kundennummer || item.auftragsNummer || 'Unbenannter Entwurf';
  }

  function buildDraftSubtitle(item) {
    return item.auftragsNummer || item.kundennummer || '';
  }

  async function loadDraftById(id) {
    if (!id) return;

    try {
      const res = await fetch(`/api/form/drafts/${id}`);
      const json = await res.json();

      if (!json.success) throw new Error(json.error || 'Entwurf konnte nicht geladen werden');

      const data = json.data;
      formId = data._id;
      shareToken = data.shareToken || null;
      activeDraftId = data._id;

      resetFormState();
      populateForm(data);
      renderDrafts(drafts);
      showStep(1);
      showToast('Entwurf geladen.', 'success');
    } catch (error) {
      showToast('Fehler beim Laden des Entwurfs: ' + error.message, 'error');
    }
  }

  function setFieldValue(name, value) {
    const input = $(`[name="${name}"]`, form);
    if (!input || value === undefined || value === null) return;

    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setRadioValue(name, value) {
    if (!value) return;

    const radio = $$(`input[name="${name}"]`, form).find(input => input.value === value);
    if (!radio) return;

    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setCheckboxValue(name, checked) {
    const input = $(`input[type="checkbox"][name="${name}"]`, form);
    if (!input) return;

    input.checked = Boolean(checked);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setSelectValue(name, value) {
    const input = $(`select[name="${name}"]`, form);
    if (!input) return;

    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function prefillDemoData() {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    const textValues = {
      terminId: 'MUSTER-2026-001',
      kundennummer: '12398',
      hinweiseAnFinance: 'Musterhinweis für Finance zur internen Prüfung.',
      vorname: 'Max',
      nachname: 'Mustermann',
      'adresse.strasse': 'Musterstraße 42',
      'adresse.adresszeile2': '2. OG links',
      'adresse.stadt': 'Leipzig',
      'adresse.plz': '04109',
      auftragsNummer: 'A-AN-MUSTER-001',
      warenpruefungKommentar: 'Musterprüfung durchgeführt, leichte Kratzer an der Verpackung dokumentiert.',
      checklistGratisHaltegriffKommentar: 'Mustertext: Montage erfolgt nach Rücksprache beim Folgetermin.',
      sonstigeBemerkungenBaustelle: 'Musterbemerkung: Baustelle sauber verlassen, Kunde eingewiesen.',
      zusaetzlicheArbeiten: 'Mustertext für zusätzliche Arbeiten vor Ort.',
      nichtErledigteArbeiten: 'Mustertext: Silikonfuge im Bereich Türanschluss offen, Nacharbeit erforderlich.',
      zusaetzlicheArbeitenNB: 'Mustertext für Nachbesserung.',
      nichtErledigteArbeitenNB: 'Mustertext: Restarbeiten in Abstimmung mit Kunde verschoben.',
      hinweiseBuero: 'Musterhinweis für das Büro: Bitte Unterlagen archivieren und Rückruf einplanen.',
    };

    const numberValues = {
      preisZusaetzlich: '249.90',
      preisZusaetzlichNB: '89.50',
    };

    Object.entries(textValues).forEach(([name, value]) => setFieldValue(name, value));
    Object.entries(numberValues).forEach(([name, value]) => setFieldValue(name, value));

    [
      'warenpruefungDatum',
      'unterschriftMonteurDatum',
      'abgeschlossenAm',
      'maengelAbgeschlossenAm',
      'nachbesserungAbgeschlossenAm',
    ].forEach(name => setFieldValue(name, todayStr));

    setSelectValue('artDesTermins', 'Umbau');
    setSelectValue('terminStatus', 'Erfolgreich beendet');

    setRadioValue('anrede', 'Herr');
    setRadioValue('checklistFotoUebermittlung', 'WhatsApp');
    setRadioValue('alleArbeitenErledigt', 'Nein');
    setRadioValue('alleArbeitenNB', 'Nein');

    [
      'checklistFotosWaerendUmsetzung',
      'checklistFinaleFotos',
      'checklistFotosHandwerkskoordination',
      'checklistVerbrauchsmaterialErfasst',
      'checklistWarenkorbGeschickt',
      'checklistDokumentWarenpruefung',
      'checklistArbeitszeitenErfasst',
      'checklistBestaetigungKasse',
      'checklistDokumentArbeitsbericht',
      'checklistFlyerBadewannentuer',
      'checklistFlyerBadumbau',
      'checklistFlyerHaltegriffe',
      'checklistBroschuerePflegehinweise',
      'checklistSilikonDuschabzieher',
      'checklistHinweisSilikonfugen',
      'checklistGratisHaltegriffMontiert',
      'abschlusskontrolleBaustelleSauber',
      'abschlusskontrolleVerpackungEntsorgt',
      'abschlusskontrolleFunktionstest',
      'abschlusskontrolleKundeEingewiesen',
      'abschlusskontrolleWerkzeugeMitgenommen',
      'grossesVideoNachgang',
    ].forEach(name => setCheckboxValue(name, true));

    const inspectionStatus = {
      wareWandverkleidungenStatus: 'io',
      wareDuschabtrennungenStatus: 'io',
      wareDuschwanneStatus: 'io',
      wareBadewannentuerStatus: 'nicht-io',
      wareWaschtischStatus: 'io',
      wareToiletteStatus: 'io',
      wareHaltegriffStatus: 'io',
      wareBoedenStatus: 'io',
      wareGelaenderStatus: 'io',
      wareSonstigesStatus: 'nicht-io',
    };

    Object.entries(inspectionStatus).forEach(([name, value]) => setRadioValue(name, value));

    [
      'unterschriftWarenpruefung',
      'unterschriftMonteur1',
      'unterschriftMonteur2',
      'unterschriftKunde',
      'unterschriftMaengel',
      'unterschriftNB',
    ].forEach(drawDemoSignature);

    showToast('Musterdaten eingefüllt. Dateiuploads müssen weiterhin manuell gewählt werden.', 'success');
  }

  function drawDemoSignature(name) {
    const pad = signaturePads[name];
    if (!pad) return;

    const canvas = pad.canvas;
    const width = canvas.clientWidth || 300;
    const height = canvas.clientHeight || 150;
    const now = Date.now();

    pad.clear();
    pad.fromData([
      {
        color: '#253a75',
        points: [
          { x: width * 0.12, y: height * 0.68, time: now },
          { x: width * 0.26, y: height * 0.38, time: now + 10 },
          { x: width * 0.41, y: height * 0.62, time: now + 20 },
          { x: width * 0.56, y: height * 0.34, time: now + 30 },
          { x: width * 0.74, y: height * 0.57, time: now + 40 },
        ],
      },
    ]);
  }

  function normalizeSalutation(value) {
    const normalized = String(value || '').trim().toLowerCase();

    if (normalized.includes('frau')) return 'Frau';
    if (normalized.includes('herr')) return 'Herr';
    if (normalized.includes('familie')) return 'Familie';
    return '';
  }

  function applyBitrixItemToForm(item) {
    setFieldValue('terminId', `BITRIX-${item.id}`);
    setFieldValue('auftragsNummer', item.title || `Bitrix ${item.id}`);
    setFieldValue('kundennummer', item.contactId || item.id);
  }

  function applyBitrixContactToForm(contact) {
    setRadioValue('anrede', normalizeSalutation(contact.HONORIFIC || contact.POST));
    setFieldValue('vorname', contact.NAME || '');
    setFieldValue('nachname', contact.LAST_NAME || contact.SECOND_NAME || '');
    setFieldValue('adresse.strasse', contact.ADDRESS || '');
    setFieldValue('adresse.stadt', contact.ADDRESS_CITY || '');
    setFieldValue('adresse.plz', contact.ADDRESS_POSTAL_CODE || '');
  }

  async function enrichBitrixDeals(items) {
    return Promise.all(items.map(async item => {
      if (!item.contactId) return item;

      try {
        const contact = await fetchBitrixContact(item.contactId);
        return { ...item, _contact: contact || null };
      } catch (_error) {
        return { ...item, _contact: null };
      }
    }));
  }

  async function fetchBitrixContact(contactId) {
    const contactRes = await fetch(`/api/bitrix/contact/${contactId}`);
    const contactJson = await contactRes.json();
    return contactJson?.result || null;
  }

  function buildBitrixContactLine(deal) {
    if (!deal.contactId) return '';

    const contactName = [deal._contact?.NAME, deal._contact?.LAST_NAME]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .join(' ');

    return contactName
      ? `Kontakt ${deal.contactId} · ${contactName}`
      : `Kontakt ${deal.contactId}`;
  }

  function buildBitrixDisplayTitle(deal) {
    const contactName = [deal._contact?.NAME, deal._contact?.LAST_NAME]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .join(' ');

    if (contactName) return contactName;
    return deal.title || `Deal ${deal.id}`;
  }

  function buildBitrixOfferType(deal) {
    const title = String(deal.title || '').trim();
    if (!title) return '';

    const contactName = [deal._contact?.NAME, deal._contact?.LAST_NAME]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .join(' ');

    let cleaned = title;

    if (contactName) {
      const escapedName = contactName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      cleaned = cleaned.replace(new RegExp(escapedName, 'i'), '').trim();
    }

    cleaned = cleaned
      .replace(/^\[[^\]]+\]\s*/g, '')
      .replace(/\bLead\s+\d+\b/gi, '')
      .replace(/\s*-\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return cleaned || title;
  }

  function formatShortDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    return new Intl.DateTimeFormat('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  // ── Validation ─────────────────────────────────────────
  function validateStep(n) {
    const section = $(`.form-step[data-step="${n}"]`);
    let valid = true;

    // Required text / date / select inputs
    $$('input[required], select[required], textarea[required]', section).forEach(el => {
      // Skip hidden conditional fields
      const cond = el.closest('.conditional-field');
      if (cond && !cond.classList.contains('visible')) return;

      el.classList.remove('invalid');
      if (!el.value.trim()) {
        el.classList.add('invalid');
        valid = false;
      }
    });

    // Required radio groups
    const radioGroups = new Set();
    $$('input[type="radio"]', section).forEach(r => radioGroups.add(r.name));
    radioGroups.forEach(name => {
      // Check if this group is in a visible required context
      const radios = $$(`input[name="${name}"]`, section);
      const checked = radios.some(r => r.checked);
      // Only enforce if the parent label says "required"
      const label = radios[0]?.closest('.form-step')?.querySelector(`.field-label.required`);
      if (label && !checked) valid = false;
    });

    // Required signatures
    $$('.signature-wrapper', section).forEach(wrapper => {
      const name = wrapper.dataset.name;
      const pad  = signaturePads[name];
      if (pad && pad.isEmpty()) {
        wrapper.style.borderColor = '#e53935';
        valid = false;
      } else if (wrapper.style.borderColor === 'rgb(229, 57, 53)') {
        wrapper.style.borderColor = '';
      }
    });

    if (!valid) showToast('Bitte alle Pflichtfelder ausfüllen.', 'error');
    return valid;
  }

  function validateAllSteps() {
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      if (!validateStep(i)) {
        showStep(i);
        return false;
      }
    }
    return true;
  }

  // ── Collect Form Data ──────────────────────────────────
  function collectFormData() {
    const data = {};
    if (formId) data._id = formId;

    // Simple fields
    $$('input[type="text"], input[type="number"], input[type="date"], input[type="email"], select, textarea', form)
      .forEach(el => {
        if (!el.name || el.type === 'file') return;
        const val = el.type === 'number' ? (parseFloat(el.value) || 0) : el.value;
        // Handle nested keys like "adresse.strasse"
        if (el.name.includes('.')) {
          const [parent, child] = el.name.split('.');
          if (!data[parent]) data[parent] = {};
          data[parent][child] = val;
        } else {
          data[el.name] = val;
        }
      });

    // Radio buttons
    $$('input[type="radio"]:checked', form).forEach(el => {
      data[el.name] = el.value;
    });

    // Checkboxes
    $$('input[type="checkbox"]', form).forEach(el => {
      data[el.name] = el.checked;
    });

    data.name = buildFullName(data);

    // Signatures → write base64 to data + timestamp
    for (const [name, pad] of Object.entries(signaturePads)) {
      if (!pad.isEmpty()) {
        data[name] = pad.toDataURL('image/png');
        // set corresponding timestamp
        const tsField = name.replace('unterschrift', 'unterschrift') + 'Zeitpunkt';
        // map the names properly
        const tsMap = {
          unterschriftKunde:  'unterschriftZeitpunkt',
          unterschriftMaengel: 'unterschriftMaengelZeitpunkt',
          unterschriftNB:     'unterschriftNBZeitpunkt',
        };
        if (tsMap[name]) data[tsMap[name]] = new Date().toISOString();
      }
    }

    return data;
  }

  // ── Save / Submit ──────────────────────────────────────
  async function saveForm(action) {
    const data = collectFormData();
    const fd   = new FormData();
    fd.append('formData', JSON.stringify(data));

    // Append files
    for (const [fieldName, files] of Object.entries(fileStore)) {
      files.forEach(f => fd.append(fieldName, f));
    }

    // Disable buttons while saving
    [btnDraft, btnSubmit, btnNext].forEach(b => b.disabled = true);

    try {
      const res  = await fetch(`/api/form/${action}`, { method: 'POST', body: fd });
      const json = await res.json();

      if (!json.success) throw new Error(json.error);

      formId     = json.id;
      shareToken = json.shareToken;
      activeDraftId = json.id;

      if (action === 'save') {
        // Show draft link modal
        $('#draftLink').value = json.shareLink;
        $('#draftModal').classList.add('open');
        fetchDrafts();
        showToast('Entwurf gespeichert.', 'success');
      } else {
        fetchDrafts();
        showToast('Erfolgreich übermittelt! ✓', 'success');
        // Clear file store after successful submit
        fileStore = {};
        setTimeout(() => {
          window.location.href = '/';
        }, 2000);
      }
    } catch (err) {
      showToast('Fehler: ' + err.message, 'error');
    } finally {
      [btnDraft, btnSubmit, btnNext].forEach(b => b.disabled = false);
    }
  }

  // ── Load Draft ─────────────────────────────────────────
  async function loadDraftIfNeeded() {
    // Check URL for /form/:token
    const match = window.location.pathname.match(/^\/form\/(.+)/);
    if (!match) return;

    try {
      const res  = await fetch(`/api/form/token/${match[1]}`);
      const json = await res.json();
      if (!json.success) return;

      const data = json.data;
      formId     = data._id;
      shareToken = data.shareToken;
      activeDraftId = data._id;

      resetFormState();
      populateForm(data);
      fetchDrafts();
      showToast('Entwurf geladen', 'success');
    } catch (err) {
      console.error('Load draft error:', err);
    }
  }

  function resetFormState() {
    form.reset();
    fileStore = {};

    $$('input.invalid, select.invalid, textarea.invalid', form).forEach(el => {
      el.classList.remove('invalid');
    });

    $$('.file-preview', form).forEach(preview => {
      preview.innerHTML = '';
    });

    Object.values(signaturePads).forEach(pad => pad.clear());
    $$('.signature-wrapper', form).forEach(wrapper => {
      wrapper.style.borderColor = '';
    });
  }

  function populateForm(data) {
    if ((!data.anrede && !data.vorname && !data.nachname) && data.name) {
      Object.assign(data, splitLegacyName(data.name));
    }

    // Text / number / date / select
    $$('input[type="text"], input[type="number"], input[type="date"], input[type="email"], select, textarea', form)
      .forEach(el => {
        if (!el.name) return;
        let val;
        if (el.name.includes('.')) {
          const [parent, child] = el.name.split('.');
          val = data[parent]?.[child];
        } else {
          val = data[el.name];
        }
        if (val !== undefined && val !== null) {
          // Dates come as ISO strings – convert for date inputs
          if (el.type === 'date' && val) {
            el.value = val.substring(0, 10);
          } else {
            el.value = val;
          }
        }
      });

    // Radios
    $$('input[type="radio"]', form).forEach(el => {
      if (data[el.name] === el.value) el.checked = true;
    });

    // Checkboxes
    $$('input[type="checkbox"]', form).forEach(el => {
      if (data[el.name]) el.checked = true;
    });

    // Signatures – draw base64 onto pads
    for (const [name, pad] of Object.entries(signaturePads)) {
      if (data[name]) {
        const img = new Image();
        img.onload = () => {
          const canvas = pad.canvas;
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = data[name];
      }
    }

    // Existing file URLs → show as previews
    const fileFields = [
      'bilderFertigerUmbau', 'fotosAbdichtung', 'bilderBehobeneMaengel',
      'weitereBilder', 'weitereBilder2', 'weitereBilder3'
    ];
    fileFields.forEach(fieldName => {
      const urls = data[fieldName];
      if (!urls || !urls.length) return;
      const wrapper = $(`.file-upload[data-name="${fieldName}"]`);
      if (!wrapper) return;
      const preview = $('.file-preview', wrapper);
      urls.forEach(url => {
        const thumb = document.createElement('div');
        thumb.className = 'file-thumb';
        thumb.innerHTML = `<img src="${url}" alt="Bild" /><button type="button" class="remove-file">✕</button>`;
        preview.appendChild(thumb);
        // Remove button removes from server list (won't re-upload)
        $('.remove-file', thumb).addEventListener('click', () => thumb.remove());
      });
    });

    // Video
    if (data.videoDesAblaufs) {
      const wrapper = $(`.file-upload[data-name="videoDesAblaufs"]`);
      if (wrapper) {
        const preview = $('.file-preview', wrapper);
        const thumb = document.createElement('div');
        thumb.className = 'file-thumb';
        thumb.innerHTML = `<video src="${data.videoDesAblaufs}" muted></video><button type="button" class="remove-file">✕</button>`;
        preview.appendChild(thumb);
        $('.remove-file', thumb).addEventListener('click', () => thumb.remove());
      }
    }

    // Trigger conditional field visibility
    $$('input[type="radio"]:checked', form).forEach(el => el.dispatchEvent(new Event('change', { bubbles: true })));
  }

  // ── File Uploads ───────────────────────────────────────
  function bindFileUploads() {
    $$('.file-upload').forEach(wrapper => {
      const fieldName = wrapper.dataset.name;
      const multi     = wrapper.dataset.multiple === 'true';
      const fileInput = $('input[type="file"]', wrapper);
      const preview   = $('.file-preview', wrapper);
      const btnUp     = $('.btn-upload', wrapper);
      const btnCam    = $('.btn-camera', wrapper);
      const btnVid    = $('.btn-video', wrapper);
      const dropZone  = $('.file-drop', wrapper);

      if (!fileStore[fieldName]) fileStore[fieldName] = [];

      // Click on drop zone or upload button → open file picker
      const openPicker = () => fileInput.click();
      if (btnUp) btnUp.addEventListener('click', e => { e.stopPropagation(); openPicker(); });
      dropZone.addEventListener('click', openPicker);

      // File input change
      fileInput.addEventListener('change', () => {
        addFiles(fieldName, [...fileInput.files], preview, multi);
        fileInput.value = '';
      });

      // Camera button
      if (btnCam) {
        btnCam.addEventListener('click', e => {
          e.stopPropagation();
          openCamera(fieldName, preview, multi, 'photo');
        });
      }

      // Video button
      if (btnVid) {
        btnVid.addEventListener('click', e => {
          e.stopPropagation();
          openCamera(fieldName, preview, multi, 'video');
        });
      }

      // Drag & drop
      dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.style.borderColor = 'var(--clr-orange)'; });
      dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = ''; });
      dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.style.borderColor = '';
        addFiles(fieldName, [...e.dataTransfer.files], preview, multi);
      });
    });
  }

  function addFiles(fieldName, files, previewEl, multi) {
    if (!multi) {
      fileStore[fieldName] = [];
      previewEl.innerHTML = '';
    }

    files.forEach(file => {
      fileStore[fieldName].push(file);

      const thumb = document.createElement('div');
      thumb.className = 'file-thumb';

      if (file.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        thumb.appendChild(img);
      } else if (file.type.startsWith('video/')) {
        const vid = document.createElement('video');
        vid.src = URL.createObjectURL(file);
        vid.muted = true;
        thumb.appendChild(vid);
      } else {
        thumb.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:.7rem;text-align:center;padding:4px">${file.name}</div>`;
      }

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-file';
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => {
        const idx = fileStore[fieldName].indexOf(file);
        if (idx > -1) fileStore[fieldName].splice(idx, 1);
        thumb.remove();
      });
      thumb.appendChild(removeBtn);
      previewEl.appendChild(thumb);
    });
  }

  // ── Camera / Video Capture ─────────────────────────────
  let activeStream = null;
  let mediaRecorder = null;
  let recordedChunks = [];

  function openCamera(fieldName, previewEl, multi, mode) {
    const modal      = $('#cameraModal');
    const video      = $('#cameraVideo');
    const canvas     = $('#cameraCanvas');
    const btnCapture = $('#btnCapture');
    const btnClose   = $('#btnCameraClose');
    const title      = $('#cameraModalTitle');

    title.textContent = mode === 'video' ? 'Video aufnehmen' : 'Foto aufnehmen';
    btnCapture.textContent = mode === 'video' ? '⏺ Aufnahme starten' : '📸 Aufnehmen';

    const constraints = mode === 'video'
      ? { video: { facingMode: 'environment' }, audio: true }
      : { video: { facingMode: 'environment' } };

    navigator.mediaDevices.getUserMedia(constraints)
      .then(stream => {
        activeStream = stream;
        video.srcObject = stream;
        modal.classList.add('open');
      })
      .catch(err => {
        showToast('Kamera-Zugriff nicht möglich: ' + err.message, 'error');
      });

    let recording = false;

    const captureHandler = () => {
      if (mode === 'photo') {
        // Capture photo
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        canvas.toBlob(blob => {
          const file = new File([blob], `foto-${Date.now()}.jpg`, { type: 'image/jpeg' });
          addFiles(fieldName, [file], previewEl, multi);
          closeCamera();
        }, 'image/jpeg', 0.9);
      } else {
        // Video recording toggle
        if (!recording) {
          recordedChunks = [];
          mediaRecorder = new MediaRecorder(activeStream, { mimeType: 'video/webm' });
          mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
          mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            const file = new File([blob], `video-${Date.now()}.webm`, { type: 'video/webm' });
            addFiles(fieldName, [file], previewEl, multi);
            closeCamera();
          };
          mediaRecorder.start();
          recording = true;
          btnCapture.textContent = '⏹ Aufnahme stoppen';
          btnCapture.style.background = '#e53935';
        } else {
          mediaRecorder.stop();
          recording = false;
        }
      }
    };

    // Clean up old listener
    const newBtn = btnCapture.cloneNode(true);
    btnCapture.replaceWith(newBtn);
    newBtn.addEventListener('click', captureHandler);

    const closeHandler = () => closeCamera();
    const newClose = btnClose.cloneNode(true);
    btnClose.replaceWith(newClose);
    newClose.addEventListener('click', closeHandler);

    // Update global refs
    document.getElementById('btnCapture').addEventListener || null; // no-op, refs are already replaced
  }

  function closeCamera() {
    if (activeStream) {
      activeStream.getTracks().forEach(t => t.stop());
      activeStream = null;
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    $('#cameraVideo').srcObject = null;
    $('#cameraModal').classList.remove('open');
  }

  // ── Signature Pads ─────────────────────────────────────
  function initSignaturePads() {
    $$('.signature-wrapper').forEach(wrapper => {
      const name   = wrapper.dataset.name;
      const canvas = $('canvas', wrapper);
      const pad    = new SignaturePad(canvas, {
        backgroundColor: 'rgb(255,255,255)',
        penColor: 'rgb(0, 0, 0)',
      });
      signaturePads[name] = pad;

      // Clear button
      $('.btn-clear-sig', wrapper).addEventListener('click', () => {
        pad.clear();
        wrapper.style.borderColor = '';
      });

      // On signature begin → clear validation error
      pad.addEventListener('beginStroke', () => {
        wrapper.style.borderColor = '';
      });
    });
    resizeAllSignatureCanvases();
    window.addEventListener('resize', () => resizeAllSignatureCanvases());
  }

  function resizeAllSignatureCanvases() {
    for (const [name, pad] of Object.entries(signaturePads)) {
      const canvas  = pad.canvas;
      const wrapper = canvas.parentElement;
      const ratio   = Math.max(window.devicePixelRatio || 1, 1);
      const w       = wrapper.clientWidth - 16;

      // Save current data
      const data = pad.toData();

      canvas.width  = w * ratio;
      canvas.height = 200 * ratio;
      canvas.style.width  = w + 'px';
      canvas.style.height = '200px';
      canvas.getContext('2d').scale(ratio, ratio);

      pad.clear();
      if (data.length) pad.fromData(data);
    }
  }

  // ── Conditional Fields ─────────────────────────────────
  function bindConditionalFields() {
    $$('.conditional-field').forEach(el => {
      const watchName  = el.dataset.showWhen;
      const watchValue = el.dataset.showValue;

      // Listen on radios and selects
      $$(`input[name="${watchName}"], select[name="${watchName}"]`, form).forEach(input => {
        input.addEventListener('change', () => {
          const current = input.type === 'radio'
            ? ($$(`input[name="${watchName}"]:checked`, form)[0]?.value || '')
            : input.value;
          el.classList.toggle('visible', current === watchValue);
        });
      });
    });
  }

  // ── Auftrags-Nr Sync ───────────────────────────────────
  function bindAuftragsNrSync() {
    const auftragsInput = $('input[name="auftragsNummer"]');
    const display       = $('.auftrag-nr-display');
    if (!auftragsInput || !display) return;

    auftragsInput.addEventListener('input', () => {
      display.textContent = auftragsInput.value || 'A-___';
    });
  }

  // ── Toast Notifications ────────────────────────────────
  function showToast(msg, type = '') {
    toast.textContent = msg;
    toast.className = 'toast visible ' + type;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.className = 'toast'; }, 3500);
  }

  // ── Boot ───────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);
})();
