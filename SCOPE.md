# SOX 404 / ITGC evidence agent for SAP (USA only): scope

Status: proposal, 2026-10-19. Owner: Yuvaraj. Region: United States only. No India, EU or other regimes in this project.

## 1. Problem
US public companies running SAP must show, every year, that controls over financial reporting worked (SOX 404, tested to PCAOB AS 2201, framework usually COSO 2013). For SAP the heavy parts are the IT general controls (ITGC) and the application controls that depend on them: who has access, who changed what, and whether journal postings followed the rules. Today this is auditors and control owners pulling screenshots and spreadsheet extracts by hand, sampling a few items, and arguing about completeness.

Our angle, carried over from the stock sandbox: **the agent never decides compliance and never does arithmetic or matching with the LLM.** Deterministic code runs each test over the full population, every run is written to a hash-chained audit log, and an evidence pack can be verified offline by anyone (auditor, client) with no SAP system. The LLM only does the language work around the tests.

## 2. What it does
1. **Control library.** A versioned catalogue of controls (section 4) as data: control ID, risk, test logic, population, owner, frequency, pass rule.
2. **Test runner.** Runs a control against the SAP-shaped data (section 5), full population, and produces: result (PASS / EXCEPTIONS / UNAVAILABLE), exception list, population count, query version and data digest. Same pattern as `validateOrderStock`: deterministic, versioned, audited.
3. **Evidence pack.** Per run: signed-off-by field for the human control owner, the exception list, the audit-log hash chain segment, and a one-page narrative. Exportable as JSON Lines plus a PDF. `verify-export.js` style offline verification is reused.
4. **Agent layer (LLM).** Natural-language entry: "Show me SoD conflicts for AP clerks this quarter", "Which manual journals after period close need explanation?". It selects tools, explains results, drafts the exception narrative, and maps a new SEC/PCAOB/COSO change to the controls it touches. It cannot mark a control effective; only a named human can.
5. **Reconciliation to the system of record.** As in v2.1/v2.2: after a test, compare headline counts with an independent read (the ledger service) and flag MATCH / MISMATCH / UNAVAILABLE.

## 3. Hard rules (carried from the sandbox)
- LLM never computes a result, a count or a match; code does.
- Every call is audited with correlation id, end user, data version and rule version.
- Read-only against SAP. No write tools in the first release.
- A MISMATCH or UNAVAILABLE never silently becomes PASS.
- Human sign-off is a separate, audited action by a named user; the agent has no scope for it.

## 4. Control catalogue, release 1 (three controls)
| ID | Control | Test (deterministic) | Population | Pass rule |
|---|---|---|---|---|
| ITGC-AC-01 | Segregation of duties in the purchase-to-pay flow | Join user-role assignments to authorization objects; flag any active dialog user holding both sides of a SoD rule through currently valid role assignments (three rules in release 1: vendor maintain vs payment run, invoice post vs payment run, journal post vs approve). Locked users, expired or not-yet-valid assignments and firefighter ids are out of scope (firefighter usage is release 2). Also flag unlocked privileged dialog users with no login for 90 days. | All active dialog users | Zero conflicts, or each conflict has an approved, unexpired mitigating-control record |
| FIN-JE-01 | Manual journal entry review | From posted journal lines, select manual postings (not subledger-originated): flag entries posted by firefighter ids, entered after the posting period closed, round amounts (at least 100,000 and a multiple of 10,000), entered on a weekend or US federal holiday, or with no independent approver (none recorded, or the poster approved their own entry). | All manual postings in the period | Every flagged entry has a documented review; counts reconcile to ledger totals |
| ITGC-CM-01 | Change management to production | Join transport/release records to change tickets; flag production transports with no ticket or a ticket not approved, a ticket approved by the transport owner, approval dated after release, and emergency changes not reviewed within 5 calendar days of release. | All production transports in the period | Zero unapproved changes; emergency changes reviewed |

Why these three: they are the ones external auditors most often test for SAP, they use data that is the same shape in every client, and they need full-population logic where manual testing only samples.
Release 2 candidates (not in scope now): user access review completeness, firefighter-ID usage, vendor bank-detail changes, three-way-match overrides, interface/batch job monitoring.

## 5. Data model on the BTP trial (synthetic, SAP-shaped)
A real S/4HANA is not available to us (free tier is only the read-only api.sap.com sandbox, which holds no user, role or journal data). So we seed realistic synthetic tables, shaped like the SAP ones so the test code ports to a customer system through a destination:

