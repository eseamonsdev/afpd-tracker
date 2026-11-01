# Officer association display audit — November 1, 2026

Current instruction supersedes the narrower draft below: preserve **all 29 production strong associations and all 113 production confirmed dated entries** across all days. The frozen response is retained in `data/production-officer-association-baseline.json` with its source URL, capture timestamp, and original response hash. Every protected entry is retained; evidence dates can only gain accepted additions. Pending possibilities and observed-only entries are not restored in bulk. Original verifier attribution remains intact. New conflicting dated assertions stay in CSV rather than joining a protected date.

Audited staging `32c19dfe8debce935c91cd0808e79dbd1569a2f6`, live production, and the pre-union curated production entries retained in canonical evidence. Live production also contains the earlier unfiltered migration; it is not wholly clean. The baseline therefore combines the curated pre-union pairs with production pairs that have one roster identity. Imported competing names are not granted baseline status.

## Cause

`data/officer-association-evidence.json` has `review_mode: include-all`. The previous compiler counted both supporting and confirmed rows as evidence, even when an imported review entry originally said hold or not-a-contradiction. Two dates generated a possible association; four generated strong. `public/js/radio-player-core.js` then combined dated associations with those general associations on every selected date. Oct. 31 exposed historical alternatives; its metadata did not establish new officer identities. Multiple records for the same exchange did not increase distinct date counts, but alternative people could independently reach the threshold.

## Repeated general associations in staging before this fix

| Radio ID | Previously displayed names | Now eligible | Sources for competing candidates |
| --- | --- | --- | --- |
| 14580151 | Tanner M. Ballamis; Steve (unresolved) | Tanner M. Ballamis | legacy-review-011, legacy-review-012, legacy-review-020, workbook-E349-1, workbook-E350-1, workbook-E353-1, workbook-E358-1, workbook-E359-1, workbook-E360-1, workbook-E361-1, workbook-E362-1, workbook-E363-1, workbook-E364-1 |
| 14590019 | Dennis R. McClellan; Jonathan Wagley | None; competing unconfirmed candidates stay CSV-only | workbook-E003-1, workbook-E006-1, workbook-E007-1, workbook-E129-1, workbook-E159-1, workbook-E208-1, workbook-E221-1, workbook-E226-1 |
| 14590036 | Mitchell R. Godfrey; Steven G. Hawkins | None; competing unconfirmed candidates stay CSV-only | workbook-E026-1, workbook-E068-1, workbook-E070-1, workbook-E110-1, workbook-E313-1, workbook-E316-1, workbook-E317-1 |
| 14590045 | Delton L. Choates; Joe (unresolved) | Delton L. Choates | legacy-review-021, legacy-review-029 |
| 14590073 | J. Tayler Somerville; Jaclyn G. Strong | J. Tayler Somerville | legacy-review-031, legacy-review-035, workbook-E097-1, workbook-E168-1, workbook-E169-1, workbook-E182-1, workbook-E223-1, workbook-E227-1, workbook-E255-1, workbook-E256-1, workbook-E339-1, workbook-E351-1 |
| 14590100 | Colby A. Heaton; Sammantha J. Halladay | Sammantha J. Halladay | legacy-review-037, legacy-review-045, legacy-review-054, legacy-review-055, workbook-E130-1, workbook-E163-1, workbook-E164-1, workbook-E301-1, workbook-E329-1, workbook-E331-1 |
| 14590104 | David Gonzalez; Jaclyn G. Strong | Jaclyn G. Strong | legacy-review-062, legacy-review-063, workbook-E012-1, workbook-E013-1, workbook-E224-1, workbook-E234-1, workbook-E365-1 |
| 14590313 | Delton L. Choates; Steven G. Hawkins; Charles (unresolved); Joe (unresolved) | Delton L. Choates | legacy-review-008, legacy-review-016, legacy-review-026, legacy-review-047, legacy-review-048, legacy-review-061 |

Live production additionally still carried Sammantha J. Halladay and Samuel Canizalez together on `14590221`. The preceding staging fix (`13caa80`) had already unassigned the ambiguous shared-name evidence and preserved Eric’s Oct. 30 Halladay confirmation. The new pair policy carries only Halladay.

The David on Jaclyn’s `14590104` is **David Gonzalez**, not David O. Guerra. `legacy-review-062` (Oct. 3) was labeled not-a-contradiction: a transmission 31 seconds later concerned a separate Auto Mall incident. `legacy-review-063` (Oct. 26) was held for an uncertain David hail and ambiguous reply. Neither is an Eric confirmation. Guerra’s separately confirmed pair is `14590023`.

