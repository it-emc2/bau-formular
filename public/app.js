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
  const btnHeaderDemoPrefill = $('#btnHeaderDemoPrefill');
  const bitrixSearch  = $('#bitrixSearch');
  const bitrixDealList = $('#bitrixDealList');
  const draftSearch = $('#draftSearch');
  const btnDraftRefresh = $('#btnDraftRefresh');
  const draftList = $('#draftList');
  const bitrixSidebar = $('.bitrix-sidebar');
  const draftsPanel = $('.drafts-panel');
  const arbeitsberichtSearch = $('#arbeitsberichtSearch');
  const btnArbeitsberichtSearch = $('#btnArbeitsberichtSearch');
  const arbeitsberichtResultList = $('#arbeitsberichtResultList');
  const arbeitsberichtStatus = $('#arbeitsberichtStatus');
  const arbeitsberichtLoading = $('#arbeitsberichtLoading');
  const arbeitsberichtLoadingTimer = $('#arbeitsberichtLoadingTimer');
  const arbeitsberichtPreview = $('#arbeitsberichtPreview');
  const arbeitsberichtPreviewFrame = $('#arbeitsberichtPreviewFrame');
  const arbeitsberichtPreviewDownload = $('#arbeitsberichtPreviewDownload');
  const emailEmpfaenger = $('#emailEmpfaenger');
  const bitrixAuftragId = $('#bitrixAuftragId');
  const checklistStepTitle = $('#checklistStepTitle');
  const checklistStepIntro = $('#checklistStepIntro');
  const bitrixDebugFields = $('#bitrixDebugFields');
  const btnPreviewDocument = $('#btnPreviewDocument');
  const btnDownloadDocument = $('#btnDownloadDocument');
  const btnEmailDocument = $('#btnEmailDocument');
  const btnBitrixDocument = $('#btnBitrixDocument');
  const documentStatus = $('#documentStatus');
  const documentPreview = $('#documentPreview');
  const documentPreviewFrame = $('#documentPreviewFrame');
  const documentPreviewOpen = $('#documentPreviewOpen');
  const documentPreviewDownload = $('#documentPreviewDownload');
  const toast         = $('#toast');
  const EXTERNAL_APP_BASE_URL = 'https://angebotskonfigurator-emc2-v2.fly.dev';

  const TOTAL_STEPS = 10;
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
  let arbeitsberichtResults = [];
  let activeArbeitsberichtSelection = null;
  let arbeitsberichtSearchTerm = '';
  let arbeitsberichtSearchDebounceId = null;
  let arbeitsberichtPreviewUrl = null;
  let arbeitsberichtLoadingIntervalId = null;
  let arbeitsberichtLoadingStartedAt = null;
  let documentPreviewUrl = null;
  let documentDownloadUrl = null;
  let documentDownloadFilename = null;
  let currentChecklistVariant = 'badumbau';

  const BITRIX_ACTIVITY_FIELD_KEYS = ['UF_CRM_1725521281342', 'ufCrm_1725521281342'];
  const BITRIX_AUSZUFUEHRENDE_TAETIGKEITEN_MAP = {
    '5666': '[HMS] Objektbetreuung',
    '8162': '[HMS] Gartenarbeiten',
    '4564': '[AH] Alltagsbegleitung',
    '4566': '[AH] Haushaltsnahe Dienstleistungen',
    '4024': '[HD] Umbau Dusche zu Dusche',
    '4026': '[HD] Umbau Wanne zu Dusche',
    '4706': '[HD] Badrenovierung',
    '4704': '[HD] Badewannentüre',
    '7730': '[HD] Badumbau',
    '4032': '[HD] Haltegriffe',
    '4034': '[HD] Handläufe',
    '6820': '[HD] Entrümpelung',
    '4052': '[HD] Winterdienst',
    '7030': '[KFZ] Autoreparatur',
    '4158': 'Sonstige',
  };

  function buildFullName(data) {
    return [data.anrede, data.vorname, data.nachname]
      .map(value => (value || '').trim())
      .filter(Boolean)
      .join(' ');
  }

  function setAuszufuehrendeTaetigkeitenValue(value) {
    const field = fields?.auszufuehrendeTaetigkeiten || $('[name="auszufuehrendeTaetigkeiten"]');
    if (!field) return;
    if (Array.isArray(value)) {
      field.value = value.filter(Boolean).join(', ');
      return;
    }
    field.value = value ? String(value) : '';
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
    syncDevOnlySteps();
    buildStepDots();
    bindNavigation();
    bindFileUploads();
    bindConditionalFields();
    bindAuftragsNrSync();
    bindConfirmationLetterSync();
    bindBitrixAutofill();
    bindDraftLookup();
    bindArbeitsberichtLookup();
    bindDocumentActions();
    initSignaturePads();
    initDevModeToggle();
    loadDraftIfNeeded();
    showStep(getFirstVisibleStep());
    fetchBitrixDeals();
    fetchDrafts();
    renderArbeitsberichtResults([], 'Noch keine externen Treffer geladen.');
  }

  // ── Step Indicator Dots ────────────────────────────────
  function getAllStepSections() {
    return $$('.form-step', form);
  }

  function isStepVisible(stepNumber) {
    const section = $(`.form-step[data-step="${stepNumber}"]`, form);
    if (!section) return false;
    return !section.classList.contains('hidden');
  }

  function getVisibleStepNumbers() {
    return getAllStepSections()
      .filter(section => !section.classList.contains('hidden'))
      .map(section => Number(section.dataset.step))
      .sort((a, b) => a - b);
  }

  function getFirstVisibleStep() {
    return getVisibleStepNumbers()[0] || 1;
  }

  function getLastVisibleStep() {
    const steps = getVisibleStepNumbers();
    return steps[steps.length - 1] || TOTAL_STEPS;
  }

  function getNextVisibleStep(stepNumber) {
    const steps = getVisibleStepNumbers();
    return steps.find(step => step > stepNumber) || stepNumber;
  }

  function getPreviousVisibleStep(stepNumber) {
    const steps = getVisibleStepNumbers().filter(step => step < stepNumber);
    return steps[steps.length - 1] || stepNumber;
  }

  function buildStepDots() {
    const steps = getVisibleStepNumbers();
    stepIndicator.innerHTML = '';
    steps.forEach((step, index) => {
      const dot = document.createElement('div');
      dot.className = 'step-dot';
      dot.textContent = index + 1;
      dot.dataset.step = step;
      stepIndicator.appendChild(dot);
    });
  }

  function updateStepDots() {
    const visibleSteps = getVisibleSteps();
    const currentVisibleIndex = getCurrentVisibleIndex();
    $$('.step-dot', stepIndicator).forEach((dot, idx) => {
      dot.classList.remove('active', 'completed');
      if (idx < currentVisibleIndex) dot.classList.add('completed');
      if (idx === currentVisibleIndex) dot.classList.add('active');
    });
  }

  function getVisibleSteps() {
    return $$('.form-step', form).filter(step => {
      if (step.classList.contains('dev-only-step') && !devMode) return false;
      return true;
    });
  }

  function getVisibleStepNumber(stepEl) {
    return getVisibleSteps().indexOf(stepEl) + 1;
  }

  function getCurrentVisibleIndex() {
    const visibleSteps = getVisibleSteps();
    const current = visibleSteps.findIndex(step => +step.dataset.step === currentStep);
    return current >= 0 ? current : 0;
  }

  function syncDevOnlySteps() {
    $$('.dev-only-step', form).forEach(step => {
      step.classList.toggle('hidden', !devMode);
    });

    const visibleSteps = getVisibleSteps();
    TOTAL_STEPS = visibleSteps.length;

    const currentVisible = visibleSteps.some(step => +step.dataset.step === currentStep);
    if (!currentVisible && visibleSteps.length) {
      currentStep = +visibleSteps[0].dataset.step;
    }
  }


  // ── Show / Hide Steps ─────────────────────────────────
  function showStep(n) {
    const visibleSteps = getVisibleStepNumbers();
    const targetStep = visibleSteps.includes(Number(n)) ? Number(n) : getFirstVisibleStep();

    currentStep = targetStep;
    $$('.form-step', form).forEach(sec => {
      sec.classList.toggle('active', Number(sec.dataset.step) === targetStep);
    });
    updateStepDots();

    const currentIndex = visibleSteps.indexOf(targetStep);
    stepCounter.textContent = `${currentIndex + 1}/${visibleSteps.length}`;

    // Button visibility
    btnBack.style.display   = targetStep === getFirstVisibleStep() ? 'none' : 'inline-flex';
    btnNext.style.display   = targetStep === getLastVisibleStep() ? 'none' : 'inline-flex';
    btnSubmit.style.display = targetStep === getLastVisibleStep() ? 'inline-flex' : 'none';

    // Re-init signature pads when step becomes visible (canvas resize)
    requestAnimationFrame(() => resizeAllSignatureCanvases());

    // Scroll to top of card
    $('.form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Navigation ─────────────────────────────────────────
  function bindNavigation() {
    btnNext.addEventListener('click', () => {
      if (devMode || validateStep(currentStep)) {
        showStep(getNextVisibleStep(currentStep));
      }
    });

    btnBack.addEventListener('click', () => {
      showStep(getPreviousVisibleStep(currentStep));
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
    if (btnHeaderDemoPrefill) btnHeaderDemoPrefill.classList.toggle('hidden', !devMode);
    if (bitrixDebugFields) bitrixDebugFields.classList.toggle('hidden', !devMode);

    // Hide Bitrix-Aufträge + Entwürfe completely when Testmodus is off
    if (devToolsPanel) {
      const dealTitle = devToolsPanel.querySelector('.bitrix-panel-title');
      const dealSubtitle = devToolsPanel.querySelector('.bitrix-panel-subtitle');
      if (dealTitle) dealTitle.closest('.dev-tools-head')?.classList.toggle('hidden', !devMode);
      if (bitrixSearch) bitrixSearch.closest('.bitrix-toolbar')?.classList.toggle('hidden', !devMode);
      if (bitrixDealList) bitrixDealList.classList.toggle('hidden', !devMode);
      if (draftsPanel) draftsPanel.classList.toggle('hidden', !devMode);
      if (btnBitrixAutofill) btnBitrixAutofill.classList.toggle('hidden', !devMode);
    syncDevSidebarVisibility();
    }

function syncDevSidebarVisibility() {
  const sidebar = document.querySelector('.bitrix-sidebar');
  const step1Layout = document.querySelector('.step1-layout');

  if (sidebar) {
    sidebar.classList.toggle('hidden', !devMode);
    syncDevOnlySteps();
    buildStepDots();
    updateStepDots();
    const visibleSteps = getVisibleSteps();
    const currentVisible = visibleSteps.some(step => +step.dataset.step === currentStep);
    if (!currentVisible && visibleSteps.length) {
      currentStep = +visibleSteps[0].dataset.step;
    }
    showStep(currentStep);
  }

  if (step1Layout) {
    step1Layout.classList.toggle('sidebar-hidden', !devMode);
  }
}


    const emptyStateId = 'demoSidebarState';
    const existingState = document.getElementById(emptyStateId);
    if (existingState && !devMode) {
      existingState.remove();
    }
  }

  function setSidebarSourcesHidden(hidden) {
    const shouldHide = Boolean(hidden);

    if (bitrixSearch) {
      const toolbar = bitrixSearch.closest('.bitrix-toolbar');
      if (toolbar) toolbar.classList.toggle('hidden', shouldHide);
    }

    if (bitrixDealList) bitrixDealList.classList.toggle('hidden', shouldHide);
    if (draftsPanel) draftsPanel.classList.toggle('hidden', shouldHide);

    const emptyStateId = 'demoSidebarState';
    let state = document.getElementById(emptyStateId);
    if (shouldHide) {
      if (!state && devToolsPanel) {
        state = document.createElement('div');
        state.id = emptyStateId;
        state.className = 'bitrix-empty';
        state.style.marginTop = '12px';
        state.textContent = 'Musterdaten aktiv – Bitrix-Aufträge und Entwürfe sind ausgeblendet.';
        devToolsPanel.appendChild(state);
      }
    } else if (state) {
      state.remove();
    }
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

    if (btnHeaderDemoPrefill) {
      btnHeaderDemoPrefill.addEventListener('click', prefillDemoData);
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

  function bindDocumentActions() {
    if (btnPreviewDocument) {
      btnPreviewDocument.addEventListener('click', () => previewDocument());
    }

    if (btnDownloadDocument) {
      btnDownloadDocument.addEventListener('click', () => downloadDocument());
    }

    if (btnEmailDocument) {
      btnEmailDocument.addEventListener('click', () => emailDocument());
    }

    if (btnBitrixDocument) {
      btnBitrixDocument.addEventListener('click', () => sendDocumentToBitrix());
    }

    if (documentPreviewOpen) {
      documentPreviewOpen.addEventListener('click', event => {
        if (!documentPreviewUrl) {
          event.preventDefault();
        }
      });
    }

    if (documentPreviewDownload) {
      documentPreviewDownload.addEventListener('click', event => {
        if (!documentDownloadUrl) {
          event.preventDefault();
        }
      });
    }
  }

  function bindArbeitsberichtLookup() {
    if (btnArbeitsberichtSearch) {
      btnArbeitsberichtSearch.addEventListener('click', searchArbeitsberichtRecords);
    }

    if (arbeitsberichtPreviewDownload) {
      arbeitsberichtPreviewDownload.addEventListener('click', event => {
        if (!arbeitsberichtPreviewUrl) {
          event.preventDefault();
        }
      });
    }

    if (arbeitsberichtSearch) {
      arbeitsberichtSearch.addEventListener('input', () => {
        arbeitsberichtSearchTerm = arbeitsberichtSearch.value.trim();
        window.clearTimeout(arbeitsberichtSearchDebounceId);

        if (!arbeitsberichtSearchTerm) {
          arbeitsberichtResults = [];
          renderArbeitsberichtResults([], 'Noch keine externen Treffer geladen.');
          return;
        }

        arbeitsberichtSearchDebounceId = window.setTimeout(searchArbeitsberichtRecords, 250);
      });

      arbeitsberichtSearch.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        window.clearTimeout(arbeitsberichtSearchDebounceId);
        searchArbeitsberichtRecords();
      });
    }
  }

  async function fetchBitrixDeals() {
    if (!bitrixDealList) return;

    if (btnBitrixRefresh) btnBitrixRefresh.disabled = true;
    renderBitrixDeals([], 'Bitrix-Deals werden geladen...');

    try {
      const itemRes = await fetch(
        `/api/bitrix/items/by-stage?entityTypeId=${BITRIX_TEST_ENTITY_TYPE_ID}&stageId=${encodeURIComponent(BITRIX_STAGE_ID)}&useOriginalUfNames=N&select=id,title,stageId,contactId,opportunity,assignedById,createdTime,begindate,closeDate,UF_CRM_1725521281342,ufCrm_1725521281342`
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
      let hydratedItem = item;
      try {
        const detailRes = await fetch(`/api/bitrix/items/${encodeURIComponent(item.id)}`);
        const detailJson = await detailRes.json();
        hydratedItem = detailJson?.result || detailJson || item;
      } catch (_error) {
        hydratedItem = item;
      }

      applyBitrixItemToForm(hydratedItem);
      setSidebarSourcesHidden(false);

      const contactId = hydratedItem.contactId || item.contactId;
      if (contactId) {
        const contact = hydratedItem._contact || item._contact || await fetchBitrixContact(contactId);
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

  async function searchArbeitsberichtRecords() {
    if (!arbeitsberichtResultList) return;

    const query = String(arbeitsberichtSearchTerm || arbeitsberichtSearch?.value || '').trim();

    if (!query) {
      arbeitsberichtResults = [];
      renderArbeitsberichtResults([], 'Noch keine externen Treffer geladen.');
      clearArbeitsberichtPreview();
      return;
    }

    if (btnArbeitsberichtSearch) btnArbeitsberichtSearch.disabled = true;
    setArbeitsberichtStatus('Externe Treffer werden geladen...');
    renderArbeitsberichtResults([], 'Externe Treffer werden geladen...');
    clearArbeitsberichtPreview();

    try {
      const json = await fetchExternalJson(
        `${EXTERNAL_APP_BASE_URL}/api/offers/external/search?q=${encodeURIComponent(query)}&limit=20`
      );

      arbeitsberichtResults = json.results || [];
      renderArbeitsberichtResults(
        arbeitsberichtResults,
        arbeitsberichtResults.length ? '' : 'Keine passenden externen Treffer gefunden.'
      );
      setArbeitsberichtStatus(
        arbeitsberichtResults.length
          ? 'Treffer gefunden. Waehle den passenden Eintrag fuer den PDF-Abruf.'
          : 'Keine passenden externen Treffer gefunden.',
        arbeitsberichtResults.length ? 'success' : ''
      );
    } catch (error) {
      arbeitsberichtResults = [];
      renderArbeitsberichtResults([], 'Fehler bei der externen Suche.');
      setArbeitsberichtStatus(`Fehler bei der externen Suche: ${error.message}`, 'error');
      showToast('Fehler bei der externen Suche: ' + error.message, 'error');
    } finally {
      if (btnArbeitsberichtSearch) btnArbeitsberichtSearch.disabled = false;
    }
  }

  function renderArbeitsberichtResults(items, emptyMessage = 'Noch keine externen Treffer geladen.') {
    if (!arbeitsberichtResultList) return;

    if (!items.length) {
      arbeitsberichtResultList.innerHTML = `<p class="bitrix-empty">${emptyMessage}</p>`;
      return;
    }

    arbeitsberichtResultList.innerHTML = '';

    items.forEach(item => {
      const card = document.createElement('article');
      const identifier = getArbeitsberichtIdentifier(item);
      const meta = [
        item.kind === 'draft' ? 'Entwurf' : 'Angebot',
        identifier ? `${item.kind === 'draft' ? 'ID' : 'Nr.'} ${identifier}` : '',
        item.updatedAt ? `aktualisiert ${formatShortDate(item.updatedAt)}` : '',
      ].filter(Boolean);

      card.className = 'bitrix-deal-card';
      if (isActiveArbeitsberichtSelection(item)) card.classList.add('active');

      card.innerHTML = `
        <div class="bitrix-deal-top">
          <div>
            <div class="bitrix-deal-title">${escapeHtml(buildArbeitsberichtTitle(item))}</div>
            ${buildArbeitsberichtSubtitle(item) ? `<div class="bitrix-deal-offer">${escapeHtml(buildArbeitsberichtSubtitle(item))}</div>` : ''}
            <div class="bitrix-deal-sub">${escapeHtml(meta.join(' · '))}</div>
            ${buildArbeitsberichtMetaLine(item) ? `<div class="bitrix-deal-contact">${escapeHtml(buildArbeitsberichtMetaLine(item))}</div>` : ''}
          </div>
          <div class="bitrix-deal-meta">
            ${item.offerType ? `<span class="bitrix-chip">${escapeHtml(String(item.offerType).toUpperCase())}</span>` : ''}
            ${item.city ? `<span class="bitrix-chip">${escapeHtml(item.city)}</span>` : ''}
          </div>
        </div>
        <button type="button" class="bitrix-deal-action">Arbeitsbericht laden</button>
      `;

      $('.bitrix-deal-action', card).addEventListener('click', () => downloadArbeitsberichtPdf(item));
      arbeitsberichtResultList.appendChild(card);
    });
  }

  function getArbeitsberichtIdentifier(item = {}) {
    if (item.kind === 'draft') return String(item.id || '').trim();
    return String(item.offerNumber || item.angNumber || '').trim();
  }

  function buildArbeitsberichtTitle(item = {}) {
    return [item.firstName, item.lastName]
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .join(' ') || item.title || item.email || 'Unbenannter Treffer';
  }

  function buildArbeitsberichtSubtitle(item = {}) {
    return [
      item.angNumber || item.offerNumber || '',
      item.customerNumber ? `Kunde ${item.customerNumber}` : '',
    ].filter(Boolean).join(' · ');
  }

  function buildArbeitsberichtMetaLine(item = {}) {
    return [
      item.email || '',
      item.phone || '',
      [item.postalCode, item.city].filter(Boolean).join(' '),
    ].filter(Boolean).join(' · ');
  }

  function isActiveArbeitsberichtSelection(item = {}) {
    if (!activeArbeitsberichtSelection?.kind) return false;
    if (activeArbeitsberichtSelection.kind !== item.kind) return false;
    return activeArbeitsberichtSelection.identifier === getArbeitsberichtIdentifier(item);
  }

  function setArbeitsberichtStatus(message, tone = '') {
    if (!arbeitsberichtStatus) return;
    arbeitsberichtStatus.textContent = message;
    arbeitsberichtStatus.dataset.tone = tone;
  }

  async function fetchExternalJson(url) {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      credentials: 'include',
    });

    const rawBody = await response.text();
    let json = null;

    try {
      json = rawBody ? JSON.parse(rawBody) : null;
    } catch (_error) {
      json = null;
    }

    if (!response.ok) {
      throw new Error(json?.error || json?.message || `External request failed: ${response.status}`);
    }

    if (!json || typeof json !== 'object') {
      throw new Error('External app did not return valid JSON');
    }

    return json;
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
      setSidebarSourcesHidden(false);
      formId = data._id;
      shareToken = data.shareToken || null;
      activeDraftId = data._id;

      resetFormState();
      populateForm(data);
      renderDrafts(drafts);
      showStep(getFirstVisibleStep());
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
      bitrixZusatzfeld: 'DBG-ANG-2026-001',
      bitrixAuszufuehrendeTaetigkeiten: '[HD] Badumbau',
      bitrixAuftragId: '90001',
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

    prefillDemoUploads();
    updateChecklistVariant(textValues.bitrixAuszufuehrendeTaetigkeiten);
    updateConfirmationLetterPreview();
    setSidebarSourcesHidden(true);
    showToast('Musterdaten komplett eingefüllt – inklusive Signaturen, Testfotos und Testvideo.', 'success');
  }

  function clearUploadField(fieldName) {
    const wrapper = $(`.file-upload[data-name="${fieldName}"]`);
    if (!wrapper) return null;
    const preview = $('.file-preview', wrapper);
    fileStore[fieldName] = [];
    if (preview) preview.innerHTML = '';
    return preview;
  }

  function createDemoImageFile(label = 'Musterfoto') {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
        <rect width="1200" height="900" fill="#f5f7fb"/>
        <rect x="60" y="60" width="1080" height="780" rx="44" fill="#ffffff" stroke="#253a75" stroke-width="10"/>
        <text x="600" y="380" text-anchor="middle" font-size="72" font-family="Segoe UI, Arial, sans-serif" fill="#253a75">emc2 Musterdaten</text>
        <text x="600" y="500" text-anchor="middle" font-size="42" font-family="Segoe UI, Arial, sans-serif" fill="#4a4a4a">${label}</text>
      </svg>
    `.trim();
    return new File([svg], `${slugify(label)}.svg`, { type: 'image/svg+xml' });
  }

  function createDemoVideoFile(label = 'Testvideo') {
    const content = `emc2 Musterdaten – ${label}`;
    return new File([content], `${slugify(label)}.webm`, { type: 'video/webm' });
  }

  function slugify(value = '') {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'datei';
  }

  function prefillDemoUploads() {
    const fertigerUmbauPreview = clearUploadField('bilderFertigerUmbau');
    if (fertigerUmbauPreview) {
      addFiles('bilderFertigerUmbau', [
        createDemoImageFile('Fertiger Umbau 1'),
        createDemoImageFile('Fertiger Umbau 2'),
      ], fertigerUmbauPreview, true);
    }

    const videoPreview = clearUploadField('videoDesAblaufs');
    if (videoPreview) {
      addFiles('videoDesAblaufs', [createDemoVideoFile('Video des Ablaufs')], videoPreview, false);
    }

    const abdichtungPreview = clearUploadField('fotosAbdichtung');
    if (abdichtungPreview) {
      addFiles('fotosAbdichtung', [createDemoImageFile('Fotos der Abdichtung')], abdichtungPreview, true);
    }
  }

  function resolveBitrixActivities(item = {}) {
    const rawValues = [];

    BITRIX_ACTIVITY_FIELD_KEYS.forEach(key => {
      const value = item?.[key];
      if (Array.isArray(value)) rawValues.push(...value);
      else if (value !== undefined && value !== null && value !== '') rawValues.push(value);
    });

    const normalized = rawValues
      .flatMap(value => String(value || '').split(','))
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .map(value => BITRIX_AUSZUFUEHRENDE_TAETIGKEITEN_MAP[value] || value);

    return [...new Set(normalized)].join(', ');
  }

  function deriveChecklistVariant(value = '') {
    const normalized = String(value || '').toLowerCase();
    if (normalized.includes('handläufe') || normalized.includes('handlaeufe')) return 'handlaeufe';
    if (normalized.includes('badewannentür') || normalized.includes('badewannentuer') || normalized.includes('badewannentüre') || normalized.includes('badewannentuere')) return 'badewannentuer';
    return 'badumbau';
  }

  function updateChecklistVariant(value = '') {
    currentChecklistVariant = deriveChecklistVariant(value);

    if (checklistStepTitle) {
      checklistStepTitle.textContent = currentChecklistVariant === 'handlaeufe'
        ? 'Checkliste Handläufe'
        : currentChecklistVariant === 'badewannentuer'
          ? 'Checkliste Badewannentür'
          : 'Checkliste Badumbau';
    }

    if (checklistStepIntro) {
      checklistStepIntro.textContent = currentChecklistVariant === 'badumbau'
        ? 'Bitte alle Punkte abhaken, sobald sie erledigt oder geprüft wurden.'
        : 'Bitte die zur Ausführung passende Checkliste vollständig prüfen und abhaken.';
    }

    $$('[data-checklist-only]', form).forEach(el => {
      const only = String(el.dataset.checklistOnly || '').trim().toLowerCase();
      el.classList.toggle('hidden', Boolean(only) && only !== currentChecklistVariant);
    });
  }

  function bindConfirmationLetterSync() {
    [
      'anrede','vorname','nachname','adresse.strasse','adresse.adresszeile2','adresse.plz','adresse.stadt','bitrixZusatzfeld','auftragsNummer','bitrixAuszufuehrendeTaetigkeiten'
    ].forEach(name => {
      const input = form.querySelector(`[name="${name}"]`);
      if (!input) return;
      input.addEventListener('input', updateConfirmationLetterPreview);
      input.addEventListener('change', updateConfirmationLetterPreview);
    });
    updateConfirmationLetterPreview();
  }

  function updateConfirmationLetterPreview() {
    const getValue = name => (form.querySelector(`[name="${name}"]`)?.value || '').trim();
    const anrede = getValue('anrede');
    const vorname = getValue('vorname');
    const nachname = getValue('nachname');
    const customerName = anrede === 'Familie' && nachname ? `Familie ${nachname}` : [vorname, nachname].filter(Boolean).join(' ') || 'Max Mustermann';
    const street = getValue('adresse.strasse') || 'Musterstraße 42';
    const line2 = getValue('adresse.adresszeile2') || '2. OG links';
    const plz = getValue('adresse.plz') || '04109';
    const city = getValue('adresse.stadt') || 'Leipzig';
    const orderId = getValue('bitrixZusatzfeld') || getValue('auftragsNummer') || 'DBG-ANG-2026-001';
    const now = new Date();
    const monthYear = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' }).format(now);
    const monthYearCapitalized = monthYear.charAt(0).toUpperCase() + monthYear.slice(1);

    $$('.kunde-name-display').forEach(el => { el.textContent = customerName; });
    const streetEl = $('.adresse-strasse-display'); if (streetEl) streetEl.textContent = street;
    const line2El = $('.adresse-adresszeile2-display'); if (line2El) line2El.textContent = line2;
    const plzEl = $('.adresse-plz-display'); if (plzEl) plzEl.textContent = plz;
    $$('.adresse-stadt-display').forEach(el => { el.textContent = city; });
    const monthEl = $('.brief-monat-jahr-display'); if (monthEl) monthEl.textContent = monthYearCapitalized;
    const orderEl = $('.auftrag-nr-display'); if (orderEl) orderEl.textContent = orderId;
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
    const resolvedActivities = resolveBitrixActivities(item);
    setFieldValue('terminId', `BITRIX-${item.id}`);
    setFieldValue('auftragsNummer', item.title || `Bitrix ${item.id}`);
    setFieldValue('kundennummer', item.contactId || item.id);
    setFieldValue('bitrixAuftragId', item.id);
    setFieldValue('bitrixZusatzfeld', item.title || `Bitrix ${item.id}`);
          setAuszufuehrendeTaetigkeitenValue(record.auszufuehrendeTaetigkeiten || record.auszufuehrende_taetigkeiten || record.resolvedAuszufuehrendeTaetigkeiten || record.ufCrm_1725521281342Resolved || record.UF_CRM_1725521281342_RESOLVED || '');
setFieldValue('bitrixAuszufuehrendeTaetigkeiten', resolvedActivities);
    updateChecklistVariant(resolvedActivities);
    updateConfirmationLetterPreview();
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
    for (const step of getVisibleStepNumbers()) {
      if (!validateStep(step)) {
        showStep(step);
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

  async function requestDocument(endpoint, extraPayload = {}) {
    const response = await fetch(`/api/form/document/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...extraPayload,
        formData: collectFormData(),
      }),
    });

    const responseText = await response.text();
    let json;

    try {
      json = responseText ? JSON.parse(responseText) : {};
    } catch (_error) {
      throw new Error(responseText.slice(0, 200) || 'Unerwartete Server-Antwort');
    }

    if (!json.success) {
      throw new Error(json.error || 'Dokument konnte nicht verarbeitet werden');
    }

    return json;
  }

  function setDocumentStatus(message, tone = '') {
    if (!documentStatus) return;
    documentStatus.textContent = message;
    documentStatus.dataset.tone = tone;
  }

  async function previewDocument() {
    try {
      setDocumentStatus('Vorschau wird erstellt...');

      const json = await requestDocument('render');
      setDocumentPreviewContent(json.document);
      setDocumentStatus('Vorschau im Formular angezeigt.', 'success');
      showToast('Vorschau geladen.', 'success');
    } catch (error) {
      clearDocumentPreview();
      setDocumentStatus(`Fehler bei der Vorschau: ${error.message}`, 'error');
      showToast('Fehler bei der Vorschau: ' + error.message, 'error');
    }
  }

  function setDocumentPreviewContent(document) {
    if (!documentPreview || !documentPreviewFrame || !documentPreviewOpen || !documentPreviewDownload) return;

    if (documentPreviewUrl) {
      URL.revokeObjectURL(documentPreviewUrl);
    }
    if (documentDownloadUrl) {
      URL.revokeObjectURL(documentDownloadUrl);
    }

    const previewBlob = new Blob([document.html], { type: 'text/html;charset=utf-8' });
    const downloadBlob = new Blob([document.html], { type: 'application/msword' });

    documentPreviewUrl = URL.createObjectURL(previewBlob);
    documentDownloadUrl = URL.createObjectURL(downloadBlob);
    documentDownloadFilename = document.fileName || 'bestaetigung.doc';

    documentPreviewFrame.src = documentPreviewUrl;
    documentPreviewOpen.href = documentPreviewUrl;
    documentPreviewOpen.target = '_blank';
    documentPreviewOpen.rel = 'noopener noreferrer';
    documentPreviewDownload.href = documentDownloadUrl;
    documentPreviewDownload.download = documentDownloadFilename;
    documentPreview.classList.remove('hidden');
  }

  function clearDocumentPreview() {
    if (!documentPreview || !documentPreviewFrame || !documentPreviewOpen || !documentPreviewDownload) return;

    if (documentPreviewUrl) {
      URL.revokeObjectURL(documentPreviewUrl);
      documentPreviewUrl = null;
    }
    if (documentDownloadUrl) {
      URL.revokeObjectURL(documentDownloadUrl);
      documentDownloadUrl = null;
    }
    documentDownloadFilename = null;

    documentPreviewFrame.removeAttribute('src');
    documentPreviewOpen.setAttribute('href', '#');
    documentPreviewOpen.removeAttribute('target');
    documentPreviewOpen.removeAttribute('rel');
    documentPreviewDownload.setAttribute('href', '#');
    documentPreviewDownload.removeAttribute('download');
    documentPreview.classList.add('hidden');
  }

  async function downloadDocument() {
    try {
      setDocumentStatus('Dokument wird vorbereitet...');
      const json = await requestDocument('render');
      const blob = new Blob([json.document.html], { type: 'application/msword' });
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = json.document.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      setDocumentStatus(`Dokument heruntergeladen: ${json.document.fileName}`, 'success');
      showToast('Dokument heruntergeladen.', 'success');
    } catch (error) {
      setDocumentStatus(`Fehler beim Download: ${error.message}`, 'error');
      showToast('Fehler beim Download: ' + error.message, 'error');
    }
  }

  async function downloadArbeitsberichtPdf(item) {
    try {
      const selectedItem = item || activeArbeitsberichtSelection;
      const kind = String(selectedItem?.kind || '').trim();
      const identifier = String(selectedItem?.identifier || getArbeitsberichtIdentifier(selectedItem || {})).trim();

      if (!kind || !identifier) {
        throw new Error('Bitte zuerst einen externen Entwurf oder ein Angebot auswaehlen');
      }

      activeArbeitsberichtSelection = {
        kind,
        identifier,
      };
      renderArbeitsberichtResults(arbeitsberichtResults);
      setArbeitsberichtStatus('Arbeitsbericht PDF wird erstellt...');
      setDocumentStatus('Arbeitsbericht PDF wird erstellt...');
      clearArbeitsberichtPreview();
      setArbeitsberichtLoading(true);

      const detailUrl = kind === 'draft'
        ? `${EXTERNAL_APP_BASE_URL}/api/offers/external/drafts/${encodeURIComponent(identifier)}`
        : `${EXTERNAL_APP_BASE_URL}/api/offers/external/offers/${encodeURIComponent(identifier)}`;
      const detailJson = await fetchExternalJson(detailUrl);
      const response = await fetch(`${EXTERNAL_APP_BASE_URL}/api/arbeitsbericht/pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/pdf',
        },
        body: JSON.stringify(detailJson.payload || {}),
        credentials: 'include',
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(
          errorBody.error || `Arbeitsbericht PDF generation failed: ${response.status}`
        );
      }

      const contentDisposition = response.headers.get('content-disposition') || '';
      const filenameMatch = contentDisposition.match(/filename="?(.*?)"?$/i);
      const filename = filenameMatch?.[1] || 'Arbeitsbericht.pdf';
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      setArbeitsberichtPreviewBlob(url, filename);
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();

      setArbeitsberichtStatus(`Arbeitsbericht heruntergeladen: ${filename}`, 'success');
      setDocumentStatus(`Arbeitsbericht heruntergeladen: ${filename}`, 'success');
      showToast('Arbeitsbericht PDF heruntergeladen.', 'success');
    } catch (error) {
      setArbeitsberichtStatus(`Fehler beim Arbeitsbericht PDF: ${error.message}`, 'error');
      setDocumentStatus(`Fehler beim Arbeitsbericht PDF: ${error.message}`, 'error');
      showToast('Fehler beim Arbeitsbericht PDF: ' + error.message, 'error');
    } finally {
      setArbeitsberichtLoading(false);
    }
  }

  function setArbeitsberichtLoading(isLoading) {
    if (!arbeitsberichtLoading) return;

    if (isLoading) {
      arbeitsberichtLoading.classList.remove('hidden');
      arbeitsberichtLoadingStartedAt = Date.now();

      if (arbeitsberichtLoadingTimer) {
        arbeitsberichtLoadingTimer.textContent = '0s';
      }

      window.clearInterval(arbeitsberichtLoadingIntervalId);
      arbeitsberichtLoadingIntervalId = window.setInterval(() => {
        if (!arbeitsberichtLoadingStartedAt || !arbeitsberichtLoadingTimer) return;
        const seconds = Math.max(0, Math.floor((Date.now() - arbeitsberichtLoadingStartedAt) / 1000));
        arbeitsberichtLoadingTimer.textContent = `${seconds}s`;
      }, 250);
      return;
    }

    arbeitsberichtLoading.classList.add('hidden');
    arbeitsberichtLoadingStartedAt = null;
    window.clearInterval(arbeitsberichtLoadingIntervalId);
    arbeitsberichtLoadingIntervalId = null;
  }

  function setArbeitsberichtPreviewBlob(url, filename) {
    if (!arbeitsberichtPreview || !arbeitsberichtPreviewFrame || !arbeitsberichtPreviewDownload) return;

    if (arbeitsberichtPreviewUrl) {
      URL.revokeObjectURL(arbeitsberichtPreviewUrl);
    }

    arbeitsberichtPreviewUrl = url;
    arbeitsberichtPreviewFrame.src = url;
    arbeitsberichtPreviewDownload.href = url;
    arbeitsberichtPreviewDownload.download = filename || 'Arbeitsbericht.pdf';
    arbeitsberichtPreview.classList.remove('hidden');
  }

  function clearArbeitsberichtPreview() {
    if (!arbeitsberichtPreview || !arbeitsberichtPreviewFrame || !arbeitsberichtPreviewDownload) return;

    if (arbeitsberichtPreviewUrl) {
      URL.revokeObjectURL(arbeitsberichtPreviewUrl);
      arbeitsberichtPreviewUrl = null;
    }

    arbeitsberichtPreviewFrame.removeAttribute('src');
    arbeitsberichtPreviewDownload.setAttribute('href', '#');
    arbeitsberichtPreviewDownload.removeAttribute('download');
    arbeitsberichtPreview.classList.add('hidden');
  }

  async function emailDocument() {
    try {
      const to = emailEmpfaenger?.value.trim();
      if (!to) throw new Error('Bitte eine E-Mail-Adresse eintragen');

      setDocumentStatus('E-Mail wird vorbereitet...');
      const json = await requestDocument('email', { to });

      if (json.delivery === 'mailto' && json.mailtoUrl) {
        window.location.href = json.mailtoUrl;
        setDocumentStatus('Lokales E-Mail-Programm wurde mit dem Schreiben vorbereitet.', 'success');
        showToast('E-Mail-Entwurf geöffnet.', 'success');
        return;
      }

      setDocumentStatus('Dokument wurde per E-Mail versendet.', 'success');
      showToast('Dokument wurde per E-Mail versendet.', 'success');
    } catch (error) {
      setDocumentStatus(`Fehler beim E-Mail-Versand: ${error.message}`, 'error');
      showToast('Fehler beim E-Mail-Versand: ' + error.message, 'error');
    }
  }

  async function sendDocumentToBitrix() {
    try {
      const entityId = bitrixAuftragId?.value.trim();
      if (!entityId) throw new Error('Bitte eine Bitrix-Auftrag-ID eintragen');

      setDocumentStatus('Dokument wird an Bitrix gesendet...');
      await requestDocument('bitrix', { entityId });
      setDocumentStatus(`Dokumenttext wurde an Bitrix-Auftrag ${entityId} gesendet.`, 'success');
      showToast('Dokument an Bitrix gesendet.', 'success');
    } catch (error) {
      setDocumentStatus(`Fehler beim Bitrix-Versand: ${error.message}`, 'error');
      showToast('Fehler beim Bitrix-Versand: ' + error.message, 'error');
    }
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
        if (json.bitrixSync?.attempted && json.bitrixSync?.sent) {
          setDocumentStatus(`Dokumenttext wurde automatisch an Bitrix-Auftrag ${json.bitrixSync.entityId} gesendet.`, 'success');
          showToast('Erfolgreich übermittelt und an Bitrix gesendet! ✓', 'success');
        } else if (json.bitrixSync?.attempted && !json.bitrixSync?.sent) {
          setDocumentStatus(`Formular übermittelt, Bitrix-Sendung fehlgeschlagen: ${json.bitrixSync.error}`, 'error');
          showToast('Formular übermittelt, aber Bitrix konnte nicht aktualisiert werden.', 'error');
        } else {
          showToast('Erfolgreich übermittelt! ✓', 'success');
        }
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
    const bitrixZusatzfeldInput = $('input[name="bitrixZusatzfeld"]');
    const sync = () => updateConfirmationLetterPreview();
    if (auftragsInput) auftragsInput.addEventListener('input', sync);
    if (bitrixZusatzfeldInput) bitrixZusatzfeldInput.addEventListener('input', sync);
    sync();
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
