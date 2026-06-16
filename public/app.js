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
  const appSubtitle   = $('.subtitle');
  const btnBackToHome = $('#btnBackToHome');
  const btnBack       = $('#btnBack');
  const btnNext       = $('#btnNext');
  const btnDraft      = $('#btnDraft');
  const btnSubmit     = $('#btnSubmit');
  const btnDebugBitrix = $('#btnDebugBitrix');
  const devModeToggle = $('#devModeToggle');
  const devToolsPanel = $('#devToolsPanel');
  const devModeBadge  = $('#devModeBadge');
  const bitrixTestActions = $('#bitrixTestActions');
  const btnFetchBitrixLead = $('#btnFetchBitrixLead');
  const btnDemoPrefill = $('#btnDemoPrefill');
  const btnHeaderDemoPrefill = $('#btnHeaderDemoPrefill');
  const demoActivityPresetSelect = $('#demoActivityPreset');
  const adminCleanupPanel = $('#adminCleanupPanel');
  const btnCleanupPreview = $('#btnCleanupPreview');
  const btnCleanupDelete = $('#btnCleanupDelete');
  const adminCleanupOutput = $('#adminCleanupOutput');
  const adminLogPanel = $('#adminLogPanel');
  const btnAdminLogsRefresh = $('#btnAdminLogsRefresh');
  const btnAdminLogsClear = $('#btnAdminLogsClear');
  const adminLogOutput = $('#adminLogOutput');
  const adminStoragePanel = $('#adminStoragePanel');
  const btnStorageCheck = $('#btnStorageCheck');
  const btnStoragePreview = $('#btnStoragePreview');
  const btnStorageDelete = $('#btnStorageDelete');
  const adminStorageOutput = $('#adminStorageOutput');
  const adminPushPanel = $('#adminPushPanel');
  const adminPushEntityId = $('#adminPushEntityId');
  const btnAdminPushLoad = $('#btnAdminPushLoad');
  const adminPushCategories = $('#adminPushCategories');
  const adminPushActions = $('#adminPushActions');
  const btnAdminPushSend = $('#btnAdminPushSend');
  const adminPushOutput = $('#adminPushOutput');
  const draftSearch = $('#draftSearch');
  const btnDraftRefresh = $('#btnDraftRefresh');
  const draftList = $('#draftList');
  const homeDraftSearch = $('#homeDraftSearch');
  const btnHomeDraftSearch = $('#btnHomeDraftSearch');
  const homeDraftList = $('#homeDraftList');
  const homeSubmittedSearch = $('#homeSubmittedSearch');
  const btnHomeSubmittedSearch = $('#btnHomeSubmittedSearch');
  const homeSubmittedList = $('#homeSubmittedList');
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
  const debugDocumentPanel = $('#debugDocumentPanel');
  const formularTypInput = $('[name="formularTyp"]', form);
  const formularTypeCards = $$('[data-formular-type]', form);
  const step1Title = $('#step1Title');
  const step1Intro = $('#step1Intro');
  const toast         = $('#toast');
  const EXTERNAL_APP_BASE_URL = 'https://angebotskonfigurator-emc2-v2.fly.dev';

  const INITIAL_TOTAL_STEPS = 12;
  const FORMULAR_TYPE_DEFAULT = '';
  const FORMULAR_TYPE_PATHS = {
    baustellenabnahme: '/AbschlussderBaustelle',
    zusaetzliche_leistungen: '/BeauftragungzusatzlicheLeistungen',
    nachbesserung: '/Nachbesserung',
    schadensmeldung: '/Schadensmeldung',
  };
  const CHECKLIST_AUTO_CHECKBOXES = [
    'checklistDokumentWarenpruefung',
    'checklistBestaetigungKasse',
    'checklistDokumentArbeitsbericht',
  ];
  const CHECKLIST_BADUMBAU_REQUIRED_CHECKBOXES = [
    'checklistFotosWaerendUmsetzung',
    'checklistFinaleFotos',
    'checklistFotosHandwerkskoordination',
    'checklistVerbrauchsmaterialErfasst',
    'checklistWarenkorbGeschickt',
    'checklistFlyerBadewannentuer',
    'checklistFlyerBadumbau',
    'checklistFlyerHaltegriffe',
  ];
  const BITRIX_TEST_ENTITY_TYPE_ID = 2;
  const BITRIX_STAGE_ID = 'C22:UC_T5EXSL';
  const FILE_UPLOAD_FIELDS = [
    'bilderFertigerUmbau', 'videoDesAblaufs', 'fotosAbdichtung',
    'bilderBehobeneMaengel', 'weitereBilder', 'weitereBilder2', 'weitereBilder3',
  ];
  const SINGLE_FILE_UPLOAD_FIELDS = new Set(['videoDesAblaufs']);
  const SIGNATURE_EXPORT_WIDTH = 600;
  const SIGNATURE_EXPORT_HEIGHT = 200;
  let currentStep   = 0;
  let formId        = null;     // Mongo _id once saved
  let shareToken    = null;
  let fileStore     = {};       // { fieldName: File[] }
  let existingFileStore = {};    // { fieldName: "/uploads/..."[] }
  let signaturePads = {};       // { fieldName: SignaturePad }
  let signaturePadDataUrls = {}; // cached data URLs for pads whose canvas may have been 0-sized when loaded
  let copiedSignatureDataUrl = null;
  const pasteSigButtons = new Set();
  let devMode       = false;
  let devModePassword = '';
  let saveInProgress = false;
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
  let currentFormularTyp = FORMULAR_TYPE_DEFAULT;
  let hasUnsavedChanges = false;
  let suppressDirtyTracking = false;

  const BITRIX_ACTIVITY_FIELD_KEYS = ['UF_CRM_1725521281342', 'ufCrm_1725521281342'];
  const DEMO_PRESET_STORAGE_KEY = 'bauFormularDemoPreset';
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
  const DEMO_PRESETS = {
    badumbau: {
      label: 'Badumbau',
      activityValue: '[HD] Badumbau',
      terminId: 'MUSTER-BAD-2026-001',
      auftragsNummer: 'A-AN-BAD-2026-001',
      bitrixZusatzfeld: 'DBG-BAD-2026-001',
      warenpruefungKommentar: 'Musterprüfung Badumbau durchgeführt, Duschwanne und Wandverkleidung vollständig geprüft.',
      checklistGratisHaltegriffKommentar: 'Badumbau-Muster: Gratis-Haltegriff auf Wunsch des Kunden bereits montiert.',
      sonstigeBemerkungenBaustelle: 'Badumbau-Muster: Kunde wurde in Ablauf, Pflege und Trocknungszeiten eingewiesen.',
      zusaetzlicheArbeiten: 'Badumbau-Muster: Sockelleiste angepasst und Silikonfuge an Bestand ergänzt.',
      zusaetzlicheArbeitenNB: 'Badumbau-Muster: Abschlussleiste nachjustiert.',
      nichtErledigteArbeiten: 'Badumbau-Muster: Endreinigung der Glaselemente erfolgt nach Aushärtung.',
      nichtErledigteArbeitenNB: 'Badumbau-Muster: Restliche Silikonkontrolle beim Folgetermin.',
      hinweiseBuero: 'Badumbau-Muster: Pflegekassen-Unterlagen und Abschlussfotos dokumentiert.',
      flyerFieldName: 'checklistFlyerBadumbau',
      imageLabelPrefix: 'Badumbau',
      videoLabel: 'Badumbau Ablauf',
    },
    badewannentuer: {
      label: 'Badewannentür',
      activityValue: '[HD] Badewannentüre',
      terminId: 'MUSTER-BWT-2026-001',
      auftragsNummer: 'A-AN-BWT-2026-001',
      bitrixZusatzfeld: 'DBG-BWT-2026-001',
      warenpruefungKommentar: 'Musterprüfung Badewannentür durchgeführt, Türblatt und Dichtungen vor Montage kontrolliert.',
      checklistGratisHaltegriffKommentar: 'Badewannentür-Muster: Gratis-Haltegriff nicht montiert, da Kunde vorhandenen Griff weiter nutzt.',
      sonstigeBemerkungenBaustelle: 'Badewannentür-Muster: Türfunktion und Dichtigkeit mit Kunde getestet.',
      zusaetzlicheArbeiten: 'Badewannentür-Muster: Wannenrand nachbearbeitet und Anschlussfuge erneuert.',
      zusaetzlicheArbeitenNB: 'Badewannentür-Muster: Türverschluss feinjustiert.',
      nichtErledigteArbeiten: 'Badewannentür-Muster: Pflegehinweis-Aufkleber wird nachgeliefert.',
      nichtErledigteArbeitenNB: 'Badewannentür-Muster: Nachkontrolle Dichtung noch offen.',
      hinweiseBuero: 'Badewannentür-Muster: Bitte Dichtigkeitsprotokoll im Vorgang ablegen.',
      flyerFieldName: 'checklistFlyerBadewannentuer',
      imageLabelPrefix: 'Badewannentuer',
      videoLabel: 'Badewannentuer Ablauf',
    },
    handlaeufe: {
      label: 'Handläufe / Haltegriffe',
      activityValue: '[HD] Handläufe, [HD] Haltegriffe',
      terminId: 'MUSTER-HL-2026-001',
      auftragsNummer: 'A-AN-HL-2026-001',
      bitrixZusatzfeld: 'DBG-HL-2026-001',
      warenpruefungKommentar: 'Musterprüfung Handläufe durchgeführt, Befestigungspunkte und Material vollständig kontrolliert.',
      checklistGratisHaltegriffKommentar: 'Handlauf-Muster: Gratis-Haltegriff ergänzt und gemeinsam mit Kunde positioniert.',
      sonstigeBemerkungenBaustelle: 'Handlauf-Muster: Laufweg mit Kunde begangen und Griffhöhen bestätigt.',
      zusaetzlicheArbeiten: 'Handlauf-Muster: Zusätzlichen Haltepunkt im Flur gesetzt.',
      zusaetzlicheArbeitenNB: 'Handlauf-Muster: Befestigung an zweiter Wandseite ergänzt.',
      nichtErledigteArbeiten: 'Handlauf-Muster: Zweiter Endkappen-Satz wird nachgeliefert.',
      nichtErledigteArbeitenNB: 'Handlauf-Muster: Abschlussfoto nach Nachlieferung noch offen.',
      hinweiseBuero: 'Handlauf-Muster: Bitte Montagepositionen in der Kundenakte ergänzen.',
      flyerFieldName: 'checklistFlyerHaltegriffe',
      imageLabelPrefix: 'Handlaeufe',
      videoLabel: 'Handlaeufe Ablauf',
    },
  };

  function buildFullName(data) {
    return [data.anrede, data.vorname, data.nachname]
      .map(value => (value || '').trim())
      .filter(Boolean)
      .join(' ');
  }

  function getDefaultSubtitle() {
    if (currentFormularTyp === 'zusaetzliche_leistungen') return 'Beauftragung zusätzlicher Leistungen';
    if (currentFormularTyp === 'nachbesserung') return 'Digitale Nachbesserung';
    if (currentFormularTyp === 'schadensmeldung') return 'Digitale Schadensmeldung';
    return 'Digitale Baustellenabnahme';
  }

  function getRouteFormularTyp() {
    const pathname = window.location.pathname;
    if (pathname === FORMULAR_TYPE_PATHS.baustellenabnahme) return 'baustellenabnahme';
    if (pathname === FORMULAR_TYPE_PATHS.zusaetzliche_leistungen) return 'zusaetzliche_leistungen';
    if (pathname === FORMULAR_TYPE_PATHS.nachbesserung) return 'nachbesserung';
    if (pathname === FORMULAR_TYPE_PATHS.schadensmeldung) return 'schadensmeldung';
    return '';
  }

  function getFormularTypePath(type = '') {
    return FORMULAR_TYPE_PATHS[type] || '/home';
  }

  function markFormDirty() {
    if (suppressDirtyTracking || currentStep === 0) return;
    hasUnsavedChanges = true;
  }

  function clearDirtyState() {
    hasUnsavedChanges = false;
  }

  function confirmLeaveToHome() {
    if (!hasUnsavedChanges) return true;

    return window.confirm(
      'Wenn du zum Hauptmenü zurückgehst, werden nicht gespeicherte oder nicht abgesendete Eingaben zurückgesetzt. Möchtest du das Formular wirklich verlassen?'
    );
  }

  function applyFormTypeUI() {
    if (formularTypInput) formularTypInput.value = currentFormularTyp || '';

    formularTypeCards.forEach(card => {
      card.classList.toggle('active', card.dataset.formularType === currentFormularTyp);
    });

    $$('[data-form-type-only]', form).forEach(el => {
      const only = String(el.dataset.formTypeOnly || '').trim();
      const allowedTypes = only ? only.split(',').map(value => value.trim()).filter(Boolean) : [];
      const shouldShow = !allowedTypes.length || !currentFormularTyp || allowedTypes.includes(currentFormularTyp);
      el.classList.toggle('hidden', !shouldShow);
    });

    if (step1Title) {
      if (currentFormularTyp === 'zusaetzliche_leistungen') {
        step1Title.textContent = 'Grunddaten zusätzliche Leistungen';
      } else if (currentFormularTyp === 'nachbesserung') {
        step1Title.textContent = 'Grunddaten Nachbesserung';
      } else if (currentFormularTyp === 'schadensmeldung') {
        step1Title.textContent = 'Grunddaten Schadensmeldung';
      } else {
        step1Title.textContent = 'Abschluss der Baustelle';
      }
    }

    if (step1Intro) {
      if (currentFormularTyp === 'zusaetzliche_leistungen') {
        step1Intro.innerHTML = 'Erfasse hier die Kundendaten und die beauftragten Zusatzleistungen. Danach kannst du den Vorgang direkt intern ergänzen und absenden.';
      } else if (currentFormularTyp === 'nachbesserung') {
        step1Intro.innerHTML = 'Erfasse hier die Grunddaten für die Nachbesserung. Anschließend dokumentierst du die ausgeführten Restarbeiten und lässt den Vorgang bestätigen.';
      } else if (currentFormularTyp === 'schadensmeldung') {
        step1Intro.innerHTML = 'Erfasse hier die Grunddaten zur Schadensmeldung. Danach dokumentierst du den Schaden mit Fotos und internen Hinweisen.';
      } else {
        step1Intro.innerHTML = 'Auf den folgenden Seiten wirst du Schritt für Schritt durch den Abschluss der Baustelle geführt. Bitte beachte, dass dieser <strong>vor Ort mit dem Kunden</strong> gemeinsam vorgenommen werden muss.';
      }
    }

    if (appSubtitle) appSubtitle.textContent = getDefaultSubtitle();

    syncDevOnlySteps();
    buildStepDots();
    updateStepDots();
  }

  function chooseFormularTyp(type, { advance = false, updateHistory = true } = {}) {
    if (type === 'zusaetzliche_leistungen') currentFormularTyp = 'zusaetzliche_leistungen';
    else if (type === 'nachbesserung') currentFormularTyp = 'nachbesserung';
    else if (type === 'schadensmeldung') currentFormularTyp = 'schadensmeldung';
    else currentFormularTyp = 'baustellenabnahme';

    if (updateHistory && !window.location.pathname.startsWith('/form/')) {
      window.history.replaceState({}, '', getFormularTypePath(currentFormularTyp));
    }

    const defaultArtDesTermins = currentFormularTyp === 'nachbesserung'
      ? 'Nachbesserung'
      : currentFormularTyp === 'schadensmeldung'
        ? 'Service'
        : 'Umbau';
    setSelectValue('artDesTermins', defaultArtDesTermins);

    applyFormTypeUI();

    if (advance) {
      markFormDirty();
      showStep(getNextVisibleStep(0));
    }
  }

  function getSelectedDemoPresetKey() {
    const value = demoActivityPresetSelect?.value || localStorage.getItem(DEMO_PRESET_STORAGE_KEY) || 'badumbau';
    return DEMO_PRESETS[value] ? value : 'badumbau';
  }

  function getSelectedDemoPreset() {
    return DEMO_PRESETS[getSelectedDemoPresetKey()];
  }

  function syncDemoPresetSelection() {
    if (!demoActivityPresetSelect) return;
    demoActivityPresetSelect.value = getSelectedDemoPresetKey();
  }

  function setAuszufuehrendeTaetigkeitenValue(value) {
    const field = $('[name="auszufuehrendeTaetigkeiten"]');
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
  async function init() {
    syncDemoPresetSelection();
    bindNavigation();
    bindFormularTypeSelection();
    bindDirtyTracking();
    bindFileUploads();
    bindConditionalFields();
    bindAuftragsNrSync();
    bindConfirmationLetterSync();
    bindAdditionalServicesConfirmationSync();
    bindBitrixAutofill();
    bindDraftLookup();
    bindHomeDraftSearch();
    bindHomeSubmittedSearch();
    bindArbeitsberichtLookup();
    bindDocumentActions();
    bindChecklistRules();
    bindAdminCleanup();
    bindAdminLogs();
    bindAdminStorage();
    bindAdminPush();
    initClientErrorLogging();
    initSignaturePads();
    initWarenpruefungDatum();
    restoreDevModeFromSession();
    initDevModeToggle();
    injectDevStepPdfButtons();
    bindDemoPresetSelection();
    const draftLoaded = await loadDraftIfNeeded();
    if (draftLoaded) {
      showStep(getNextVisibleStep(0));
    } else {
      const routeFormularTyp = getRouteFormularTyp();
      if (routeFormularTyp) {
        chooseFormularTyp(routeFormularTyp, { updateHistory: false });
        showStep(getNextVisibleStep(0));
      } else {
        applyFormTypeUI();
        currentStep = 0;
        showStep(0);
      }
    }
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

  function getWorkflowStepNumbers() {
    return getVisibleStepNumbers().filter(step => step > 0);
  }

  function getFirstVisibleStep() {
    return getVisibleStepNumbers()[0] || 1;
  }

  function getLastVisibleStep() {
    const steps = getVisibleStepNumbers();
    return steps[steps.length - 1] || INITIAL_TOTAL_STEPS;
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
    const steps = getWorkflowStepNumbers();
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
    const visibleSteps = getVisibleSteps().filter(step => Number(step.dataset.step) > 0);
    const currentVisibleIndex = getCurrentVisibleIndex();
    $$('.step-dot', stepIndicator).forEach((dot, idx) => {
      dot.classList.remove('active', 'completed');
      if (idx < currentVisibleIndex) dot.classList.add('completed');
      if (idx === currentVisibleIndex) dot.classList.add('active');
    });
  }

  function getVisibleSteps() {
    return $$('.form-step', form).filter(step => !step.classList.contains('hidden'));
  }

  function getVisibleStepNumber(stepEl) {
    return getVisibleSteps().indexOf(stepEl) + 1;
  }

  function getCurrentVisibleIndex() {
    const visibleSteps = getVisibleSteps().filter(step => Number(step.dataset.step) > 0);
    const current = visibleSteps.findIndex(step => +step.dataset.step === currentStep);
    return current >= 0 ? current : 0;
  }

  function syncDevOnlySteps() {
    $$('.dev-only-step', form).forEach(step => {
      const only = String(step.dataset.formTypeOnly || '').trim();
      const allowedTypes = only ? only.split(',').map(value => value.trim()).filter(Boolean) : [];
      const forceVisibleForCurrentType = Boolean(currentFormularTyp) && allowedTypes.includes(currentFormularTyp) && currentFormularTyp !== 'baustellenabnahme';
      step.classList.toggle('hidden', !devMode && !forceVisibleForCurrentType);
    });

    const visibleSteps = getVisibleSteps();
    const currentVisible = visibleSteps.some(step => +step.dataset.step === currentStep);
    if (!currentVisible && visibleSteps.length) {
      currentStep = +visibleSteps[0].dataset.step;
    }
  }


  // ── Show / Hide Steps ─────────────────────────────────
  function showStep(n) {
    const visibleSteps = getVisibleStepNumbers();
    const targetStep = visibleSteps.includes(Number(n)) ? Number(n) : getFirstVisibleStep();
    const isStartStep = targetStep === 0;

    currentStep = targetStep;
    $$('.form-step', form).forEach(sec => {
      sec.classList.toggle('active', Number(sec.dataset.step) === targetStep);
    });
    updateStepDots();

    // Signature canvases inside a newly-visible step need resizing (they had
    // width=0 while hidden). This also re-applies any cached data URL.
    if (Object.keys(signaturePads).length) {
      resizeAllSignatureCanvases();
    }

    const workflowSteps = getWorkflowStepNumbers();
    const currentIndex = workflowSteps.indexOf(targetStep);
    stepCounter.textContent = `${Math.max(1, currentIndex + 1)}/${workflowSteps.length || 1}`;
    stepIndicator.classList.toggle('hidden', isStartStep);
    stepCounter.classList.toggle('hidden', isStartStep);

    // Button visibility
    btnBack.style.display   = targetStep === getFirstVisibleStep() ? 'none' : 'inline-flex';
    btnNext.style.display   = targetStep === getLastVisibleStep() ? 'none' : 'inline-flex';
    btnSubmit.style.display = targetStep === getLastVisibleStep() ? 'inline-flex' : 'none';
    btnDraft.style.display  = isStartStep ? 'none' : 'inline-flex';
    btnNext.textContent = isStartStep ? 'Formular starten' : 'Weiter';
    if (btnBackToHome) btnBackToHome.classList.toggle('hidden', isStartStep);

    if (targetStep === 11) {
      syncChecklistAutoSelections();
    }

    // Re-init signature pads when step becomes visible (canvas resize)
    requestAnimationFrame(() => resizeAllSignatureCanvases());

    // Scroll to top of card
    $('.form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Navigation ─────────────────────────────────────────
  function bindNavigation() {
    btnNext.addEventListener('click', () => {
      if (devMode || validateCurrentStep('next')) {
        showStep(getNextVisibleStep(currentStep));
      }
    });

    btnBack.addEventListener('click', () => {
      showStep(getPreviousVisibleStep(currentStep));
    });

    btnDraft.addEventListener('click', () => showDraftNameModal());
    btnSubmit.addEventListener('click', () => {
      if (validateAllSteps('submit')) saveForm('submit');
    });

    const btnDebugBitrixClose = $('#btnDebugBitrixClose');
    if (btnDebugBitrix) btnDebugBitrix.addEventListener('click', () => debugBitrixRequest());
    if (btnDebugBitrixClose) btnDebugBitrixClose.addEventListener('click', () => {
      $('#bitrixDebugPanel')?.classList.add('hidden');
    });

    // Draft modal buttons
    $('#btnCopyLink').addEventListener('click', () => {
      const input = $('#draftLink');
      input.select();
      navigator.clipboard.writeText(input.value).then(() => showToast('Link kopiert!', 'success'));
    });
    $('#btnCloseDraft').addEventListener('click', () => $('#draftModal').classList.remove('open'));
  }

  const STEP_PDF_MAP = {
    1:  [{ prefix: '01-abschluss-der-baustelle',       label: '01-Abschluss-der-Baustelle' }],
    2:  [{ prefix: '02-warenpruefung',                 label: '02-Warenpruefung' }],
    6:  [{ prefix: '07-bestaetigung-erfolgreicher-umbau', label: '07-Bestaetigung-erfolgreicher-Umbau' }],
    7:  [
      { prefix: '08-einwilligung-zur-abrechnung',      label: '08-Einwilligung (generiert)' },
      { prefix: '08-einwilligung-template',            label: '08-Einwilligung (Template)' },
    ],
    8:  [{ prefix: '09-maengelbeseitigung',            label: '09-Maengelbeseitigung' }],
    9:  [{ prefix: '10-nachbesserung',                 label: '10-Nachbesserung' }],
    12: [{ prefix: '06-checkliste',                    label: '06-Checkliste' }],
  };

  function injectDevStepPdfButtons() {
    Object.entries(STEP_PDF_MAP).forEach(([stepNumber, specs]) => {
      const section = $(`.form-step[data-step="${stepNumber}"]`, form);
      if (!section) return;
      if (section.querySelector('.dev-step-pdf-wrapper')) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'dev-step-pdf-wrapper';
      wrapper.classList.toggle('hidden', !devMode);

      specs.forEach(spec => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-dev-pdf-download';
        btn.textContent = `PDF herunterladen (${spec.label})`;
        btn.addEventListener('click', () => downloadStepPdf(spec, btn));
        wrapper.appendChild(btn);
      });

      const hint = document.createElement('span');
      hint.className = 'dev-step-pdf-hint';
      hint.textContent = 'Testmodus: identische PDF wie beim Bitrix-Upload.';
      wrapper.appendChild(hint);

      section.appendChild(wrapper);
    });
  }

  function syncDevStepPdfButtons() {
    $$('.dev-step-pdf-wrapper', form).forEach(el => el.classList.toggle('hidden', !devMode));
  }

  async function parseJsonResponse(response) {
    const text = await response.text();
    let json = null;

    if (text) {
      try {
        json = JSON.parse(text);
      } catch (_error) {
        const preview = text.slice(0, 240);
        throw new Error(`Unerwartete Server-Antwort (HTTP ${response.status}): ${preview}`);
      }
    }

    if (!json) {
      throw new Error(`Leere Server-Antwort (HTTP ${response.status})`);
    }

    if (!response.ok) {
      const details = Array.isArray(json.details)
        ? json.details
          .map(detail => detail.message || detail.field)
          .filter(Boolean)
          .slice(0, 6)
        : [];
      const detailText = details.length ? `\n${details.map(item => `- ${item}`).join('\n')}` : '';
      const recoveryText = json.draftSaved
        ? `\nAktueller Stand wurde als Entwurf gesichert${json.draftId ? `: ${json.draftId}` : '.'}`
        : '';
      throw new Error(`${json.error || `HTTP ${response.status}`}${recoveryText}${detailText}`);
    }

    return json;
  }

  async function downloadStepPdf(spec, btn) {
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'PDF wird erstellt...';
    try {
      const response = await fetch('/api/form/document/step-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formData: collectFormData(),
          filenamePrefix: spec.prefix,
        }),
      });
      if (!response.ok) {
        const errText = await response.text();
        let message = errText;
        try { message = JSON.parse(errText).error || message; } catch (_) {}
        throw new Error(message || `HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match ? match[1] : `${spec.prefix}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('PDF heruntergeladen.', 'success');
    } catch (error) {
      showToast(`PDF-Download fehlgeschlagen: ${error.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  function restoreDevModeFromSession() {
    const stored = sessionStorage.getItem('devModeSession');
    if (!stored) return;
    try {
      const { password } = JSON.parse(stored);
      devMode = true;
      devModePassword = password || '';
    } catch {
      sessionStorage.removeItem('devModeSession');
    }
  }

  function initDevModeToggle() {
    if (!devModeToggle) return;

    updateDevModeToggle();
    devModeToggle.addEventListener('click', async () => {
      if (devMode) {
        devMode = false;
        devModePassword = '';
        sessionStorage.removeItem('devModeSession');
        updateDevModeToggle();
        showToast('Testmodus deaktiviert: Validierung wieder aktiv.', 'success');
        return;
      }

      const password = window.prompt('Passwort fuer Testmodus eingeben:');
      if (password === null) return;

      devModeToggle.disabled = true;
      try {
        const res = await fetch('/api/form/dev-mode/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        const json = await parseJsonResponse(res);
        if (!json.success) throw new Error(json.error || 'Passwort ungueltig');

        devMode = true;
        devModePassword = password;
        sessionStorage.setItem('devModeSession', JSON.stringify({ password }));
        updateDevModeToggle();
        showToast('Testmodus aktiv: Seitenwechsel ohne Pflichtfelder.', 'success');
      } catch (error) {
        showToast('Testmodus konnte nicht aktiviert werden: ' + error.message, 'error');
      } finally {
        devModeToggle.disabled = false;
      }
    });
  }

  function bindFormularTypeSelection() {
    formularTypeCards.forEach(card => {
      card.addEventListener('click', () => {
        chooseFormularTyp(card.dataset.formularType, { advance: true });
      });
    });
  }

  function bindDirtyTracking() {
    form.addEventListener('input', event => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        markFormDirty();
      }
    });

    form.addEventListener('change', event => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        markFormDirty();
      }
    });

    if (btnBackToHome) {
      btnBackToHome.addEventListener('click', () => {
        if (!confirmLeaveToHome()) return;
        clearDirtyState();
        window.location.href = '/home';
      });
    }
  }

  function initClientErrorLogging() {
    window.addEventListener('error', event => {
      logClientEvent({
        level: 'error',
        event: 'client.error',
        message: event.message || 'Unbekannter Browser-Fehler',
        step: currentStep,
        stepTitle: getStepTitle($(`.form-step[data-step="${currentStep}"]`)),
        issues: [
          event.filename ? `${event.filename}:${event.lineno || 0}:${event.colno || 0}` : '',
        ].filter(Boolean),
      });
    });

    window.addEventListener('unhandledrejection', event => {
      const reason = event.reason;
      logClientEvent({
        level: 'error',
        event: 'client.unhandled_rejection',
        message: reason?.message || String(reason || 'Unbehandelte Promise-Ablehnung'),
        step: currentStep,
        stepTitle: getStepTitle($(`.form-step[data-step="${currentStep}"]`)),
      });
    });
  }

  function syncChecklistAutoSelections() {
    CHECKLIST_AUTO_CHECKBOXES.forEach(name => {
      const input = $(`input[type="checkbox"][name="${name}"]`, form);
      if (!input) return;
      input.checked = true;
      input.disabled = true;
      input.closest('.check-item')?.classList.remove('check-item-invalid');
    });
  }

  function bindChecklistRules() {
    syncChecklistAutoSelections();

    $$('input[type="checkbox"]', form).forEach(input => {
      input.addEventListener('change', () => {
        input.closest('.check-item')?.classList.remove('check-item-invalid');
        if (CHECKLIST_AUTO_CHECKBOXES.includes(input.name) && !input.checked) {
          input.checked = true;
        }
      });
    });
  }

  function validateChecklistBadumbau(section, issues = []) {
    let valid = true;

    CHECKLIST_BADUMBAU_REQUIRED_CHECKBOXES.forEach(name => {
      const input = $(`input[type="checkbox"][name="${name}"]`, section);
      if (!input) return;

      const row = input.closest('.check-item');
      row?.classList.remove('check-item-invalid');

      if (!input.checked) {
        row?.classList.add('check-item-invalid');
        addValidationIssue(issues, section, `${row?.textContent?.trim() || name} fehlt.`);
        valid = false;
      }
    });

    const uebermittlungRadios = $$('input[name="checklistFotoUebermittlung"]', section);
    const uebermittlungChecked = uebermittlungRadios.some(r => r.checked);
    const uebermittlungGroup = uebermittlungRadios[0]?.closest('.choice-group');
    if (uebermittlungGroup) {
      if (!uebermittlungChecked) {
        uebermittlungGroup.style.borderColor = '#e53935';
        uebermittlungGroup.style.borderStyle = 'solid';
        uebermittlungGroup.style.borderWidth = '2px';
        uebermittlungGroup.style.borderRadius = '18px';
        uebermittlungGroup.style.padding = '8px';
        uebermittlungGroup.style.boxShadow = '0 0 0 2px rgba(229,57,53,.18)';
        addValidationIssue(issues, section, 'Übermittlungsweg fehlt.');
        valid = false;
      } else {
        uebermittlungGroup.style.borderColor = '';
        uebermittlungGroup.style.borderStyle = '';
        uebermittlungGroup.style.borderWidth = '';
        uebermittlungGroup.style.borderRadius = '';
        uebermittlungGroup.style.padding = '';
        uebermittlungGroup.style.boxShadow = '';
      }
    }

    return valid;
  }

  function updateDevModeToggle() {
    if (!devModeToggle) return;

    devModeToggle.classList.toggle('active', devMode);
    devModeToggle.setAttribute('aria-pressed', String(devMode));
    devModeToggle.textContent = `Testmodus: ${devMode ? 'An' : 'Aus'}`;
    if (devModeBadge) devModeBadge.classList.toggle('hidden', !devMode);
    if (bitrixTestActions) bitrixTestActions.classList.toggle('hidden', !devMode);
    if (btnHeaderDemoPrefill) btnHeaderDemoPrefill.classList.toggle('hidden', !devMode);
    if (btnDebugBitrix) btnDebugBitrix.classList.toggle('hidden', !devMode);
    if (bitrixDebugFields) bitrixDebugFields.classList.toggle('hidden', !devMode);
    if (debugDocumentPanel) debugDocumentPanel.classList.toggle('hidden', !devMode);
    if (adminCleanupPanel) adminCleanupPanel.classList.toggle('hidden', !devMode);
    if (adminLogPanel) adminLogPanel.classList.toggle('hidden', !devMode);
    if (adminStoragePanel) adminStoragePanel.classList.toggle('hidden', !devMode);
    if (adminPushPanel) adminPushPanel.classList.toggle('hidden', !devMode);
    if (!devMode && adminCleanupOutput) {
      adminCleanupOutput.classList.add('hidden');
      adminCleanupOutput.textContent = '';
    }
    if (!devMode && adminLogOutput) {
      adminLogOutput.classList.add('hidden');
      adminLogOutput.textContent = '';
    }
    if (!devMode && adminStorageOutput) {
      adminStorageOutput.classList.add('hidden');
      adminStorageOutput.textContent = '';
      if (btnStorageDelete) btnStorageDelete.disabled = true;
    }
    if (!devMode && adminPushOutput) {
      adminPushOutput.classList.add('hidden');
      adminPushOutput.textContent = '';
    }
    if (!devMode && adminPushCategories) {
      adminPushCategories.classList.add('hidden');
      adminPushCategories.innerHTML = '';
    }
    if (!devMode && adminPushActions) adminPushActions.classList.add('hidden');
    if (!devMode && btnCleanupDelete) btnCleanupDelete.disabled = true;
    syncDevStepPdfButtons();

    // Hide Bitrix-Aufträge + Entwürfe completely when Testmodus is off
    if (devToolsPanel) {
      const dealTitle = devToolsPanel.querySelector('.bitrix-panel-title');
      const dealSubtitle = devToolsPanel.querySelector('.bitrix-panel-subtitle');
      if (dealTitle) dealTitle.closest('.dev-tools-head')?.classList.toggle('hidden', !devMode);
      if (draftsPanel) draftsPanel.classList.toggle('hidden', !devMode);
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

  function renderOrphanUploadReport(json) {
    const report = json.report || {};
    const files = Array.isArray(report.orphanFiles) ? report.orphanFiles : [];
    const sample = files.slice(0, 20).map(file => {
      const modifiedAt = file.modifiedAt ? new Date(file.modifiedAt).toLocaleString('de-DE') : '-';
      return `- ${file.sizeLabel || ''} ${modifiedAt} ${file.relativePath || file.fullPath || ''}`.trim();
    });

    const lines = [
      `Modus: ${json.mode === 'delete' ? 'Löschen' : 'Prüfung'}`,
      `Datenbank: ${report.databaseName || '(aus MongoDB URI)'}`,
      `Uploads: ${report.uploadsDir || '-'}`,
      `Dokumente: ${report.documentsScanned?.abnahmen || 0} Abnahmen, ${report.documentsScanned?.entwuerfe || 0} Entwürfe`,
      `Referenzen: ${report.referencesFound || 0}`,
      `Dateien: ${report.storedFiles || 0}`,
      `Orphans: ${report.orphanCount || 0} (${report.totalBytesLabel || '0 B'})`,
    ];

    if (json.mode === 'delete') {
      lines.push(`Gelöscht: ${report.deletedCount || 0} (${report.deletedBytesLabel || '0 B'})`);
    }

    if (sample.length) {
      lines.push('', 'Erste Dateien:', ...sample);
      if (files.length > sample.length) {
        lines.push(`... ${files.length - sample.length} weitere`);
      }
    }

    return lines.join('\n');
  }

  async function requestOrphanUploadCleanup({ deleteFiles = false } = {}) {
    if (!adminCleanupOutput) return null;

    if (!devModePassword) {
      const password = window.prompt('Passwort fuer Testmodus eingeben:');
      if (password === null) return null;
      devModePassword = password;
    }

    const response = await fetch('/api/form/admin/orphan-uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: devModePassword,
        delete: Boolean(deleteFiles),
      }),
    });

    const json = await parseJsonResponse(response);
    if (!json.success) throw new Error(json.error || 'Upload-Bereinigung fehlgeschlagen');
    return json;
  }

  function bindAdminCleanup() {
    if (!btnCleanupPreview || !btnCleanupDelete || !adminCleanupOutput) return;

    btnCleanupPreview.addEventListener('click', async () => {
      btnCleanupPreview.disabled = true;
      btnCleanupDelete.disabled = true;
      adminCleanupOutput.classList.remove('hidden');
      adminCleanupOutput.textContent = 'Orphan Uploads werden geprüft...';

      try {
        const json = await requestOrphanUploadCleanup();
        adminCleanupOutput.textContent = renderOrphanUploadReport(json);
        btnCleanupDelete.disabled = !json.report?.orphanCount;
      } catch (error) {
        adminCleanupOutput.textContent = `Fehler: ${error.message}`;
        showToast('Upload-Bereinigung konnte nicht geprüft werden: ' + error.message, 'error');
      } finally {
        btnCleanupPreview.disabled = false;
      }
    });

    btnCleanupDelete.addEventListener('click', async () => {
      const confirmed = window.confirm('Orphan Uploads wirklich vom aktuellen Server löschen? Bitte vorher die Prüfung kontrollieren.');
      if (!confirmed) return;

      btnCleanupPreview.disabled = true;
      btnCleanupDelete.disabled = true;
      adminCleanupOutput.classList.remove('hidden');
      adminCleanupOutput.textContent = 'Orphan Uploads werden gelöscht...';

      try {
        const json = await requestOrphanUploadCleanup({ deleteFiles: true });
        adminCleanupOutput.textContent = renderOrphanUploadReport(json);
        showToast('Orphan Uploads gelöscht.', 'success');
      } catch (error) {
        adminCleanupOutput.textContent = `Fehler: ${error.message}`;
        showToast('Upload-Bereinigung konnte nicht löschen: ' + error.message, 'error');
      } finally {
        btnCleanupPreview.disabled = false;
      }
    });
  }

  function formatAdminLog(entry) {
    const timestamp = entry.timestamp ? new Date(entry.timestamp).toLocaleString('de-DE') : '-';
    const level = String(entry.level || 'info').toUpperCase();
    const dealId = entry.dealId || entry.bitrixAuftragId || entry.terminId || '-';
    const ids = [
      entry.draftId ? `Entwurf: ${entry.draftId}` : '',
      entry.formId ? `Abnahme: ${entry.formId}` : '',
    ].filter(Boolean).join(' | ');
    const details = entry.context?.details?.length
      ? `\nDetails: ${entry.context.details.map(detail => detail.message || detail.field || '').filter(Boolean).join(' | ')}`
      : '';

    return [
      `[${timestamp}] ${level} ${entry.event || 'operation'}`,
      `Deal: ${dealId}${ids ? ` | ${ids}` : ''}`,
      entry.message || '',
      details.trim(),
    ].filter(Boolean).join('\n');
  }

  function renderAdminLogs(logs = []) {
    if (!adminLogOutput) return '';
    if (!logs.length) return 'Noch keine Save/Submit-Logs vorhanden.';
    return logs.map(formatAdminLog).join('\n\n');
  }

  async function requestAdminLogs() {
    if (!adminLogOutput) return null;

    if (!devModePassword) {
      const password = window.prompt('Passwort fuer Testmodus eingeben:');
      if (password === null) return null;
      devModePassword = password;
    }

    const response = await fetch('/api/form/admin/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: devModePassword,
        limit: 100,
      }),
    });

    const json = await parseJsonResponse(response);
    if (!json.success) throw new Error(json.error || 'Logs konnten nicht geladen werden');
    return json.logs || [];
  }

  function bindAdminLogs() {
    if (!btnAdminLogsRefresh || !adminLogOutput) return;

    btnAdminLogsRefresh.addEventListener('click', async () => {
      btnAdminLogsRefresh.disabled = true;
      adminLogOutput.classList.remove('hidden');
      adminLogOutput.textContent = 'Logs werden geladen...';

      try {
        const logs = await requestAdminLogs();
        if (logs) adminLogOutput.textContent = renderAdminLogs(logs);
      } catch (error) {
        adminLogOutput.textContent = `Fehler: ${error.message}`;
        showToast('Logs konnten nicht geladen werden: ' + error.message, 'error');
      } finally {
        btnAdminLogsRefresh.disabled = false;
      }
    });

    if (btnAdminLogsClear) {
      btnAdminLogsClear.addEventListener('click', async () => {
        const confirmed = window.confirm('Alle Logs wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.');
        if (!confirmed) return;

        btnAdminLogsClear.disabled = true;
        adminLogOutput.classList.remove('hidden');
        adminLogOutput.textContent = 'Logs werden gelöscht...';

        try {
          const res = await fetch('/api/form/admin/logs/clear', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: devModePassword }),
          });

          const json = await parseJsonResponse(res);
          const deleted = json?.deletedCount || 0;
          adminLogOutput.textContent = `${deleted} Log-Einträge wurden gelöscht.`;
          showToast(`${deleted} Log-Einträge gelöscht.`, 'success');
        } catch (error) {
          adminLogOutput.textContent = `Fehler beim Löschen: ${error.message}`;
          showToast('Logs konnten nicht gelöscht werden: ' + error.message, 'error');
        } finally {
          btnAdminLogsClear.disabled = false;
        }
      });
    }
  }

  function formatBytes(bytes) {
    if (bytes == null) return '–';
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  }

  function renderStorageStats(data) {
    const lines = [];
    if (data.disk) {
      const d = data.disk;
      const bar = '█'.repeat(Math.round(d.usePercent / 5)) + '░'.repeat(20 - Math.round(d.usePercent / 5));
      lines.push(`Festplatte: ${d.usePercent}% belegt`);
      lines.push(`[${bar}]`);
      lines.push(`Gesamt: ${formatBytes(d.total)}  |  Belegt: ${formatBytes(d.used)}  |  Frei: ${formatBytes(d.available)}`);
    } else {
      lines.push('Festplatten-Info nicht verfügbar (nur auf Fly.io).');
    }
    lines.push('');
    const u = data.uploads;
    lines.push(`Uploads-Verzeichnis: ${u.fileCount} Datei(en), ${formatBytes(u.totalBytes)}`);
    lines.push(`Davon älter als 30 Tage: ${u.oldFileCount} Datei(en), ${formatBytes(u.oldFileBytes)}`);
    return lines.join('\n');
  }

  function renderCleanupResult(data) {
    const lines = [];
    if (data.dryRun) {
      lines.push(`Vorschau: ${data.candidateCount} Datei(en) würden gelöscht, ${formatBytes(data.candidateBytes)} freigegeben.`);
      if (data.protectedCount > 0) {
        lines.push(`Geschützt (aktive Entwürfe): ${data.protectedCount} Datei(en) bleiben erhalten.`);
      }
    } else {
      lines.push(`${data.deletedCount} Datei(en) gelöscht, ${formatBytes(data.deletedBytes)} freigegeben.`);
      if (data.protectedCount > 0) {
        lines.push(`Geschützt (aktive Entwürfe): ${data.protectedCount} Datei(en) wurden nicht angefasst.`);
      }
      if (data.errors.length > 0) {
        lines.push(`Fehler (${data.errors.length}):`);
        data.errors.forEach(e => lines.push(`  - ${e.filename}: ${e.error}`));
      }
    }
    return lines.join('\n');
  }

  function bindAdminStorage() {
    if (!btnStorageCheck || !btnStoragePreview || !btnStorageDelete || !adminStorageOutput) return;

    async function callStorage(endpoint, body) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: devModePassword, ...body }),
      });
      const json = await parseJsonResponse(response);
      if (!json.success) throw new Error(json.error || 'Anfrage fehlgeschlagen');
      return json;
    }

    btnStorageCheck.addEventListener('click', async () => {
      btnStorageCheck.disabled = true;
      adminStorageOutput.classList.remove('hidden');
      adminStorageOutput.textContent = 'Speicherplatz wird geprüft…';
      try {
        const json = await callStorage('/api/form/admin/storage', {});
        adminStorageOutput.textContent = renderStorageStats(json);
      } catch (error) {
        adminStorageOutput.textContent = `Fehler: ${error.message}`;
        showToast('Speicher-Info fehlgeschlagen: ' + error.message, 'error');
      } finally {
        btnStorageCheck.disabled = false;
      }
    });

    btnStoragePreview.addEventListener('click', async () => {
      btnStoragePreview.disabled = true;
      adminStorageOutput.classList.remove('hidden');
      adminStorageOutput.textContent = 'Vorschau wird berechnet…';
      try {
        const json = await callStorage('/api/form/admin/storage/cleanup', { dryRun: true });
        adminStorageOutput.textContent = renderCleanupResult(json);
        btnStorageDelete.disabled = json.candidateCount === 0;
      } catch (error) {
        adminStorageOutput.textContent = `Fehler: ${error.message}`;
        showToast('Vorschau fehlgeschlagen: ' + error.message, 'error');
      } finally {
        btnStoragePreview.disabled = false;
      }
    });

    btnStorageDelete.addEventListener('click', async () => {
      if (!window.confirm('Alle Mediendateien älter als 30 Tage werden unwiderruflich gelöscht. Fortfahren?')) return;
      btnStorageDelete.disabled = true;
      btnStoragePreview.disabled = true;
      adminStorageOutput.textContent = 'Dateien werden gelöscht…';
      try {
        const json = await callStorage('/api/form/admin/storage/cleanup', { dryRun: false });
        adminStorageOutput.textContent = renderCleanupResult(json);
        showToast(`${json.deletedCount} Datei(en) gelöscht.`, 'success');
      } catch (error) {
        adminStorageOutput.textContent = `Fehler: ${error.message}`;
        showToast('Löschen fehlgeschlagen: ' + error.message, 'error');
      } finally {
        btnStoragePreview.disabled = false;
      }
    });
  }

  function buildAdminPushCategoryHtml(title, items) {
    if (!items.length) return '';
    const bodyItems = items.map((item, i) => {
      const missing = item.exists === false;
      const label = item.filename || item.title || item.key;
      const field = item.field ? `<span class="admin-push-file-field">${item.field}</span>` : '';
      const missingNote = missing ? ' (nicht auf Disk)' : '';
      return `<label class="admin-push-file-item${missing ? ' missing' : ''}">
        <input type="checkbox" data-push-item="${i}" ${missing ? '' : 'checked'} ${missing ? 'disabled' : ''} />
        <span class="admin-push-file-label">${label}${missingNote}</span>${field}
      </label>`;
    }).join('');
    return `<div class="admin-push-category">
      <div class="admin-push-category-head">
        <span class="admin-push-chevron">▾</span>
        <strong>${title} (${items.length})</strong>
        <button type="button" class="admin-push-select-all">Alle</button>
      </div>
      <div class="admin-push-category-body">${bodyItems}</div>
    </div>`;
  }

  function renderAdminPushCategories(data) {
    if (!adminPushCategories) return;
    const { bilder = [], video = [], pdfs = [] } = data.categories || {};
    let html = '';
    html += buildAdminPushCategoryHtml('Bilder', bilder);
    html += buildAdminPushCategoryHtml('Videos', video);
    html += buildAdminPushCategoryHtml('PDFs', pdfs);

    adminPushCategories.innerHTML = html;
    adminPushCategories.classList.remove('hidden');

    adminPushCategories.querySelectorAll('.admin-push-category').forEach(cat => {
      const head = cat.querySelector('.admin-push-category-head');
      const body = cat.querySelector('.admin-push-category-body');
      const chevron = cat.querySelector('.admin-push-chevron');
      const btn = cat.querySelector('.admin-push-select-all');
      const boxes = Array.from(cat.querySelectorAll('input[type="checkbox"]:not([disabled])'));

      // Collapse/expand on header click
      head.addEventListener('click', (e) => {
        if (e.target === btn) return;
        const collapsed = body.classList.toggle('hidden');
        chevron.textContent = collapsed ? '▸' : '▾';
      });

      // "Alle/Keine" toggles all checkboxes in that category
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const allChecked = boxes.every(b => b.checked);
        boxes.forEach(b => { b.checked = !allChecked; });
        btn.textContent = allChecked ? 'Alle' : 'Keine';
      });
    });

    if (adminPushActions) adminPushActions.classList.remove('hidden');
  }

  function getAdminPushSelection(inspectResult) {
    if (!adminPushCategories) return { files: [], pdfKeys: [] };
    const { bilder = [], video = [], pdfs = [] } = inspectResult.categories || {};
    const allItems = [bilder, video, pdfs];
    const allLists = [bilder, video, pdfs];
    const files = [];
    const pdfKeys = [];

    const cats = adminPushCategories.querySelectorAll('.admin-push-category');
    cats.forEach((cat, catIndex) => {
      const boxes = cat.querySelectorAll('input[type="checkbox"]');
      boxes.forEach((box, itemIndex) => {
        if (!box.checked) return;
        const list = allLists[catIndex];
        if (!list) return;
        const item = list[itemIndex];
        if (!item) return;
        if (catIndex < 2) {
          files.push({ field: item.field, filename: item.filename });
        } else {
          pdfKeys.push(item.key);
        }
      });
    });

    return { files, pdfKeys };
  }

  let adminPushInspectResult = null;

  function bindAdminPush() {
    if (!btnAdminPushLoad || !btnAdminPushSend || !adminPushOutput) return;

    btnAdminPushLoad.addEventListener('click', async () => {
      const entityId = adminPushEntityId?.value.trim();

      if (!entityId) { showToast('Bitte eine Bitrix-Auftrag-ID eingeben.', 'error'); return; }

      if (!devModePassword) {
        const pw = window.prompt('Passwort fuer Testmodus eingeben:');
        if (pw === null) return;
        devModePassword = pw;
      }

      btnAdminPushLoad.disabled = true;
      if (adminPushCategories) { adminPushCategories.classList.add('hidden'); adminPushCategories.innerHTML = ''; }
      if (adminPushActions) adminPushActions.classList.add('hidden');
      if (adminPushOutput) { adminPushOutput.classList.add('hidden'); adminPushOutput.textContent = ''; }
      adminPushInspectResult = null;

      try {
        const response = await fetch('/api/form/admin/inspect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: devModePassword, entityId }),
        });
        const json = await parseJsonResponse(response);
        if (!json.success) throw new Error(json.error || 'Laden fehlgeschlagen');
        adminPushInspectResult = json;
        renderAdminPushCategories(json);
        const multipleHint = json.multipleCount > 1 ? ` (${json.multipleCount} Formulare gefunden, neuestes verwendet)` : '';
        showToast(`${json.form.customerName} geladen (${json.source})${multipleHint}.`, json.multipleCount > 1 ? 'warn' : 'success');
      } catch (error) {
        if (adminPushOutput) {
          adminPushOutput.classList.remove('hidden');
          adminPushOutput.textContent = `Fehler: ${error.message}`;
        }
        showToast('Laden fehlgeschlagen: ' + error.message, 'error');
      } finally {
        btnAdminPushLoad.disabled = false;
      }
    });

    btnAdminPushSend.addEventListener('click', async () => {
      if (!adminPushInspectResult) return;
      const { files, pdfKeys } = getAdminPushSelection(adminPushInspectResult);
      if (!files.length && !pdfKeys.length) {
        showToast('Keine Dateien ausgewählt.', 'error');
        return;
      }

      const entityId = adminPushEntityId?.value.trim();

      btnAdminPushSend.disabled = true;
      adminPushOutput.classList.remove('hidden');
      adminPushOutput.textContent = `Sende ${files.length} Datei(en) + ${pdfKeys.length} PDF(s) zu Bitrix...`;

      try {
        const response = await fetch('/api/form/admin/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: devModePassword, entityId, files, pdfKeys }),
        });
        const json = await parseJsonResponse(response);
        if (!json.success) throw new Error(json.error || 'Push fehlgeschlagen');

        const lines = [
          `Erfolgreich gesendet.`,
          `Anhänge: ${json.attachmentCount}`,
          `Bitrix-Kommentar(e): ${json.timelineResults?.length || 1}`,
        ];
        if (json.skippedFiles?.length) {
          lines.push(`\nÜbersprungen (${json.skippedFiles.length}):`);
          json.skippedFiles.forEach(f => lines.push(`  - ${f.filename}: ${f.reason}`));
        }
        if (json.optimizedFiles?.length) {
          lines.push(`\nKomprimiert (${json.optimizedFiles.length}):`);
          json.optimizedFiles.forEach(f => lines.push(`  - ${f.filename}: ${f.originalSizeKB} KB → ${f.optimizedSizeKB} KB`));
        }
        adminPushOutput.textContent = lines.join('\n');
        showToast('Push erfolgreich.', 'success');
      } catch (error) {
        adminPushOutput.textContent = `Fehler: ${error.message}`;
        showToast('Push fehlgeschlagen: ' + error.message, 'error');
      } finally {
        btnAdminPushSend.disabled = false;
      }
    });
  }

  function bindBitrixAutofill() {
    if (btnFetchBitrixLead) {
      btnFetchBitrixLead.addEventListener('click', fetchBitrixDealById);
    }

    if (btnDemoPrefill) {
      btnDemoPrefill.addEventListener('click', () => prefillDemoData());
    }

    if (btnHeaderDemoPrefill) {
      btnHeaderDemoPrefill.addEventListener('click', () => prefillDemoData());
    }
  }

  function bindDemoPresetSelection() {
    if (!demoActivityPresetSelect) return;

    demoActivityPresetSelect.addEventListener('change', () => {
      const key = getSelectedDemoPresetKey();
      localStorage.setItem(DEMO_PRESET_STORAGE_KEY, key);
      updateChecklistVariant(getSelectedDemoPreset().activityValue);
      showToast(`Musterdaten-Typ gesetzt: ${getSelectedDemoPreset().label}.`, 'success');
    });
  }

  function bindHomeDraftSearch() {
    if (!homeDraftList) return;

    const doSearch = async () => {
      const query = (homeDraftSearch?.value || '').trim();
      if (btnHomeDraftSearch) btnHomeDraftSearch.disabled = true;
      homeDraftList.innerHTML = '<p class="bitrix-empty">Entwürfe werden geladen...</p>';

      try {
        const qs = query ? `?q=${encodeURIComponent(query)}` : '';
        const res = await fetch(`/api/form/drafts${qs}`);
        const json = await res.json();

        if (!json.success) throw new Error(json.error || 'Fehler');

        const items = json.drafts || [];
        renderHomeDrafts(items, query ? 'Keine passenden Entwürfe gefunden.' : 'Noch keine Entwürfe gespeichert.');
      } catch (error) {
        homeDraftList.innerHTML = '<p class="bitrix-empty">Fehler beim Laden der Entwürfe.</p>';
        showToast('Fehler: ' + error.message, 'error');
      } finally {
        if (btnHomeDraftSearch) btnHomeDraftSearch.disabled = false;
      }
    };

    if (btnHomeDraftSearch) btnHomeDraftSearch.addEventListener('click', doSearch);
    if (homeDraftSearch) {
      homeDraftSearch.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
      });
    }
  }

  function bindHomeSubmittedSearch() {
    if (!homeSubmittedList) return;

    const doSearch = async () => {
      const query = (homeSubmittedSearch?.value || '').trim();
      if (btnHomeSubmittedSearch) btnHomeSubmittedSearch.disabled = true;
      homeSubmittedList.innerHTML = '<p class="bitrix-empty">Gesendete Abnahmen werden geladen...</p>';

      try {
        const qs = query ? `?q=${encodeURIComponent(query)}` : '';
        const res = await fetch(`/api/form/submitted${qs}`);
        const json = await res.json();

        if (!json.success) throw new Error(json.error || 'Fehler');

        const items = json.submitted || [];
        renderHomeSubmitted(items, query ? 'Keine passenden Abnahmen gefunden.' : 'Noch keine gesendeten Abnahmen.');
      } catch (error) {
        homeSubmittedList.innerHTML = '<p class="bitrix-empty">Fehler beim Laden der Abnahmen.</p>';
        showToast('Fehler: ' + error.message, 'error');
      } finally {
        if (btnHomeSubmittedSearch) btnHomeSubmittedSearch.disabled = false;
      }
    };

    if (btnHomeSubmittedSearch) btnHomeSubmittedSearch.addEventListener('click', doSearch);
    if (homeSubmittedSearch) {
      homeSubmittedSearch.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
      });
    }
  }

  function renderHomeSubmitted(items, emptyMessage) {
    if (!homeSubmittedList) return;

    if (!items.length) {
      homeSubmittedList.innerHTML = `<p class="bitrix-empty">${emptyMessage}</p>`;
      return;
    }

    homeSubmittedList.innerHTML = '';
    items.forEach(item => {
      const card = document.createElement('article');
      card.className = 'draft-card';

      const displayTitle = buildDraftTitle(item);
      const subtitle = buildDraftSubtitle(item);
      const updatedAt = item.updatedAt ? formatShortDateTime(item.updatedAt) : '';

      card.innerHTML = `
        <div class="draft-card-top">
          <div>
            <div class="draft-card-title">${escapeHtml(displayTitle)}</div>
            ${subtitle ? `<div class="draft-card-subtitle">${escapeHtml(subtitle)}</div>` : ''}
            <div class="draft-card-meta">ID ${escapeHtml(String(item._id || ''))}${updatedAt ? ` · gesendet ${escapeHtml(updatedAt)} Uhr` : ''}</div>
          </div>
          ${item.terminId ? `<span class="bitrix-chip">${escapeHtml(item.terminId)}</span>` : ''}
        </div>
        <div class="draft-card-actions">
          <button type="button" class="draft-card-action" data-action="open">Abnahme öffnen</button>
          <button type="button" class="draft-card-action draft-card-action-secondary" data-action="download">ZIP herunterladen</button>
        </div>
      `;

      $('[data-action="open"]', card).addEventListener('click', () => {
        if (item.shareToken) {
          window.location.href = `/form/${item.shareToken}`;
        } else {
          showToast('Kein Share-Token vorhanden — Abnahme kann nicht geöffnet werden.', 'error');
        }
      });
      $('[data-action="download"]', card).addEventListener('click', () => {
        window.location.href = `/api/form/submitted/${item._id}/export`;
      });
      homeSubmittedList.appendChild(card);
    });
  }

  function renderHomeDrafts(items, emptyMessage) {
    if (!homeDraftList) return;

    if (!items.length) {
      homeDraftList.innerHTML = `<p class="bitrix-empty">${emptyMessage}</p>`;
      return;
    }

    homeDraftList.innerHTML = '';
    items.forEach(item => {
      const card = document.createElement('article');
      card.className = 'draft-card';

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
      homeDraftList.appendChild(card);
    });
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
    if (item.entwurfsName) return item.entwurfsName;
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
      showStep(getNextVisibleStep(0));
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
    chooseFormularTyp('baustellenabnahme');
    const preset = getSelectedDemoPreset();
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);

    const textValues = {
      terminId: preset.terminId,
      kundennummer: '12398',
      vorname: 'Max',
      nachname: 'Mustermann',
      'adresse.strasse': 'Musterstraße 42',
      'adresse.adresszeile2': '2. OG links',
      'adresse.stadt': 'Leipzig',
      'adresse.plz': '04109',
      auftragsNummer: preset.auftragsNummer,
      warenpruefungKommentar: preset.warenpruefungKommentar,
      checklistGratisHaltegriffKommentar: preset.checklistGratisHaltegriffKommentar,
      sonstigeBemerkungenBaustelle: preset.sonstigeBemerkungenBaustelle,
      zusaetzlicheArbeiten: preset.zusaetzlicheArbeiten,
      nichtErledigteArbeiten: preset.nichtErledigteArbeiten,
      zusaetzlicheArbeitenNB: preset.zusaetzlicheArbeitenNB,
      nichtErledigteArbeitenNB: preset.nichtErledigteArbeitenNB,
      hinweiseBuero: preset.hinweiseBuero,
      bitrixZusatzfeld: preset.bitrixZusatzfeld,
      auszufuehrendeTaetigkeiten: preset.activityValue,
      bitrixAuftragId: '90001',
      emailEmpfaenger: 'kunde@beispiel.de',
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

    const baseChecklistFields = [
      'checklistFotosWaerendUmsetzung',
      'checklistFinaleFotos',
      'checklistFotosHandwerkskoordination',
      'checklistVerbrauchsmaterialErfasst',
      'checklistWarenkorbGeschickt',
      'checklistDokumentWarenpruefung',
      'checklistArbeitszeitenErfasst',
      'checklistBestaetigungKasse',
      'checklistDokumentArbeitsbericht',
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
    ];
    const flyerFields = [
      'checklistFlyerBadewannentuer',
      'checklistFlyerBadumbau',
      'checklistFlyerHaltegriffe',
    ];

    baseChecklistFields.forEach(name => setCheckboxValue(name, true));
    flyerFields.forEach(name => setCheckboxValue(name, name === preset.flyerFieldName));

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
      'unterschriftZusaetzlicheLeistungen',
      'unterschriftKunde',
      'unterschriftEinwilligung',
      'unterschriftMaengel',
      'unterschriftNB',
    ].forEach(drawDemoSignature);

    prefillDemoUploads(preset);
    updateChecklistVariant(textValues.auszufuehrendeTaetigkeiten);
    updateConfirmationLetterPreview();
    setSidebarSourcesHidden(true);
    showToast(`Musterdaten für ${preset.label} komplett eingefüllt – inklusive Signaturen, Testfotos und Testvideo.`, 'success');
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

  function prefillDemoUploads(preset = getSelectedDemoPreset()) {
    const fertigerUmbauPreview = clearUploadField('bilderFertigerUmbau');
    if (fertigerUmbauPreview) {
      addFiles('bilderFertigerUmbau', [
        createDemoImageFile(`${preset.imageLabelPrefix} 1`),
        createDemoImageFile(`${preset.imageLabelPrefix} 2`),
      ], fertigerUmbauPreview, true);
    }

    const videoPreview = clearUploadField('videoDesAblaufs');
    if (videoPreview) {
      addFiles('videoDesAblaufs', [createDemoVideoFile(preset.videoLabel)], videoPreview, false);
    }

    const abdichtungPreview = clearUploadField('fotosAbdichtung');
    if (abdichtungPreview) {
      addFiles('fotosAbdichtung', [createDemoImageFile(`${preset.imageLabelPrefix} Abdichtung`)], abdichtungPreview, true);
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
      'anrede','vorname','nachname','adresse.strasse','adresse.adresszeile2','adresse.plz','adresse.stadt','bitrixZusatzfeld','auftragsNummer','auszufuehrendeTaetigkeiten'
    ].forEach(name => {
      const input = form.querySelector(`[name="${name}"]`);
      if (!input) return;
      input.addEventListener('input', updateConfirmationLetterPreview);
      input.addEventListener('change', updateConfirmationLetterPreview);
    });
    updateConfirmationLetterPreview();
  }

  function bindAdditionalServicesConfirmationSync() {
    [
      'terminId',
      'zusaetzlicheArbeiten',
      'preisZusaetzlich',
    ].forEach(name => {
      const input = form.querySelector(`[name="${name}"]`);
      if (!input) return;
      input.addEventListener('input', updateAdditionalServicesConfirmationPreview);
      input.addEventListener('change', updateAdditionalServicesConfirmationPreview);
    });
    updateAdditionalServicesConfirmationPreview();
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
    const orderId = getValue('auftragsNummer') || 'ANG2026-XXXXX';
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

  function updateAdditionalServicesConfirmationPreview() {
    const terminValue = (form.querySelector('[name="terminId"]')?.value || '').trim();
    const rawPriceValue = (form.querySelector('[name="preisZusaetzlich"]')?.value || '').trim();
    const parsedPrice = Number.parseFloat(rawPriceValue.replace(',', '.'));
    const formattedPrice = Number.isFinite(parsedPrice)
      ? new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parsedPrice)
      : '0,00';

    const terminDisplay = $('#zusatzTerminIdDisplay');
    const priceDisplay = $('#zusatzPreisDisplay');

    if (terminDisplay) terminDisplay.value = terminValue || '—';
    if (priceDisplay) priceDisplay.textContent = `${formattedPrice} €`;
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

    if (normalized === 'hnr_de_1') return 'Frau';
    if (normalized === 'hnr_de_2') return 'Herr';
    if (normalized.includes('frau')) return 'Frau';
    if (normalized.includes('herr')) return 'Herr';
    if (normalized.includes('familie')) return 'Familie';
    return '';
  }

  function applyBitrixItemToForm(item) {
    const resolvedActivities = resolveBitrixActivities(item);
    const activityValue =
      resolvedActivities ||
      item.auszufuehrendeTaetigkeiten ||
      item.auszufuehrende_taetigkeiten ||
      item.resolvedAuszufuehrendeTaetigkeiten ||
      item.ufCrm_1725521281342Resolved ||
      item.UF_CRM_1725521281342_RESOLVED ||
      '';
    setFieldValue('terminId', item.id);
    setFieldValue('bitrixZusatzfeld', item.title || `Bitrix ${item.id}`);
    setFieldValue('kundennummer', item.contactId || item.id);
    setFieldValue('bitrixAuftragId', item.id);
    setFieldValue('auftragsNummer', item.UF_CRM_1776156870205 || item.ufCrm_1776156870205 || '');
    setAuszufuehrendeTaetigkeitenValue(activityValue);
    updateChecklistVariant(activityValue);
    updateConfirmationLetterPreview();
  }

  function applyBitrixContactToForm(contact) {
    setRadioValue('anrede', normalizeSalutation(contact.HONORIFIC || contact.POST));
    setFieldValue('vorname', contact.NAME || '');
    setFieldValue('nachname', contact.LAST_NAME || contact.SECOND_NAME || '');

    let street = contact.ADDRESS || '';
    let city = contact.ADDRESS_CITY || '';
    let plz = contact.ADDRESS_POSTAL_CODE || '';

    if (!street && !city && !plz && contact.ADDRESS_2) {
      const parsed = parseAddress2(contact.ADDRESS_2);
      street = parsed.street;
      city = parsed.city;
      plz = parsed.plz;
    }

    setFieldValue('adresse.strasse', street);
    setFieldValue('adresse.stadt', city);
    setFieldValue('adresse.plz', plz);
  }

  function parseAddress2(raw) {
    const value = String(raw || '').trim();
    const match = value.match(/^(.+?)\s+(?:DE-)?(\d{5})\s+(.+)$/);
    if (match) {
      return { street: match[1].trim(), plz: match[2], city: match[3].trim() };
    }
    return { street: value, plz: '', city: '' };
  }

  async function fetchBitrixDealById() {
    const terminIdInput = $('[name="terminId"]', form);
    const terminId = String(terminIdInput?.value || '').trim();

    if (!terminId) {
      showToast('Bitte zuerst eine Auftrags-ID eingeben.', 'error');
      return;
    }

    const dealId = terminId.replace(/\D/g, '');
    if (!dealId) {
      showToast('Keine gueltige Bitrix-Deal-ID in der Auftrags-ID gefunden.', 'error');
      return;
    }

    if (btnFetchBitrixLead) btnFetchBitrixLead.disabled = true;

    try {
      const res = await fetch(`/api/bitrix/deal/${encodeURIComponent(dealId)}`);
      const json = await res.json();

      if (!res.ok || !json.result) {
        showToast(json.error || 'Deal nicht gefunden.', 'error');
        return;
      }

      const deal = json.result;
      applyBitrixDealToForm(deal);
      showToast('Bitrix-Deal erfolgreich geladen.', 'success');
    } catch (error) {
      showToast('Fehler beim Abrufen des Deals: ' + error.message, 'error');
    } finally {
      if (btnFetchBitrixLead) btnFetchBitrixLead.disabled = false;
    }
  }

  function applyBitrixDealToForm(deal) {
    if (deal.TITLE) setFieldValue('bitrixZusatzfeld', deal.TITLE);
    if (deal.UF_CRM_1776156870205) setFieldValue('auftragsNummer', deal.UF_CRM_1776156870205);
    setFieldValue('bitrixAuftragId', deal.ID);

    const activityValue = resolveBitrixActivities(deal);
    if (activityValue) {
      setAuszufuehrendeTaetigkeitenValue(activityValue);
      updateChecklistVariant(activityValue);
    }

    const contactId = deal.CONTACT_ID;
    if (contactId) {
      fetchBitrixContact(contactId).then(contact => {
        if (contact) applyBitrixContactToForm(contact);
      });
    }
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

  function formatShortDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    return new Intl.DateTimeFormat('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
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
  function getStepTitle(section) {
    return $('h2', section)?.textContent?.trim() || `Schritt ${section?.dataset?.step || ''}`.trim();
  }

  function getFieldLabel(el) {
    const id = el.id;
    const explicit = id ? $(`label[for="${id}"]`, form) : null;
    if (explicit?.textContent?.trim()) return explicit.textContent.trim();

    const container = el.closest('div, fieldset, section');
    const label = container?.querySelector('.field-label');
    if (label?.textContent?.trim()) return label.textContent.trim();

    let node = container?.previousElementSibling || el.previousElementSibling;
    while (node) {
      if (node.classList?.contains('field-label')) return node.textContent.trim();
      node = node.previousElementSibling;
    }

    return el.name || 'Feld';
  }

  function getRequiredGroupLabel(groupEl) {
    let node = groupEl.previousElementSibling;
    while (node) {
      if (node.classList?.contains('field-label')) return node.textContent.trim();
      node = node.previousElementSibling;
    }
    return groupEl.querySelector('input')?.name || 'Auswahl';
  }

  function addValidationIssue(issues, section, message) {
    issues.push(`${getStepTitle(section)}: ${message}`);
  }

  function getClientLogIdentifiers() {
    return {
      terminId: $('[name="terminId"]', form)?.value || '',
      bitrixAuftragId: $('[name="bitrixAuftragId"]', form)?.value || '',
      auftragsNummer: $('[name="auftragsNummer"]', form)?.value || '',
      formId,
      draftId: formId,
    };
  }

  function getFileSummary() {
    return FILE_UPLOAD_FIELDS.reduce((acc, name) => {
      const freshFiles = fileStore[name] || [];
      const savedFiles = existingFileStore[name] || [];
      acc[name] = {
        freshCount: freshFiles.length,
        freshBytes: freshFiles.reduce((sum, file) => sum + (file.size || 0), 0),
        savedCount: savedFiles.length,
      };
      return acc;
    }, {});
  }

  function logClientEvent(payload = {}) {
    const body = {
      ...getClientLogIdentifiers(),
      browser: navigator.userAgent,
      path: window.location.pathname,
      ...payload,
    };

    fetch('/api/form/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  }

  function logValidationBlocked({ action, step, issues }) {
    const uniqueIssues = [...new Set(issues)];
    const section = $(`.form-step[data-step="${step}"]`);
    const issueList = uniqueIssues.map(i => `- ${i}`).join('\n');
    logClientEvent({
      level: 'warn',
      event: 'client.validation.blocked',
      message: `${action === 'submit' ? 'Absenden' : 'Weiter'} blockiert: ${uniqueIssues.length} Validierungsfehler.\n${issueList}`,
      action,
      step,
      stepTitle: getStepTitle(section),
      issues: uniqueIssues,
      fileSummary: getFileSummary(),
    });
  }

  function isSignatureRequired(wrapper) {
    const label = wrapper.previousElementSibling;
    return Boolean(label?.classList?.contains('field-label') && label.classList.contains('required'));
  }

  function validateStep(n, issues = []) {
    const section = $(`.form-step[data-step="${n}"]`);
    let valid = true;

    if (n === 0) {
      if (!currentFormularTyp) {
        addValidationIssue(issues, section, 'Bitte zuerst einen Formulartyp auswählen.');
        return false;
      }
      return true;
    }

    // Required text / date / select inputs
    $$('input[required], select[required], textarea[required]', section).forEach(el => {
      if (el.closest('.hidden')) return;
      // Skip hidden conditional fields
      const cond = el.closest('.conditional-field');
      if (cond && !cond.classList.contains('visible')) return;

      el.classList.remove('invalid');
      if (!el.value.trim()) {
        el.classList.add('invalid');
        addValidationIssue(issues, section, `${getFieldLabel(el)} fehlt.`);
        valid = false;
      }
    });

    // Required radio groups
    const radioGroups = $$('.choice-group, .radio-group', section)
      .filter(group => group.previousElementSibling?.classList?.contains('required'));
    radioGroups.forEach(group => {
      if (group.closest('.hidden')) return;
      const cond = group.closest('.conditional-field');
      if (cond && !cond.classList.contains('visible')) return;
      const radios = $$('input[type="radio"]', group);
      const checked = radios.some(r => r.checked);
      if (!checked) {
        addValidationIssue(issues, section, `${getRequiredGroupLabel(group)} fehlt.`);
        valid = false;
      }
    });

    // Required signatures
    $$('.signature-wrapper', section).forEach(wrapper => {
      if (wrapper.closest('.hidden')) return;
      if (!isSignatureRequired(wrapper)) return;
      const name = wrapper.dataset.name;
      const pad  = signaturePads[name];
      if (pad && pad.isEmpty()) {
        wrapper.style.borderColor = '#e53935';
        addValidationIssue(issues, section, `${getRequiredGroupLabel(wrapper)} fehlt.`);
        valid = false;
      } else if (wrapper.style.borderColor === 'rgb(229, 57, 53)') {
        wrapper.style.borderColor = '';
      }
    });

    if (n === 3) {
      const inspectionTable = $('.inspection-table', section);
      const inspectionRadios = $$('.inspection-row:not(.inspection-head) input[type="radio"]', section);
      const anyChecked = inspectionRadios.some(r => r.checked);
      if (inspectionTable) {
        if (!anyChecked) {
          inspectionTable.style.borderColor = '#e53935';
          inspectionTable.style.boxShadow = '0 0 0 2px rgba(229,57,53,.18)';
          addValidationIssue(issues, section, 'Bitte mindestens eine Ware prüfen (I.O. oder Nicht I.O.).');
          valid = false;
        } else {
          inspectionTable.style.borderColor = '';
          inspectionTable.style.boxShadow = '';
        }
      }

      const sigWrapper = $('.signature-wrapper', section);
      if (sigWrapper) {
        const sigName = sigWrapper.dataset.name;
        const pad = signaturePads[sigName];
        if (pad && pad.isEmpty()) {
          sigWrapper.style.borderColor = '#e53935';
          sigWrapper.style.boxShadow = '0 0 0 2px rgba(229,57,53,.18)';
          addValidationIssue(issues, section, `${getRequiredGroupLabel(sigWrapper)} fehlt.`);
          valid = false;
        } else {
          sigWrapper.style.borderColor = '';
          sigWrapper.style.boxShadow = '';
        }
      }
    }

    if (n === 4) {
      const requiredUploads = [
        { name: 'bilderFertigerUmbau', label: 'Bilder des fertigen Umbaus' },
        { name: 'videoDesAblaufs', label: 'Video des Ablaufs' },
        { name: 'fotosAbdichtung', label: 'Fotos der Abdichtung' },
      ];

      requiredUploads.forEach(({ name, label }) => {
        const wrapper = $(`.file-upload[data-name="${name}"]`, section);
        if (!wrapper) return;
        const hasFreshFiles = fileStore[name] && fileStore[name].length > 0;
        const hasSavedFiles = !!$('.file-thumb', wrapper);
        const hasFiles = hasFreshFiles || hasSavedFiles;
        const drop = $('.file-drop', wrapper);
        if (!hasFiles) {
          if (drop) {
            drop.style.borderColor = '#e53935';
            drop.style.boxShadow = '0 0 0 2px rgba(229,57,53,.18)';
          }
          addValidationIssue(issues, section, `${label} fehlt.`);
          valid = false;
        } else if (drop) {
          drop.style.borderColor = '';
          drop.style.boxShadow = '';
        }
      });
    }

    if (n === 11 && currentChecklistVariant === 'badumbau') {
      const previousCount = issues.length;
      if (!validateChecklistBadumbau(section, issues)) {
        if (issues.length === previousCount) {
          addValidationIssue(issues, section, 'Bitte die Checkliste vollständig ausfüllen.');
        }
        valid = false;
      }
    }

    return valid;
  }

  function showValidationSummary(issues) {
    const uniqueIssues = [...new Set(issues)];
    const visibleIssues = uniqueIssues.slice(0, 8);
    const suffix = uniqueIssues.length > visibleIssues.length
      ? `\n...und ${uniqueIssues.length - visibleIssues.length} weitere Punkte.`
      : '';
    showToast(`Bitte korrigieren:\n${visibleIssues.map(item => `- ${item}`).join('\n')}${suffix}`, 'error', 'big validation');
  }

  function validateCurrentStep(action = 'next') {
    const issues = [];
    const valid = validateStep(currentStep, issues);
    if (!valid) {
      showValidationSummary(issues);
      logValidationBlocked({ action, step: currentStep, issues });
    }
    return valid;
  }

  function validateAllSteps(action = 'submit') {
    const issues = [];
    for (const step of getVisibleStepNumbers()) {
      if (!validateStep(step, issues)) {
        showStep(step);
        showValidationSummary(issues);
        logValidationBlocked({ action, step, issues });
        return false;
      }
    }
    return true;
  }

  // ── Collect Form Data ──────────────────────────────────
  function collectFormData() {
    const data = {};
    if (formId) data._id = formId;
    data.formularTyp = currentFormularTyp || 'baustellenabnahme';

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
    data.bitrixExecutionActivities = data.auszufuehrendeTaetigkeiten || '';

    FILE_UPLOAD_FIELDS.forEach(fieldName => {
      const urls = existingFileStore[fieldName] || [];
      data[fieldName] = SINGLE_FILE_UPLOAD_FIELDS.has(fieldName)
        ? (urls[0] || '')
        : [...urls];
    });

    // Signatures → write base64 to data + timestamp
    for (const [name, pad] of Object.entries(signaturePads)) {
      if (!pad.isEmpty()) {
        data[name] = compactSignaturePadDataUrl(pad);
        // set corresponding timestamp
        // map the names properly
        const tsMap = {
          unterschriftZusaetzlicheLeistungen: 'unterschriftZusaetzlicheLeistungenZeitpunkt',
          unterschriftKunde:  'unterschriftZeitpunkt',
          unterschriftEinwilligung: 'unterschriftEinwilligungZeitpunkt',
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

  // ── Draft Name Modal ────────────────────────────────────
  function showDraftNameModal() {
    const modal = $('#draftNameModal');
    const input = $('#draftNameInput');
    const btnConfirm = $('#btnDraftNameConfirm');
    const btnCancel = $('#btnDraftNameCancel');
    if (!modal) { saveForm('save'); return; }

    input.value = $('[name="entwurfsName"]')?.value || '';
    modal.classList.add('open');
    input.focus();

    const cleanup = () => {
      modal.classList.remove('open');
      btnConfirm.removeEventListener('click', onConfirm);
      btnCancel.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKey);
    };

    const onConfirm = () => {
      const name = input.value.trim();
      setFieldValue('entwurfsName', name);
      cleanup();
      saveForm('save');
    };

    const onCancel = () => cleanup();

    const onKey = e => {
      if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };

    btnConfirm.addEventListener('click', onConfirm);
    btnCancel.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKey);
  }

  // ── Debug: Bitrix Request Shape ────────────────────────
  async function debugBitrixRequest() {
    const panel = $('#bitrixDebugPanel');
    const output = $('#bitrixDebugOutput');
    const btn = $('#btnDebugBitrix');
    if (!panel || !output) return;

    const data = collectFormData();
    const fd = new FormData();
    fd.append('formData', JSON.stringify(data));
    for (const [fieldName, files] of Object.entries(fileStore)) {
      files.forEach(f => fd.append(fieldName, f));
    }

    if (btn) btn.disabled = true;
    output.textContent = 'Lade …';
    panel.classList.remove('hidden');

    try {
      const res = await fetch('/api/form/debug-bitrix-payload', { method: 'POST', body: fd });
      const json = await parseJsonResponse(res);
      output.textContent = JSON.stringify(json, null, 2);
      console.log('[bitrix-debug] result', json);
      const requests = json.requests || json.bitrixSync?.requests || [];
      if (Array.isArray(requests)) {
        requests.forEach((r, i) => {
          console.log(`[bitrix-debug] request ${i + 1}: ${r.label} — ${r.ok ? 'OK' : 'FAIL'}`);
          console.log('  request body:', r.body);
          if (r.response) console.log('  response:', r.response);
          if (r.error) console.log('  error:', r.error);
        });
      }
    } catch (err) {
      output.textContent = 'Fehler: ' + err.message;
      console.error('[bitrix-debug] failed', err);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ── Save / Submit ──────────────────────────────────────
  async function saveForm(action) {
    if (saveInProgress) {
      showToast('Speichern läuft bereits. Bitte kurz warten.', 'error');
      return;
    }

    saveInProgress = true;
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
      const json = await parseJsonResponse(res);

      if (!json.success) throw new Error(json.error);

      formId     = json.id;
      shareToken = json.shareToken;
      activeDraftId = json.id;
      clearDirtyState();

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
          console.log('[bitrix-submit] sync result', json.bitrixSync);
          showToast('Erfolgreich übermittelt und an Bitrix gesendet! ✓', 'success', 'big');
        } else if (json.bitrixSync?.attempted && !json.bitrixSync?.sent) {
          setDocumentStatus(`Formular übermittelt, Bitrix-Sendung fehlgeschlagen: ${json.bitrixSync.error}`, 'error');
          console.warn('[bitrix-submit] sync failed', json.bitrixSync);
          showToast('Formular übermittelt, aber Bitrix konnte nicht aktualisiert werden.', 'error');
        } else {
          showToast('Erfolgreich übermittelt! ✓', 'success', 'big');
        }
        // Clear file store after successful submit
        fileStore = {};
        const stayOnPage = $('#stayOnPage')?.checked;
        if (!stayOnPage) {
          setTimeout(() => {
            window.location.href = '/';
          }, 2000);
        }
      }
    } catch (err) {
      console.error(`[form-${action}] failed`, err);
      showToast(`Fehler beim ${action === 'save' ? 'Speichern' : 'Absenden'}:\n${err.message}`, 'error', 'big validation');
    } finally {
      saveInProgress = false;
      [btnDraft, btnSubmit, btnNext].forEach(b => b.disabled = false);
    }
  }

  // ── Load Draft ─────────────────────────────────────────
  async function loadDraftIfNeeded() {
    // Check URL for /form/:token
    const match = window.location.pathname.match(/^\/form\/(.+)/);
    if (!match) return false;

    try {
      const res  = await fetch(`/api/form/token/${match[1]}`);
      const json = await res.json();
      if (!json.success) return false;

      const data = json.data;
      formId     = data._id;
      shareToken = data.shareToken;
      activeDraftId = data._id;

      resetFormState();
      populateForm(data);
      fetchDrafts();
      showToast('Entwurf geladen', 'success');
      return true;
    } catch (err) {
      console.error('Load draft error:', err);
      return false;
    }
  }

  function resetFormState() {
    suppressDirtyTracking = true;
    form.reset();
    fileStore = {};
    existingFileStore = {};
    signaturePadDataUrls = {};
    currentFormularTyp = FORMULAR_TYPE_DEFAULT;
    applyFormTypeUI();
    clearDirtyState();

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
    $$('.check-item-invalid', form).forEach(el => {
      el.classList.remove('check-item-invalid');
    });
    syncChecklistAutoSelections();
    suppressDirtyTracking = false;
  }

  function populateForm(data) {
    suppressDirtyTracking = true;
    chooseFormularTyp(data.formularTyp || 'baustellenabnahme', { updateHistory: false });

    if ((!data.anrede && !data.vorname && !data.nachname) && data.name) {
      Object.assign(data, splitLegacyName(data.name));
    }

    if (!data.auszufuehrendeTaetigkeiten && data.bitrixExecutionActivities) {
      data.auszufuehrendeTaetigkeiten = data.bitrixExecutionActivities;
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

    syncChecklistAutoSelections();
    updateAdditionalServicesConfirmationPreview();

    // Signatures – cache each data URL so we can re-apply after a step's
    // canvas is sized (initSignaturePads runs before the step is visible;
    // hidden canvases have width=0 and fromDataURL paints nothing).
    for (const [name, pad] of Object.entries(signaturePads)) {
      if (!data[name]) continue;
      signaturePadDataUrls[name] = data[name];
      applySignatureDataUrl(pad, data[name]);
    }

    // Existing file URLs → show as previews and keep them in the next save.
    FILE_UPLOAD_FIELDS.forEach(fieldName => {
      const urls = Array.isArray(data[fieldName]) ? data[fieldName] : (data[fieldName] ? [data[fieldName]] : []);
      existingFileStore[fieldName] = urls.filter(Boolean);
      if (!existingFileStore[fieldName].length) return;
      const wrapper = $(`.file-upload[data-name="${fieldName}"]`);
      if (!wrapper) return;
      const preview = $('.file-preview', wrapper);
      existingFileStore[fieldName].forEach(url => {
        const thumb = document.createElement('div');
        thumb.className = 'file-thumb';
        const fileName = String(url).split('/').pop();
        const isVideo = fieldName === 'videoDesAblaufs';
        thumb.innerHTML = `
          ${isVideo ? `<video src="${url}" muted></video>` : `<img src="${url}" alt="${fileName}" />`}
          <div class="file-thumb-missing hidden">${isVideo ? 'Video' : 'Datei'} nicht verfügbar<br><small>${fileName}</small></div>
          <button type="button" class="remove-file">✕</button>
        `;
        const media = isVideo ? $('video', thumb) : $('img', thumb);
        media.addEventListener('error', () => {
          media.classList.add('hidden');
          $('.file-thumb-missing', thumb).classList.remove('hidden');
        });
        preview.appendChild(thumb);
        $('.remove-file', thumb).addEventListener('click', () => {
          existingFileStore[fieldName] = (existingFileStore[fieldName] || []).filter(item => item !== url);
          thumb.remove();
          markFormDirty();
        });
      });
    });

    // Trigger conditional field visibility
    $$('input[type="radio"]:checked', form).forEach(el => el.dispatchEvent(new Event('change', { bubbles: true })));
    updateChecklistVariant(data.auszufuehrendeTaetigkeiten || '');
    updateConfirmationLetterPreview();
    clearDirtyState();
    suppressDirtyTracking = false;
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
      if (!existingFileStore[fieldName]) existingFileStore[fieldName] = [];

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
    if (!fileStore[fieldName]) fileStore[fieldName] = [];
    if (!existingFileStore[fieldName]) existingFileStore[fieldName] = [];

    if (!multi) {
      fileStore[fieldName] = [];
      existingFileStore[fieldName] = [];
      previewEl.innerHTML = '';
    }

    if (files.length) {
      markFormDirty();
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
        markFormDirty();
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

  function initWarenpruefungDatum() {
    const today = new Date().toISOString().slice(0, 10);
    ['warenpruefungDatum', 'unterschriftMonteurDatum'].forEach(name => {
      const input = $(`[name="${name}"]`, form);
      if (input && !input.value) input.value = today;
    });
  }

  // ── Signature Pads ─────────────────────────────────────
  function refreshPasteSigButtons() {
    pasteSigButtons.forEach(btn => { btn.disabled = !copiedSignatureDataUrl; });
  }

  function initSignaturePads() {
    $$('.signature-wrapper').forEach(wrapper => {
      const name   = wrapper.dataset.name;
      const canvas = $('canvas', wrapper);
      const pad    = new SignaturePad(canvas, {
        backgroundColor: 'rgb(255,255,255)',
        penColor: 'rgb(0, 0, 0)',
      });
      signaturePads[name] = pad;

      const clearBtn = $('.btn-clear-sig', wrapper);
      const actions = document.createElement('div');
      actions.className = 'sig-actions';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn-copy-sig';
      copyBtn.textContent = 'Kopieren';

      const pasteBtn = document.createElement('button');
      pasteBtn.type = 'button';
      pasteBtn.className = 'btn-paste-sig';
      pasteBtn.textContent = 'Einfügen';
      pasteBtn.disabled = !copiedSignatureDataUrl;
      pasteSigButtons.add(pasteBtn);

      const uploadBtn = document.createElement('button');
      uploadBtn.type = 'button';
      uploadBtn.className = 'btn-upload-sig';
      uploadBtn.textContent = 'Bild hochladen';

      const uploadInput = document.createElement('input');
      uploadInput.type = 'file';
      uploadInput.accept = 'image/*';
      uploadInput.style.display = 'none';

      clearBtn.parentNode.insertBefore(actions, clearBtn);
      actions.appendChild(uploadBtn);
      actions.appendChild(copyBtn);
      actions.appendChild(pasteBtn);
      actions.appendChild(clearBtn);
      actions.appendChild(uploadInput);

      uploadBtn.addEventListener('click', () => uploadInput.click());

      uploadInput.addEventListener('change', async () => {
        const file = uploadInput.files && uploadInput.files[0];
        uploadInput.value = '';
        if (!file) return;
        try {
          const processed = await convertImageToSignatureDataUrl(file);
          applySignatureDataUrl(pad, processed);
          signaturePadDataUrls[name] = processed;
          copiedSignatureDataUrl = processed;
          refreshPasteSigButtons();
          wrapper.style.borderColor = '';
          wrapper.style.boxShadow = '';
          markFormDirty();
          showToast('Unterschrift aus Bild übernommen — kann nun auch in andere Felder eingefügt werden.', 'success');
        } catch (err) {
          console.error('Signature image conversion failed', err);
          showToast('Bild konnte nicht als Unterschrift verarbeitet werden.', 'error');
        }
      });

      copyBtn.addEventListener('click', () => {
        if (pad.isEmpty()) {
          showToast('Unterschrift ist leer — nichts zu kopieren.', 'error');
          return;
        }
        copiedSignatureDataUrl = compactSignaturePadDataUrl(pad);
        refreshPasteSigButtons();
        showToast('Unterschrift kopiert.', 'success');
      });

      pasteBtn.addEventListener('click', () => {
        if (!copiedSignatureDataUrl) return;
        applySignatureDataUrl(pad, copiedSignatureDataUrl);
        signaturePadDataUrls[name] = copiedSignatureDataUrl;
        wrapper.style.borderColor = '';
        wrapper.style.boxShadow = '';
        markFormDirty();
        showToast('Unterschrift eingefügt.', 'success');
      });

      clearBtn.addEventListener('click', () => {
        pad.clear();
        delete signaturePadDataUrls[name];
        wrapper.style.borderColor = '';
        markFormDirty();
      });

      // On signature begin → clear validation error
      pad.addEventListener('beginStroke', () => {
        delete signaturePadDataUrls[name];
        wrapper.style.borderColor = '';
        markFormDirty();
      });
    });
    resizeAllSignatureCanvases();
    window.addEventListener('resize', () => resizeAllSignatureCanvases());
  }

  function convertImageToSignatureDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read failed'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('image load failed'));
        img.onload = () => {
          try {
            const MAX_DIM = 1600;
            let sw = img.naturalWidth, sh = img.naturalHeight;
            const scale = Math.min(1, MAX_DIM / Math.max(sw, sh));
            sw = Math.max(1, Math.round(sw * scale));
            sh = Math.max(1, Math.round(sh * scale));
            const src = document.createElement('canvas');
            src.width = sw; src.height = sh;
            const sctx = src.getContext('2d');
            sctx.drawImage(img, 0, 0, sw, sh);
            const data = sctx.getImageData(0, 0, sw, sh);
            const px = data.data;

            const THRESH = 190;
            let minX = sw, minY = sh, maxX = -1, maxY = -1;
            for (let y = 0; y < sh; y++) {
              for (let x = 0; x < sw; x++) {
                const i = (y * sw + x) * 4;
                const a = px[i + 3];
                if (a < 16) continue;
                const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
                if (lum < THRESH) {
                  if (x < minX) minX = x;
                  if (y < minY) minY = y;
                  if (x > maxX) maxX = x;
                  if (y > maxY) maxY = y;
                }
              }
            }
            if (maxX < 0) {
              reject(new Error('no signature ink detected'));
              return;
            }

            const cropW = maxX - minX + 1;
            const cropH = maxY - minY + 1;
            const out = document.createElement('canvas');
            out.width = cropW;
            out.height = cropH;
            const octx = out.getContext('2d');
            const outImg = octx.createImageData(cropW, cropH);
            const op = outImg.data;
            for (let y = 0; y < cropH; y++) {
              for (let x = 0; x < cropW; x++) {
                const si = ((y + minY) * sw + (x + minX)) * 4;
                const di = (y * cropW + x) * 4;
                const a = px[si + 3];
                const lum = a < 16 ? 255
                  : 0.299 * px[si] + 0.587 * px[si + 1] + 0.114 * px[si + 2];
                if (lum < THRESH) {
                  const t = Math.max(0, Math.min(1, (THRESH - lum) / THRESH));
                  op[di] = 0; op[di + 1] = 0; op[di + 2] = 0;
                  op[di + 3] = Math.round(255 * (0.4 + 0.6 * t));
                } else {
                  op[di] = 255; op[di + 1] = 255; op[di + 2] = 255; op[di + 3] = 255;
                }
              }
            }
            octx.putImageData(outImg, 0, 0);
            resolve(out.toDataURL('image/png'));
          } catch (e) {
            reject(e);
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function compactSignaturePadDataUrl(pad) {
    const out = document.createElement('canvas');
    out.width = SIGNATURE_EXPORT_WIDTH;
    out.height = SIGNATURE_EXPORT_HEIGHT;
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(pad.canvas, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  function applySignatureDataUrl(pad, dataUrl) {
    if (!dataUrl) return;
    const ratio = window.devicePixelRatio || 1;
    const w = pad.canvas.width / ratio;
    const h = pad.canvas.height / ratio;
    if (w <= 0 || h <= 0) return; // canvas not sized yet; will be applied on resize
    try { pad.fromDataURL(dataUrl, { width: w, height: h }); }
    catch (_err) { /* ignore invalid data URL */ }
  }

  function resizeAllSignatureCanvases() {
    for (const [name, pad] of Object.entries(signaturePads)) {
      const canvas  = pad.canvas;
      const wrapper = canvas.parentElement;
      const ratio   = Math.max(window.devicePixelRatio || 1, 1);
      const w       = Math.max(wrapper.clientWidth - 16, 0);

      // Pad's step is hidden — skip entirely. Resizing to 0×0 would wipe the
      // canvas and scrambles pad.fromData() on return. Internal _data and
      // current pixel buffer both persist until the step becomes visible.
      if (w <= 0) continue;

      // Preserve stroke data AND any loaded image.
      const strokes = pad.toData();
      const priorDataUrl = pad.isEmpty() ? null : pad.toDataURL();
      const cachedUrl = signaturePadDataUrls[name];

      canvas.width  = w * ratio;
      canvas.height = 200 * ratio;
      canvas.style.width  = w + 'px';
      canvas.style.height = '200px';
      canvas.getContext('2d').scale(ratio, ratio);

      pad.clear();
      if (strokes.length) {
        pad.fromData(strokes);
      } else {
        // Prefer the cached source of truth: pad.fromDataURL sets _isEmpty
        // synchronously to false but paints asynchronously, so toDataURL()
        // in the same tick can return a blank canvas. Only fall back to
        // priorDataUrl when the cache has been cleared (user cleared or
        // redrew — see clear button + beginStroke below).
        const urlToApply = cachedUrl || priorDataUrl;
        if (urlToApply) {
          try { pad.fromDataURL(urlToApply, { width: w, height: 200 }); }
          catch (_err) { /* skip */ }
        }
      }
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
  function showToast(msg, type = '', size = '') {
    toast.textContent = msg;
    toast.className = ['toast', 'visible', type, size].filter(Boolean).join(' ');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.className = 'toast'; }, 3500);
  }

  // ── Boot ───────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);
})();