Jaclyn on Somerville’s `14590073` comes from `legacy-review-031` (Oct. 2, clips 107–108) and `legacy-review-035` (Oct. 4, clips 131–132). Both were held. The first notes that Jackie also replied later; the second is a repeated name on Somerville’s ID. Importing them as supporting rows made two dates qualify.

## Data flow and provenance

- Original named exchanges: `public/records/openmhz/afpd-radio-id-response-days.xlsx`, Exchanges sheet, retained with workbook evidence IDs and provenance ref `7dd4b1a`.
- Screened candidates and holds: `findings/2026-10-27-radio-officer-label-review.json`, retained as `legacy-review-NNN` with their original explanations.
- Canonical union: `data/officer-association-evidence.json`; all original rows remain. Existing context exclusions and historical owner evidence selections continue to apply.
- Compiler: `lib/build-officer-associations.js`, with display selection in `lib/association-display-policy.js`.
- Generated player/profile data: `public/records/openmhz/officer-associations.json`.
- Full candidate/evidence exports: `public/records/openmhz/afpd-radio-officer-ids.csv` and `officer-association-evidence.csv`. These now include Confirmed association, Display eligible, and Display reason.
- Players, profile ID tables, and rendered radio resources use the same eligibility decision. The listening-review page remains a review surface and continues to include candidates.

## User-reviewed history preserved

Commit `294cef723db3180f7c764846ddd58299d48632ce` imported Eric’s saved review from `afpd-association-review-2026-11-01T04-35-01.063Z.json`. Its tracked audit is `data/personal-association-review-imports/c8a51dbed83fb03f.json`. It includes 97 selected Mason evidence clips across 23 radio/date groups and the Oct. 28 clip 54 correction, stable recording `6001:2026-10-28:dcfems-6001-1793220194.m4a`: “Mason, when you get here, let’s try to set up a landing zone…” Original text, Eric’s reviewer attribution, and verification metadata remain intact. Evidence selection and transcript correction are not silently relabeled as personal identity confirmation. Both established Mason pairs remain visible.

## Earlier display policy before the full production-preservation instruction

The include-all mode has been removed, and supplying the old mode setting fails the build. Individual accepted evidence records carry `association_reviewed` and an acceptance basis. The accepted production baseline and owner evidence selections were preserved; unreviewed transcript/AI candidates never count toward strength.

1. Retain every Eric-confirmed dated instance. Its identity overrides all general names for that radio on that date, including a different strong identity. Historical holds and AI context exclusions cannot remove it.
2. Do not promote a dated confirmation into a permanent pair approval. A separate explicit general approval remains possible; it does not override dated identity.
3. General strong and possible associations are never mixed. Strong takes precedence; otherwise two individually accepted possible associations may coexist.
4. New unreviewed candidates cannot introduce contradictions, displace a confirmed name, or increase an existing association's strength. A retained general-pair list also prevents added competing evidence from automatically replacing an established mapping. Accepting a new competing general pair requires an explicit pair decision; date-specific owner confirmations remain authoritative without that general approval. Candidates remain in CSV/review evidence.
5. Eric now explicitly identifies Jackie in the Jackie/David instances. The Oct. 3 and Oct. 26 entries are recorded as Jaclyn G. Strong on 14590104. The two old David Gonzalez candidate rows remain in the CSV as rejected identity assignments, with their original wording and previous status retained. No clip transcript or audio was changed by this correction.
6. The review page also retains saved personal confirmations when later AI context exclusions or missing review-payload clips would previously have discarded them. Explicit user unchecks still apply.
7. Display names use the profile header, including Kyle B. Pitt and David O. Guerra.

General entries in the earlier table are source-tracing examples, not a promise that a one-date owner confirmation will carry onto other dates. In particular, Halladay on 14590100 has an accepted possible general association; Samuel on 14590066 remains confirmed for Sept. 28 only. Halladay on 14590221 remains confirmed for Oct. 30 only.

## Validation

The site build and JavaScript regression suite cover retention of all existing owner-confirmed dates, date-specific exceptions to strong identities, strong/possible precedence, two accepted possibles coexisting, rejection of include-all, unreviewed additions leaving generated labels unchanged, and saved confirmation retention. The personal review importer tests verify transcript edits, selected evidence, and prior selections remain intact.

Earlier checks before the full production-preservation change: 132 JavaScript tests, 3 personal-review importer tests, and a successful 182-page site build. All 23 pre-existing distinct owner-confirmed officer/radio/date instances are retained; the two Jackie corrections bring the total to 25. No generated general-association radio mixes strong and possible labels.

## Production preservation verification

135 JavaScript tests and the 182-page site build pass. Regression tests check every one of the 29 captured strong mappings and its evidence dates, every one of the 113 captured confirmed date mappings and its verifier attribution, and suppression of new contradictory dated names. The revised output retains all protected entries and includes the additional accepted Jackie date.
