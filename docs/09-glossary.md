# Glossary

German terms used throughout the codebase and their meanings.

## Business Terms

| German | English | Context |
|--------|---------|---------|
| Abnahme | Acceptance/inspection | Final construction site handover inspection |
| Arbeitsbericht | Work report | Detailed report of work performed, generated as PDF |
| Auftrags-Nummer | Order number | Reference number for the customer order |
| Auszuführende Tätigkeiten | Activities to perform | List of work items from Bitrix deal |
| Baustellenabnahme | Construction site inspection | Full handover process with customer |
| Bestätigung | Confirmation | The confirmation letter sent to insurance |
| Entwurf | Draft | Saved but not yet submitted form |
| Förderung | Funding/grant | Care insurance subsidy (§40 SGB XI) |
| Handläufe | Handrails | Wall-mounted handrails for accessibility |
| Haltegriffe | Grab rails | Grab rails installed in bathrooms |
| Hinweise für das Büro | Notes for the office | Internal notes from field worker to office |
| Kunde | Customer | The end customer receiving the renovation |
| Kundennummer | Customer number | Customer ID in the system |
| Mängelbeseitigung | Defect resolution | Fixing defects found after initial work |
| Monteur | Technician/installer | Field worker performing the renovation |
| Nachbesserung | Rework/remediation | Follow-up work to complete or fix items |
| Pflegekasse | Care insurance fund | German long-term care insurance (pays for accessibility renovations) |
| Schadensmeldung | Damage report | Report of damage found on site |
| Termin | Appointment | Scheduled on-site visit |
| Termin-ID | Appointment ID | Unique identifier for the appointment |
| Umbau | Renovation/conversion | Construction work to modify the bathroom |
| Unterschrift | Signature | Digital signature captured on canvas |
| Warenprüfung | Goods inspection | Checking delivered materials before installation |
| Zusätzliche Leistungen | Additional services | Extra work beyond the original order scope |
| Zwischenspeichern | Save draft | Save the form without submitting |

## UI Terms

| German | English | Context |
|--------|---------|---------|
| Absenden | Submit | Final form submission |
| Aktualisieren | Refresh | Reload data from server |
| Aufnehmen | Capture | Take a photo or start recording |
| Herunterladen | Download | Download a file |
| Löschen | Delete/Clear | Clear a signature pad |
| Musterdaten | Demo/test data | Pre-filled test data for development |
| Suchen | Search | Search for items |
| Testmodus | Test/dev mode | Development mode toggle |
| Vorschau | Preview | Document preview |
| Weiter | Next | Navigate to next step |
| Zurück | Back | Navigate to previous step |

## Technical Terms

| Term | Meaning |
|------|---------|
| `io` / `nicht-io` | "In Ordnung" (OK) / "Nicht in Ordnung" (Not OK) — goods inspection status values |
| `Anrede` | Salutation — `Frau` (Ms), `Herr` (Mr), `Familie` (Family) |
| `Abschluss` | Completion/conclusion |
| `Baustelle` | Construction site |
| `Checkliste` | Checklist |
| `FortyTools` | External tool used for time tracking and material management |
| `GC-App` | External app for consumable material tracking |
| `Handwerkskoordination` | Craft coordination — the office team coordinating field work |
| `KVA` | Kostenvoranschlag — cost estimate for additional work |
| `SGB XI` | Sozialgesetzbuch XI — German Social Code Book XI (long-term care insurance law) |

## Bitrix CRM Terms

| Term | Meaning |
|------|---------|
| `Deal` | A Bitrix CRM deal representing a customer order |
| `Contact` | A Bitrix CRM contact (person) |
| `Requisite` | A Bitrix entity holding legal/address details for a contact |
| `Timeline` | Activity feed on a Bitrix deal/contact |
| `Stage` | Pipeline stage that a deal is in |
| `Entity Type ID` | Numeric type identifier (2=Deal, 3=Contact, 4=Company, 8=Requisite) |
| `UF_CRM_*` | User-defined fields in Bitrix |