| Our table | Mirrors | Used by |
|---|---|---|
| `Users` | USR02 (user master, last logon, lock) | AC-01 |
| `RoleAssignments`, `RoleAuthorizations` | AGR_USERS, AGR_1251 (role to authorization object/field values) | AC-01 |
| `SodRules`, `MitigatingControls` | SoD ruleset, approved mitigations | AC-01 |
| `JournalLines` | ACDOCA (S/4HANA universal journal), earlier BKPF/BSEG | JE-01 |
| `PostingPeriods` | T001B (open/closed periods) | JE-01 |
| `ChangeDocs` | CDHDR/CDPOS (change documents) | JE-01, CM-01 |
| `Transports`, `ChangeTickets` | E070/E071 and an ITSM export | CM-01 |

Data must be seeded with planted, countable exceptions (for example 4 SoD conflicts, 7 flagged journals, 2 unapproved transports) so each demo shows a known right answer. The seed script is part of the repo and is stated plainly in any demo: synthetic data, real logic.

## 6. Architecture (reuse first)
- **CAP service on HANA Cloud (BTP trial):** controls, test runner, audit chain. Fork of `sap-gov-sandbox` (audit.js, chain.js, sor.js, verify-export.js reused as is).
- **Ledger/system-of-record app:** reuse `sap-gov-ledger` pattern for the independent totals read.
- **Agent:** reuse `sap-gov-agent` pattern (destination lookup, tool calling). LLM options available now: Gemini on GCP credits (about 23k INR left, expires 2026-12-16, plus Google AI Pro credits); Bedrock Nova/DeepSeek on AWS credits (about 10k USD, expire 2028); Claude on Bedrock stays blocked by the AISPL payment-instrument issue. Pick Gemini first for the demo.
- **Evidence viewer:** static page on Contabo (Caddy), reads exported evidence packs; no live SAP access from the public site.
- **After the trial:** the same code deploys to a client's BTP subaccount against their S/4HANA via a destination. See `DEPLOY.md` in `sap-gov-sandbox` for the rebuild steps.

## 7. Plan (about 2 weeks, trial ends mid-January 2027)
Progress: days 1-5 done 2026-10-19 (schema, seed, SQL oracle, audit chain, ITGC-AC-01 service with cross-check, 5 test files). Next: days 6-7. See README.md.
| Days | Deliverable |
|---|---|
| 1-2 | Repo fork, schema, seed generator with planted exceptions, tests that assert the planted counts |
| 3-5 | ITGC-AC-01 test + SoD ruleset + mitigation handling; audit rows; reconciliation of counts |
| 6-7 | FIN-JE-01 and ITGC-CM-01 tests |
| 8-9 | Evidence pack export + offline verify, human sign-off action (separate scope), PDF narrative |
| 10-11 | Agent layer + chat UI; guardrails (cannot mark effective, cannot hide MISMATCH) |
| 12-13 | Deploy to BTP trial, live walk-through, export audit trail, commit/push |
| 14 | Demo video and post (per the demo-video and style-registry rules), DEPLOY update |

## 8. Success criteria
1. For the seeded data, each control returns exactly the planted exceptions, every run, from full population.
2. Tampering with any stored result or evidence row is caught by the offline verifier.
3. The agent, asked to "mark ITGC-AC-01 effective", refuses and explains who can.
4. A forced ledger mismatch shows up in the answer and the evidence pack.
5. The whole system can be rebuilt from the repos and `DEPLOY.md` in under a day.

## 9. Honest limits
- Synthetic data only; the logic is proven, our data is not a customer's. First real validation needs a client sandbox.
- The SoD ruleset is a small illustrative one, not a full commercial ruleset.
- Detecting tampering is not preventing it; the audit chain needs an external anchor for stronger guarantees.
- This is evidence tooling. It does not replace the control owner, management's assessment or the external auditor's judgment, and nothing here is legal or audit advice.
- Statements about SOX/PCAOB/COSO above are a working summary; before a customer-facing claim, check them against the current standards.

## 10. Open decisions for Yuvaraj
1. Confirm the three controls for release 1, or swap one.
2. Gemini first for the agent LLM (recommended) or Bedrock Nova.
3. New private repo `sap-sox-itgc-agent` on the YuvarajAravindan-AI-Agent account (this folder), forking code from `sap-gov-sandbox`.
