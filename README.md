# sap-sox-itgc-agent

SOX 404 / ITGC evidence agent for SAP, USA only. Scope and plan: [SCOPE.md](SCOPE.md). Reuses the audit chain from `sap-gov-sandbox`.

## State (2026-10-19): days 1-5 of 14
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

Not yet run on HANA (only SQLite). FIN-JE-01 and ITGC-CM-01 are in the library but return 501 until days 6-7.
