# Hand-off to the Claude cloud session: SOX/ITGC demo video + LinkedIn post (written 2026-10-19)

The desktop session is out of credits. Everything that needs the laptop, Contabo, BTP, AWS or Chrome has been done. What remains can be done from this repo alone.

## 0. What the cloud session can and cannot do
Earlier cloud sessions had NO access to the laptop, BAS, Contabo, AWS, GCP, BTP, Chrome tools or `cf`. Assume the same. You work from this private GitHub repo (`YuvarajAravindan-AI-Agent/sap-sox-itgc-agent`, folder `demo/`) or from a zip the user uploads (`~/Videos/sox-demo-bundle.zip` on the laptop). Do not ask for secrets and never print any. Do not try to reach the deployed apps.

## 1. The job
1. **Render the demo video** from `demo/` (storyboard `demo/content.py`, images `demo/screens/`, narration `demo/audio/*.wav`, durations `demo/audio/durations.json`) in the look below. Target 1920x1080, H.264 + AAC, about 5 to 6 minutes, and a LinkedIn copy of at most about 9.8 MB (check the current LinkedIn size limit; the last upload was 9.82 MB).
2. **Review and polish the LinkedIn post** `demo/linkedin-post.txt` (user posts it himself; no GitHub links; says the code is in a private repo).
3. Write a one-paragraph note of what you changed so the desktop session can register the style and finish the rest (section 6).

If the container has no ffmpeg or Pillow: say so, and instead produce a precise render spec; do not fake a video.

## 2. Non-negotiable rules from the user (his memory notes)
- **Order:** problem and workflow FIRST, then the live app, then infrastructure (servers, app setup, architecture, design). Real captures preferred over explainer visuals.
- **Self-intro only at the END** (scene `close`), never at the start.
- **A new look for every video.** This one is `audit-workpaper-tickmark-binder` (spec `demo/style-new_workpaper.json`): sage columnar-pad paper with a red margin line, right-edge binder index tabs WP-1..WP-11 as the progress indicator, DejaVu Serif headings + Liberation Mono figures, red-pencil tick-marks stamping onto numbers, binder page-flip transitions, margin-annotation captions with a reference code (WP-5), end card = preparer / reviewer sign-off block, voice Sadaltager. Do not mix in earlier looks (fiori blue/gold, horizon azure rail, ledger cream, etc.). The registry check already passed on Contabo ("clean"); adding the entry is a desktop step (section 6).
- Plain spoken text only for TTS (no style prefix). Captions can differ from spoken text (numbers spelled out for TTS), see the (caption, spoken) pairs in `content.py`.
- Don't oversell. Limits are stated in the video and the post; keep them. This is evidence tooling, not audit or legal advice.
- Stay in IT for regulated industries; this project is **USA only** by the user's choice. Do not add India or EU framing.
- The user's side tools are not to be mentioned. No GitHub links in the post.

## 3. What is in `demo/`
| File | What |
|---|---|
| `content.py` | 11 scenes, 41 (caption, spoken) sentences, `shots` per scene, `nav` = WP tab |
| `audio/<scene>.wav` + `durations.json` | Sadaltager narration, one file per scene (generated on Contabo through the vertex-gateway) |
| `screens/` | 31 images. Real browser captures of the LIVE chat running against SAP HANA (`chat_*.jpg`), BTP cockpit (`cockpit_*.jpg`, `hana_running.jpg`), earlier-phase captures (`p2_*`), renders of real terminal output (`*_terminal.png`), the signed evidence PDF page (`evidence_pdf_p1.png`), and workpaper-look diagrams/tables (title, workflow, phases, controls, planted vs found, guardrails, architecture, bugs, sign-off block) |
| `make_assets.py`, `terminals/*.txt`, `captures/` | Regenerates the PNGs from real output; `python3 demo/make_assets.py` |
| `linkedin-post.txt` | The post (about 480 words, covers phase 3 and a summary of phases 1-2) |
| `PHASES.md` | What was achieved in phases 1, 2 and 3 (use it for facts) |
| `style-new_workpaper.json` | The registry entry for this video |

Screens are 1236x618 browser captures (the laptop screen limits capture size). Show them inside a paper-framed panel at about 1.5x, zoom into the relevant rows with a slow push, and add red-pencil tick callouts on the numbers that match the planted values. Do not upscale-blur: crop to the interesting area and keep text sharp.

