# DEPLOY.md: BTP trial (Cloud Foundry), same subaccount as sap-gov-sandbox

Target: org `06407a50trial`, space `dev`, region us10-001. Reuses the free-tier HANA instance `govsandbox` (a second HDI container) and the Destination service instance `gov-dest-admin`. Trial ends about mid-January 2027: export the audit trail first (see `sap-gov-sandbox/DEPLOY.md`).

Secrets are never put in a file or a command history: the user types the SSO passcode and the three `cf set-env` values.

## 1. Start HANA
HANA Cloud Central, instance `govsandbox`, Start (the free tier stops nightly).

## 2. Get the code into BAS
Private repo, so either upload `sox-deploy-bundle.tgz` through the BAS Explorer (right click, Upload) and `tar xzf` it into `~/projects/sap-sox-itgc-agent`, or `git clone` with your own token. Check the SHA-256 against the one printed when the bundle was made.

## 3. Build and deploy the service
    cf login -a https://api.cf.us10-001.hana.ondemand.com --sso    # you paste the passcode
    cd ~/projects/sap-sox-itgc-agent
    npm ci && npx mbt build
    cf deploy mta_archives/sap-sox-itgc-agent_0.1.0.mtar -f

`cf deploy` exits 0 even when a module fails: confirm with `cf apps` that `sap-sox-itgc-agent-srv` is `started` and read `cf logs sap-sox-itgc-agent-srv --recent` for HDI deploy errors (the db-deployer app logs the table and CSV load). First suspects, since only SQLite was tested: empty date cells in the seed CSVs, boolean CSV values, reserved words.

## 4. Role collection
Cockpit, Security, Role Collections: create `SoxAuditor` (role `Auditor`) and `SoxControlOwner` (role `ControlOwner`) from the xs-security roles and assign yourself. The agent client gets only `agent` (it is the app's `authorities`).

## 5. Destination for the chat agent (secrets stay inside the platform)
    cf run-task sap-sox-itgc-agent-srv --name destsetup --command "node -e \"require('./srv/setup-destination').run('https://<srv-host>/controls')\""
    cf logs sap-sox-itgc-agent-srv --recent | grep DESTSETUP

`<srv-host>` is the route shown by `cf app sap-sox-itgc-agent-srv`.

## 6. Chat agent
    cd agent && cf push
    cf set-env sox-itgc-agent LLM_API_KEY <vertex-gateway token>      # you type it
    cf set-env sox-itgc-agent ACCESS_USER <chat login user>           # you choose
    cf set-env sox-itgc-agent ACCESS_PASSWORD <chat login password>   # you choose
    cf restart sox-itgc-agent

Model: Gemini `gemini-3.8-flash` through the Enterprises `vertex-gateway` (OpenAI-compatible route). The first call after idle can take over a minute.

## 7. Verify (on HANA, not SQLite)
1. Run the three controls (chat, or `GET /controls/runControl(controlId='ITGC-AC-01',referenceDate='2026-10-19')` with an agent token). Expect: AC-01 5 exception pairs and 2 dormant; JE-01 8 flagged of 150; CM-01 7 of 40; reconciliation MATCH for each.
2. `verifyAuditChain()` returns `ok: true`.
3. Sign off one run as a control owner, export its evidence pack, and verify it on the laptop: `node tools/verify-pack.js pack.jsonl`.
4. Ask the chat agent to "mark ITGC-AC-01 as effective": it must refuse.
