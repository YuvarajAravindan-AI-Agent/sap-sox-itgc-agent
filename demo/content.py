"""Scenes for 'SOX controls on SAP: code tests every item, a human signs'. Each sentence: (on-screen caption, spoken text).
Order follows the demo-video rule: problem and workflow first, then live screens, then infrastructure and architecture, self-intro ONLY at the end.
`shots` name files in demo/screens/ (real captures or renders of real output). Nothing here is invented: every number appears in the live HANA runs of 2026-10-19."""
VOICE = "Sadaltager"
SCENES = [
 dict(id="hook", nav="WP-1", ref="WP-1", shots=["title_card"], sentences=[
  ("Every year, a US public company has to prove its SAP controls worked.",) * 2,
  ("An auditor tests a sample, often twenty five items. The rest are never looked at.",) * 2,
  ("This demo tests every item, with code. And the language model is not allowed to decide anything.",) * 2]),
 dict(id="problem", nav="WP-2", ref="WP-2", shots=["workflow_today_vs_governed"], sentences=[
  ("Section 404 of Sarbanes-Oxley: management must show that controls over financial reporting work.",
   "Section four oh four of Sarbanes Oxley: management must show that controls over financial reporting work."),
  ("For SAP, that means access, change management, and journal postings.",) * 2,
  ("Today it is extracts, spreadsheets, samples and screenshots, and a judgement made on a sample.",) * 2,
  ("The governed workflow: run the control over the whole population, cross-check it, keep an audit chain, and let a named person sign.",) * 2]),
 dict(id="earlier", nav="WP-3", ref="WP-3", shots=["phases_timeline", "p2_chat_mismatch", "p2_chain_verify"], sentences=[
  ("This is phase three. The first two phases built the foundation.",) * 2,
  ("Phase one: a Joule agent told us material forty-one was short by one point two. The data said otherwise.",
   "Phase one: a Joule agent told us material forty one was short by one point two. The data said otherwise."),
  ("So the arithmetic moved into a governed service on SAP HANA, and every call became an audit row.",) * 2,
  ("Phase two: a hash chain over the audit trail, an export anyone can verify offline, and a reconciliation against an independent ledger.",) * 2,
  ("When the ledger said nine point one and the service said eight point eight, the answer said mismatch out loud.",) * 2]),
 dict(id="phase3", nav="WP-4", ref="WP-4", shots=["controls_table", "planted_vs_found"], sentences=[
  ("Phase three applies the same discipline to SOX and IT general controls, for the United States.",) * 2,
  ("Three controls: segregation of duties and dormant privileged users, manual journal review, and change management to production.",) * 2,
  ("The data is synthetic but SAP-shaped, with exceptions planted on purpose, so every run has a known right answer.",) * 2]),
 dict(id="live_ac01", nav="WP-5", ref="WP-5", shots=["chat_01_controls", "chat_02_ac01_top", "chat_03_ac01_exceptions"], sentences=[
  ("Live, against SAP HANA on the BTP trial. The agent lists the controls.",) * 2,
  ("Then it runs segregation of duties. Fifty seven users in population, six conflicting pairs, five exceptions, two dormant privileged users.",) * 2,
  ("One conflict is covered by a valid mitigating control. One mitigation has expired, so that one is an exception.",) * 2,
  ("The facts block under the answer is built from the test run, not written by the model.",) * 2]),
 dict(id="live_je_cm", nav="WP-6", ref="WP-6", shots=["chat_04_je01", "chat_05_cm01"], sentences=[
  ("Manual journals: eight flagged out of one hundred fifty, for firefighter posters, entries after period close, round amounts, weekends, and missing approvers.",) * 2,
  ("Change management: seven exceptions out of forty production transports. No ticket, ticket not approved, self approved, or approved after release.",) * 2,
  ("These match the planted numbers exactly, on HANA, with every cross-check saying match.",) * 2]),
 dict(id="guardrails", nav="WP-7", ref="WP-7", shots=["guardrails_diagram", "chat_06_refusal"], sentences=[
  ("The model has two tools: list controls, and run a control. Nothing else.",) * 2,
  ("Ask it to mark a control effective, and it refuses before the model is even called.",) * 2,
  ("If the model's wording claims effectiveness, the code withholds that wording and shows the facts.",) * 2,
  ("If the cross-check disagrees or is unavailable, a clean run is reported as not conclusive, never as a pass.",) * 2]),
 dict(id="signoff", nav="WP-8", ref="WP-8", shots=["evidence_pdf_p1", "verify_pack_terminal", "audit_chain_terminal"], sentences=[
  ("Only a named control owner can sign. Separate scope, separate screen, an audited action.",) * 2,
  ("The signer cannot be the person the run was made for. An inconclusive run cannot be concluded effective.",) * 2,
  ("The evidence pack holds the chained audit rows, the result, the sign-off, and a narrative from a fixed template.",) * 2,
  ("Anyone can verify it offline, with no SAP system. Fifteen rows chained from genesis, signed by a named user.",) * 2]),
 dict(id="infra", nav="WP-9", ref="WP-9", shots=["architecture_diagram", "cockpit_instances", "cockpit_destinations", "cockpit_role_collections_list", "cockpit_role_collection_controlowner", "deploy_log_terminal", "cf_apps_terminal"], sentences=[
  ("The infrastructure: a CAP service and a chat app on Cloud Foundry, a second HDI container on the free tier SAP HANA Cloud, XSUAA for identity, and a destination between them.",) * 2,
  ("The language model is Gemini, reached through a gateway on Google Cloud, so it draws the enterprise cloud credits.",) * 2,
  ("Three role collections: agent, auditor, and control owner. The agent client never holds the sign-off scope.",) * 2,
  ("The deploy loaded the seed into HANA first time. Eight test files run against the code before it ships.",
   "The deploy loaded the seed into HANA first time. Eight test files run against the code before it ships.")]),
 dict(id="honest", nav="WP-10", ref="WP-10", shots=["bugs_found_table"], sentences=[
  ("Two things went wrong, and both were caught.",) * 2,
  ("On HANA, sign-off failed: a column was twelve characters wide and the word not effective is thirteen. SQLite does not enforce that. Now a test checks every stored value against its declared length.",) * 2,
  ("In the live chat, the guard withheld an honest disclaimer as if it were a claim. Now it judges each clause, and tests cover both directions.",) * 2,
  ("Limits: the data is synthetic, and the cross-check recomputes the logic over the same tables, so it catches logic errors, not a wrong extract.",) * 2]),
 dict(id="close", nav="WP-11", ref="WP-11", shots=["signoff_block_founder"], sentences=[
  ("Next: point it at a real S four HANA through a destination, grow the segregation of duties ruleset, and add more controls.",) * 2,
  ("I am Yuvaraj Aravindan. I build enterprise and AI applications for regulated industries, and this is what that looks like when the model is kept in its lane.",) * 2,
  ("Code and the demo are available on request.",) * 2]),
]
