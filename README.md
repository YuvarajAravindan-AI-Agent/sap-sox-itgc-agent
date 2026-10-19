# sap-sox-itgc-agent

SOX 404 / ITGC evidence agent for SAP, USA only. Scope and plan: [SCOPE.md](SCOPE.md). Reuses the audit chain from `sap-gov-sandbox`.

## State (2026-10-19): days 1-9 of 14
- `db/schema.cds`: SAP-shaped tables (USR02, AGR_USERS, AGR_1251, T001B, ACDOCA, E070 and others) plus the hash-chained `AuditLog`.
- `seed/generate.js`: deterministic synthetic data with planted exceptions and named decoys. Writes `db/data/sox-*.csv` and `seed/manifest.json`.
- `test/seed.test.js`: regenerates and compares byte for byte, then recomputes every planted number with an independent SQL oracle and compares to the manifest.
- `srv/controls/ac01.js`: ITGC-AC-01 (SoD in P2P and GL, dormant privileged users) as a pure function of the data; `ac01-crosscheck.js` recomputes the headline numbers a second way (capability-indexed) and flags MATCH / MISMATCH / UNAVAILABLE. It checks the logic, not the extract: both read the same tables. A clean run with a disagreeing or unavailable cross-check reports NOT_CONCLUSIVE, never PASS.
- `srv/control-service.*`: `/controls` service: `listControls`, `runControl(controlId, referenceDate)` (scope `agent`), `verifyAuditChain`, `exportAudit`, `AuditLog` (scope `auditor`). Every call is audited, including failures (ERROR) and 401/403 (`server.js`). The answer is a result and exceptions, never an effectiveness assessment.
- `test/ac01.test.js`, `test/ac01-service.test.js`, `test/e2e.test.js`: planted numbers, date boundaries (role start/end, mitigation expiry, 90 vs 91 days idle), cross-check, audit rows, real-server auth paths.
- `test/chain.test.js`: audit chain, tamper and deletion detection, offline export verification (`tools/verify-export.js`).

## Planted numbers (Q3 2026, reference date 2026-10-19)
| Control | Population | Must find |
|---|---|---|
| ITGC-AC-01 | 6 SoD conflict pairs across 5 users | 5 exception pairs (1 valid mitigation, 1 expired); 2 dormant privileged users |
| FIN-JE-01 | 150 manual journals (of 400 documents) | 8 flagged documents, 11 reasons |
| ITGC-CM-01 | 40 production transports | 7 exceptions |

Data is synthetic. The logic is what is being proven; it is not a customer's data.

## Run
    nvm use 22               # Node 24 aborts better-sqlite3 intermittently
    npm install
    npm start                # cds-serve, mocked users agent/agent and auditor/auditor (development only)
    npm run seed             # regenerate (output is committed)
    npm test

All three release-1 controls run (`srv/controls/je01*.js`, `cm01*.js`, shared `compare.js`, `dates.js` with US federal holiday calendar). Period controls default to the last completed calendar quarter before the reference date; `periodStart`/`periodEnd` override.

**Sign-off and evidence (days 8-9).** `signOffControl(runSeq, conclusion, exceptionsReviewed, comment)` needs scope `controlOwner`, which the agent client never has. The signer is the authenticated user. Rules: one sign-off per run; an inconclusive run (cross-check disagreed or unavailable) cannot be concluded EFFECTIVE; a run with exceptions can be concluded EFFECTIVE only with `exceptionsReviewed` and a comment of 20+ characters; the signer cannot be the `x-end-user` the run was made for (that header is asserted by the caller, so independence is only as strong as the caller's honesty until real identity propagation). `exportEvidence(runSeq)` (auditor) returns a JSON Lines pack: chained audit rows from genesis, the result, the sign-off, and a deterministic narrative (a fixed template, never LLM text). `node tools/verify-pack.js pack.jsonl` verifies it offline; `node tools/make-pdf.js pack.jsonl out.pdf` renders a PDF. Tests tamper with eight parts of a pack and each must fail.

Not yet run on HANA (only SQLite).
