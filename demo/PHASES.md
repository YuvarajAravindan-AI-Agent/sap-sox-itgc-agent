# What we achieved, phase by phase (SAP governed agents, 16-19 Oct 2026)

All on a personal SAP BTP trial (org 06407a50trial, space dev, us10) plus a Gemini model through the Enterprises vertex-gateway. Synthetic data throughout; no customer or enterprise data.

## Phase 1: governed stock validation (16-17 Oct)
- **Problem.** A Joule Studio agent (standard SAP learning-journey build: one destination variable, one skill per service operation, five tools on one agent) said material 41 was short by 1.2, although the data said 1.7 required and 500 available. The model had done the arithmetic.
- **Built.** `sap-gov-sandbox`: a CAP service on SAP HANA Cloud (free tier) with the five lookups plus `validateOrderStock`, arithmetic in code (order 1000001: material 41 SUFFICIENT; material 42 10 required vs 8.8 available = SHORT by 1.2). XSUAA scopes `agent` and `auditor`. Every call (OK, ERROR, DENIED incl. 401/403) is a row in `gov.AuditLog` with a correlation id. A chat agent on Cloud Foundry reaches it through a BTP destination.
- **Shipped.** Demo video part 1; LinkedIn post published 2026-10-17.

## Phase 2: tamper-evident, reconciled, honest about disagreement (17-18 Oct)
- **Audit v2.** Hash-chained rows (seq, prevHash, hash), data version (SHA-256 of the rows read), rule version, end user. `verifyAuditChain()` finds the first edited or missing row.
- **Audit v2.1.** `exportAudit` as JSON Lines plus `tools/verify-export.js` (offline, no SAP system). Reconciliation of each answer against a system of record: MATCH / MISMATCH / UNAVAILABLE.
- **Audit v2.2.** The system of record became an independent Cloud Foundry app (`sap-gov-ledger`, own data, own token check) reached only through the destination `GovLedgerService`. Pre-chain rows were sealed behind one baseline attestation row (21 legacy rows). Live mismatch demo: ledger changed so material 42 read 9.1 vs 8.8; the agent said MISMATCH and showed both numbers; restored afterwards.
- **Shipped.** Part 2 video (5:05, style horizon-left-rail-azure-teal); post published 2026-10-18.
- **Preserved.** Audit export of the sandbox trail saved at `sap-gov-sandbox/evidence/audit-export-20261019.jsonl` (11 chained rows, verified offline). Repos pushed (private) with `DEPLOY.md`.

## Phase 3: SOX 404 / ITGC evidence agent, United States (19 Oct)
- **Repo.** `sap-sox-itgc-agent` (private). Scope in `SCOPE.md`, state in `README.md`.
- **Data.** Synthetic, SAP-shaped (USR02, AGR_USERS, AGR_1251, T001B, ACDOCA, E070-like), deterministic seed with planted exceptions and named decoys; `seed/manifest.json` lists every planted number.
- **Controls (all full-population, in code).** ITGC-AC-01 segregation of duties + dormant privileged users; FIN-JE-01 manual journals (firefighter poster, after period close, round amount, weekend/US federal holiday, no independent approver); ITGC-CM-01 production changes (no ticket, ticket not approved, self-approved, approved after release, emergency change not reviewed in 5 days).
- **Cross-check.** Each control is recomputed a second way. Disagree or unavailable means NOT_CONCLUSIVE, never PASS.
- **Service.** `/controls` CAP service on HANA: `listControls`, `runControl`, `signOffControl` (scope controlOwner), `exportEvidence`, `verifyAuditChain`, `exportAudit`. Every call audited, including failures and 401/403.
- **Sign-off and evidence.** Named human only; one per run; inconclusive runs cannot be concluded effective; run exceptions need a documented review; signer cannot be the person the run was made for. Evidence pack = chained audit rows + result + sign-off + deterministic narrative; `tools/verify-pack.js` checks it offline; `tools/make-pdf.js` renders a PDF.
- **Agent.** Gemini (`gemini-3.8-flash`) via vertex-gateway. Two tools. Guardrails in code: refuse sign-off requests before the model, withhold effectiveness claims, banners for MISMATCH/NOT_CONCLUSIVE, flag figures not in the result, facts block built from the tool output.
- **Deployed on HANA (19 Oct).** Controls returned the planted numbers (5 exception pairs / 2 dormant; 8 of 150; 7 of 40), all cross-checks MATCH. First signed pack produced on HANA and verified offline (`evidence/hana-evidence-run2-signed.*`). Live chat: https://sox-itgc-agent.cfapps.us10-001.hana.ondemand.com (login set by the owner).
- **Found and fixed on 19 Oct.** HANA-only: `Signoffs.conclusion` String(12) vs 13-character NOT_EFFECTIVE (new test checks stored values against declared lengths). Guard false positive on an honest disclaimer (clause-level check, tests both ways).
- **Honest limits.** Synthetic data; the cross-check reads the same tables (logic check, not an independent source); SoD ruleset is small and illustrative; the `x-end-user` independence check depends on the caller's header until identity is propagated; evidence tooling, not audit or legal advice.