## 4. Facts the video states (all verified live on 2026-10-19; do not change numbers)
- Controls: ITGC-AC-01 57 users in population, 6 conflict pairs, 1 valid mitigation, 5 exception pairs (AP006, AP007, AP008 x2, GL004 expired mitigation), 2 dormant privileged users (AP011 170 days, MD003 131 days). FIN-JE-01 8 flagged of 150 manual documents (reasons: FIREFIGHTER_POSTER 2, AFTER_PERIOD_CLOSE 2, ROUND_AMOUNT 2, WEEKEND_OR_HOLIDAY 3, NO_INDEPENDENT_APPROVAL 2). ITGC-CM-01 7 exceptions of 40 production transports. All cross-checks MATCH.
- Signed pack: run seq 2 (ITGC-AC-01, EXCEPTIONS), 15 chain rows intact from genesis, signed by a named control owner, conclusion NOT_EFFECTIVE. Audit trail on HANA verified intact at 22 rows when the screens were taken.
- Chat answers: the prose can omit items (the change-management answer listed 5 of the 7 transports); the facts block under each answer is authoritative. Say so if you show it.
- Phase 1/2 facts are in `PHASES.md`.

## 5. Scene order (already encoded)
hook > problem > earlier phases (summary) > phase 3 > live AC-01 > live JE and CM > guardrails and refusal > sign-off + evidence + offline verify > infrastructure and architecture > what broke and was fixed + limits > next + self-intro end card. Keep it; shorten captions rather than narration if time is tight.

## 6. Left for the desktop session (do not attempt from the cloud)
1. Add the style to the registry: `ssh contabo-tally 'cd /opt/ai-digest/style_registry && python3 check_style.py new_workpaper.json --add'`, then mirror to `gdrive:ai-digest/style_registry` and `~/Projects/video-style-registry`.
2. Post to LinkedIn: the built-in browser cannot upload files; Claude in Chrome can via `file_upload` on the hidden input (video under about 10 MB). The user approves and clicks Post. Type text line by line (the pane drops trailing characters of multi-line chunks).
3. Export the SOX audit trail from HANA before the trial ends (~mid-Jan 2027): `exportAudit` with an auditor token (`python3 tools/get-user-token.py` needs a one-time passcode typed by the user). The sandbox trail is already saved.
4. Update memory notes for this project (`sox-itgc-agent-project`).

## 7. Where everything lives
- Repos (all private, account YuvarajAravindan-AI-Agent): `sap-sox-itgc-agent` (this), `sap-gov-sandbox` (phases 1-2 service + `DEPLOY.md` + saved audit export), `sap-gov-agent`, `sap-gov-ledger`, `sap-agents-video` and `sap-agents-video-part2` (earlier video renderers: PIL scene renderer + TTS + ffmpeg; reuse their ideas, not their look).
- BTP trial: org 06407a50trial / space dev, us10-001; apps `sap-sox-itgc-agent-srv`, `sox-itgc-agent` (chat), the three phase-1/2 apps (stopped); HANA `govsandbox` (free tier stops nightly); destinations GovStockService, GovLedgerService, SoxControlService. Trial ends about mid-January 2027.
- Model: Gemini `gemini-3.8-flash` through the Enterprises `vertex-gateway` (Cloud Run); the token is in `~/.config/vertex-gateway/token` on the laptop. The old key in `.bashrc` is dead.
- Secrets are never in repos. Never print `.env` or tokens.

## 8. Prompt to paste into the cloud session
> You are continuing a task for Yuvaraj. Read `HANDOFF-cloud-session-demo.md` and `demo/PHASES.md` in the private repo `YuvarajAravindan-AI-Agent/sap-sox-itgc-agent` (or in the uploaded zip). Render the demo video described there from `demo/content.py`, `demo/screens/` and `demo/audio/` in the `audit-workpaper-tickmark-binder` look, following every rule in section 2 and the facts in section 4. Deliver `sox-demo.mp4` (1920x1080) and a LinkedIn copy under about 9.8 MB, polish `demo/linkedin-post.txt` without changing numbers, and report what you changed. If ffmpeg or Pillow is missing, say so and give a render spec instead. Do not ask for secrets, and do not claim anything that is not in the hand-off files.
