# Form Types and Step Workflows

## Form Types

The application supports 4 form types (Formulartypen), selectable on Step 0. Each type shows a different subset of the 11 available steps.

| Type | German Name | Description | Use Case |
|------|------------|-------------|----------|
| `baustellenabnahme` | Baustellenabnahme | Full construction site inspection | Complete bathroom renovation handover |
| `zusaetzliche_leistungen` | Beauftragung zusätzliche Leistungen | Additional services order | Ordering extra work beyond original scope |
| `nachbesserung` | Nachbesserung | Rework/remediation | Follow-up visit to fix or complete work |
| `schadensmeldung` | Schadensmeldung | Damage report | Documenting on-site damage |

## Step Visibility Matrix

Steps are shown/hidden based on `data-form-type-only` attributes on `<section>` elements. A step without this attribute is always visible.

| Step | Content | baustellenabnahme | zusaetzliche_leistungen | nachbesserung | schadensmeldung |
|------|---------|:-:|:-:|:-:|:-:|
| 0 | Form type selector | Always | Always | Always | Always |
| 1 | Grunddaten (basic data) | Always | Always | Always | Always |
| 3 | Warenprüfung (goods inspection) | Yes | — | — | — |
| 4 | Fotos & Video | Yes | — | — | Yes |
| 5 | Weitere Bilder (more images) | Yes | — | — | Yes |
| 6 | Bestätigung Umbau (confirmation letter) | Yes | — | — | — |
| 7* | Mängelbeseitigung (defect resolution) | Dev only | — | — | — |
| 8* | Nachbesserung (rework) | Dev only | — | Yes | — |
| 9* | Arbeitsbericht (work report) | Dev only | — | — | — |
| 10 | Hinweise (notes for office) | Always | Always | Always | Always |
| 11 | Montage-Checkliste (assembly checklist) | Yes | — | — | — |

**Note:** Steps marked with `*` have the `dev-only-step` CSS class and are only visible when **Testmodus (dev mode)** is active, unless the step is specifically included in a non-baustellenabnahme form type (e.g., step 8 is always visible for `nachbesserung`).

**Note:** There is no step 2. Step numbering in the HTML `data-step` attributes is: 0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11.

## Step Navigation

Navigation is sequential through visible steps only. The system dynamically calculates which steps are visible based on:
1. The selected form type (`data-form-type-only` attribute)
2. Whether dev mode is active (for `dev-only-step` sections)

Key functions:
- `getVisibleStepNumbers()` — returns sorted array of currently visible step numbers
- `getNextVisibleStep(n)` / `getPreviousVisibleStep(n)` — find adjacent visible steps
- `showStep(n)` — display a specific step, update navigation buttons and step dots

### Navigation Buttons

| Button | Visible When | Action |
|--------|-------------|--------|
| Zurück (Back) | Not on first visible step | Go to previous visible step |
| Weiter (Next) | Not on last visible step | Go to next visible step (validates current step first) |
| Zwischenspeichern (Draft) | Not on step 0 | Save current state as draft |
| Absenden (Submit) | On last visible step | Validate all steps and submit |
| Hauptmenü (Home) | Not on step 0 | Return to form type selector (confirms if unsaved changes) |

## Step Indicator (Dots)

The step indicator shows numbered dots for all visible workflow steps (step > 0). The current step dot is highlighted as `active`, completed steps are marked as `completed`.

## Validation

Validation runs on step advance (if not in dev mode) and on submit (always).

### Per-Step Validation (`validateStep(n)`)
1. Step 0: Checks that a form type has been selected
2. All other steps:
   - Required text/date/email/select/textarea inputs must have non-empty values
   - Required radio groups must have a selection
   - Required signature canvases must not be empty
   - Hidden elements and invisible conditional fields are skipped
3. Step 11 (Checklist): If variant is `badumbau`, validates that specific checkboxes are checked

### Auto-Checked Checklist Items
Three checklist items are automatically checked and disabled (cannot be unchecked):
- `checklistDokumentWarenpruefung` — Goods inspection signed
- `checklistBestaetigungKasse` — Insurance confirmation signed
- `checklistDokumentArbeitsbericht` — Work report signed

These represent documents that are considered signed by virtue of completing the digital form.

## Checklist Variants

The final checklist step (Step 11) adapts its title and required fields based on the type of work being performed. The variant is determined by the `auszufuehrendeTaetigkeiten` field value:

| Variant Key | Trigger | Title |
|-------------|---------|-------|
| `badumbau` | Default, or value contains bathroom renovation terms | Checkliste Badumbau |
| `badewannentuer` | Value contains "Badewannentüre" or "Badewannentür" | Checkliste Badewannentür |
| `handlaeufe` | Value contains "Handläufe" | Checkliste Handläufe |

The `badumbau` variant has the strictest validation — it requires specific photo documentation and flyer checkboxes to be checked.

## Conditional Fields

Some fields are conditionally visible based on other field values:

```html
<div class="conditional-field" data-show-when="alleArbeitenNB" data-show-value="Nein">
```

When the radio button `alleArbeitenNB` has value `"Nein"`, the div becomes visible. This is used for "which work was NOT completed?" textarea fields.

## Dev Mode (Testmodus)

Toggled via the "Testmodus: An/Aus" button in the header. Persisted in `localStorage` (`bauFormularDevMode`).

When active:
- Step navigation skips validation (any step can be advanced without filling required fields)
- Dev-only steps (7, 8, 9) become visible
- Bitrix sidebar, draft panel, and debug fields become visible
- "Musterdaten einfüllen" (fill demo data) button appears
- "Musterdaten komplett" header button appears
- Document preview panel becomes visible on step 10
- Bitrix debug fields (Zusatzfeld, Auszuführende Tätigkeiten) become visible

## Step 1 Content Adaptation

Step 1's title and intro text change based on the selected form type:

| Form Type | Title | Description |
|-----------|-------|-------------|
| `baustellenabnahme` | Abschluss der Baustelle | Full guided walkthrough with customer |
| `zusaetzliche_leistungen` | Grunddaten zusätzliche Leistungen | Record customer data and additional services |
| `nachbesserung` | Grunddaten Nachbesserung | Record basic data for rework |
| `schadensmeldung` | Grunddaten Schadensmeldung | Record basic data for damage report |

For `zusaetzliche_leistungen`, step 1 also shows an additional services section with:
- Legal text about additional work authorization
- Additional work description textarea
- Price input field
- Dedicated signature canvas
