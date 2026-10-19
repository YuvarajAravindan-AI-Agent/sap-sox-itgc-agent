#!/usr/bin/env python3
"""Builds demo/screens/*.png: renders of real output (terminals/*.txt, seed manifest, live HANA results) in the audit-workpaper look,
plus copies of the real browser captures. Re-run any time: python3 demo/make_assets.py  (needs Pillow and pdftoppm)."""
import glob, json, os, shutil, subprocess, textwrap
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, 'screens'); os.makedirs(OUT, exist_ok=True)
SERIF = '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'; SERIFB = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'; MONO = '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf'; MONOB = '/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf'
F = lambda p, s: ImageFont.truetype(p, s)
PAPER, GRID, MARGIN, INK, PENCIL, GREEN, AMBER = (233, 241, 229), (205, 222, 200), (200, 80, 80), (36, 52, 44), (196, 48, 48), (46, 125, 80), (176, 120, 20)
W, H = 1920, 1080

def paper(ref='', tab=None):
    im = Image.new('RGB', (W, H), PAPER); d = ImageDraw.Draw(im)
    for x in range(120, W, 60): d.line([(x, 0), (x, H)], fill=GRID, width=1)
    for y in range(40, H, 54): d.line([(0, y), (W, y)], fill=GRID, width=1)
    d.line([(110, 0), (110, H)], fill=MARGIN, width=3)
    for i in range(1, 12):                                       # binder index tabs on the right edge
        y = 40 + (i - 1) * 90; on = (tab == i)
        d.rectangle([W - (46 if on else 30), y, W, y + 74], fill=(255, 255, 255) if on else (214, 228, 210), outline=GRID)
        d.text((W - 24, y + 22), f'{i}', font=F(MONOB, 22), fill=INK if on else (120, 140, 125), anchor='mt')
    if ref: d.text((W - 90, H - 40), ref, font=F(MONO, 24), fill=(110, 130, 115), anchor='rs')
    return im, d

def wrap(d, text, font, width):
    out = []
    for para in text.split('\n'):
        words, line = para.split(' '), ''
        for w in words:
            t = (line + ' ' + w).strip()
            if d.textlength(t, font=font) <= width: line = t
            else: out.append(line); line = w
        out.append(line)
    return out

def box(d, xy, title, body='', fill=(255, 255, 255), edge=INK, tcol=INK, bsize=24):
    x0, y0, x1, y1 = xy; d.rounded_rectangle(xy, 10, fill=fill, outline=edge, width=3)
    d.text((x0 + 18, y0 + 14), title, font=F(SERIFB, 28), fill=tcol)
    y = y0 + 58
    for ln in wrap(d, body, F(SERIF, bsize), x1 - x0 - 36): d.text((x0 + 18, y), ln, font=F(SERIF, bsize), fill=INK); y += bsize + 8

def arrow(d, a, b, col=INK):
    d.line([a, b], fill=col, width=4); dx, dy = b[0] - a[0], b[1] - a[1]; n = (dx * dx + dy * dy) ** .5 or 1; ux, uy = dx / n, dy / n
    d.polygon([b, (b[0] - 18 * ux + 9 * uy, b[1] - 18 * uy - 9 * ux), (b[0] - 18 * ux - 9 * uy, b[1] - 18 * uy + 9 * ux)], fill=col)

def tick(d, x, y, col=PENCIL):           # red-pencil tick-mark
    d.line([(x, y), (x + 14, y + 20), (x + 44, y - 26)], fill=col, width=6)

def title(d, text, sub=''):
    d.text((150, 70), text, font=F(SERIFB, 54), fill=INK)
    if sub: d.text((150, 142), sub, font=F(SERIF, 28), fill=(80, 100, 88))

def save(im, name): im.save(os.path.join(OUT, name + '.png')); print('wrote', name)

def terminal(name, text_file, size=26, max_w=1700):
    lines = open(os.path.join(HERE, 'terminals', text_file)).read().rstrip('\n').split('\n')
    f = F(MONO, size); tmp = ImageDraw.Draw(Image.new('RGB', (10, 10)))
    rows = []
    for ln in lines: rows += wrap(tmp, ln, f, max_w) if ln.strip() else ['']
    h = 80 + len(rows) * (size + 8) + 40; im = Image.new('RGB', (1840, max(h, 300)), (22, 28, 25)); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 1840, 44], fill=(40, 52, 46)); [d.ellipse([18 + i * 30, 14, 34 + i * 30, 30], fill=c) for i, c in enumerate([(220, 90, 80), (230, 190, 80), (90, 190, 100)])]
    y = 70
    for r in rows:
        col = (150, 230, 170) if r.startswith('$') else (236, 120, 110) if ('FAILED' in r or 'MISMATCH' in r) else (225, 236, 228)
        d.text((30, y), r, font=f, fill=col); y += size + 8
    save(im, name)

# ---- diagrams and tables in the workpaper look ----
im, d = paper('WP-0', 1); d.text((150, 330), 'SOX controls on SAP', font=F(SERIFB, 110), fill=INK); d.text((150, 470), 'Code tests every item. A named human signs.', font=F(SERIF, 54), fill=(60, 84, 70))
d.text((150, 580), 'ITGC and financial-close controls  |  United States  |  SAP BTP + HANA + Gemini', font=F(MONO, 30), fill=(90, 110, 96))
for i, (t, c) in enumerate([('ticked', PENCIL), ('tied to ledger', PENCIL), ('exception', AMBER)]): tick(d, 160 + i * 330, 720, c); d.text((220 + i * 330, 712), t, font=F(MONO, 28), fill=INK)
save(im, 'title_card')

im, d = paper('WP-2', 2); title(d, 'The same control, two ways', 'Section 404 testing of SAP access, change and journals')
box(d, (150, 220, 930, 900), 'Today', '1. Pull extracts from SAP\n2. Draw a sample (about 25)\n3. Test the sample in a spreadsheet\n4. Screenshot evidence\n5. Conclude on the sample\n\nThe rest of the population is never tested.', edge=(150, 150, 150))
box(d, (990, 220, 1770, 900), 'Governed', '1. Run the control over the FULL population, in code\n2. Cross-check with a second computation\n3. Every run is a hash-chained audit row\n4. Evidence pack, verifiable offline\n5. A NAMED human concludes, in a separate audited action\n\nThe model explains. It never decides.', edge=GREEN, tcol=GREEN)
arrow(d, (935, 560), (985, 560), GREEN); save(im, 'workflow_today_vs_governed')

im, d = paper('WP-3', 3); title(d, 'Three phases, one discipline', 'Deterministic code does the work; every answer is traceable; disagreement is said out loud')
for i, (ph, dt, head, body) in enumerate([
  ('Phase 1', '16-17 Oct 2026', 'Governed stock validation', 'Joule said material 41 was short by 1.2. The data said 1.7 required, 500 available. Arithmetic moved into a CAP service on SAP HANA; every call is an audit row.'),
  ('Phase 2', '17-18 Oct 2026', 'Tamper-evident and reconciled', 'Hash-chained audit trail, offline-verifiable export, an independent ledger app through a BTP destination. Live mismatch: 8.8 vs 9.1 shown, not hidden.'),
  ('Phase 3', '19 Oct 2026', 'SOX 404 / ITGC agent (US)', 'Three controls over full populations, cross-checks, named-human sign-off, evidence packs, a Gemini agent that cannot conclude. Deployed on HANA.')]):
    x = 150 + i * 540; box(d, (x, 230, x + 510, 880), f'{ph}  ({dt})', head + '\n\n' + body, edge=GREEN if i == 2 else INK, tcol=GREEN if i == 2 else INK, bsize=23)
save(im, 'phases_timeline')

im, d = paper('WP-4', 4); title(d, 'Release 1 control catalogue', 'US public-company ITGC and close controls, tested in code')
rows = [('ITGC-AC-01', 'Segregation of duties (P2P, GL) and dormant privileged users', 'No SoD conflict without a valid mitigating control; no unlocked privileged user idle 90+ days'),
        ('FIN-JE-01', 'Manual journal entry review', 'Flags: firefighter poster, after period close, round amount, weekend or US holiday, no independent approver'),
        ('ITGC-CM-01', 'Change management to production', 'Approved ticket before release, not self-approved; emergency changes reviewed within 5 days')]
y = 230
for cid, name, rule in rows:
    d.rounded_rectangle([150, y, 1770, y + 220], 10, fill=(255, 255, 255), outline=INK, width=3); d.text((180, y + 20), cid, font=F(MONOB, 38), fill=PENCIL)
    d.text((180, y + 78), name, font=F(SERIFB, 30), fill=INK)
    for k, ln in enumerate(wrap(d, rule, F(SERIF, 26), 1500)): d.text((180, y + 130 + k * 34), ln, font=F(SERIF, 26), fill=(70, 90, 78))
    y += 250
save(im, 'controls_table')

M = json.load(open(os.path.join(HERE, '..', 'seed', 'manifest.json')))
im, d = paper('WP-4.1', 4); title(d, 'Planted versus found, on SAP HANA', 'Synthetic data; every exception was planted on purpose and counted before the run')
hdr = ['Control', 'Planted', 'Found (live HANA run)', 'Cross-check']; xs = [160, 560, 1000, 1500]
for x, h in zip(xs, hdr): d.text((x, 230), h, font=F(SERIFB, 30), fill=INK)
d.line([(150, 280), (1770, 280)], fill=INK, width=3)
data = [('ITGC-AC-01  SoD exception pairs', str(M['ITGC-AC-01']['sodExceptionPairs']), '5 of 6 conflict pairs'), ('ITGC-AC-01  dormant privileged', str(len(M['ITGC-AC-01']['dormantPrivilegedUsers'])), '2 users'),
        ('FIN-JE-01  flagged journals', str(M['FIN-JE-01']['flaggedDocuments']), '8 of 150 manual documents'), ('ITGC-CM-01  production exceptions', str(M['ITGC-CM-01']['exceptions']), '7 of 40 transports')]
for i, (a, b, c) in enumerate(data):
    y = 310 + i * 120; d.text((xs[0], y), a, font=F(SERIF, 28), fill=INK); d.text((xs[1] + 40, y), b, font=F(MONOB, 40), fill=INK); d.text((xs[2], y), c, font=F(MONO, 30), fill=INK); tick(d, xs[2] - 60, y + 20); d.text((xs[3], y), 'MATCH', font=F(MONOB, 32), fill=GREEN)
d.text((160, 850), 'Decoys that must NOT be flagged (locked user, expired role, closing-day entry, in-time emergency change) stayed clean.', font=F(SERIF, 26), fill=(80, 100, 88))
save(im, 'planted_vs_found')

im, d = paper('WP-7', 7); title(d, 'Where the model is held in place', 'Guardrails are code around the model, not instructions to it')
steps = [('1  Request', 'Sign off, certify, conclude?\nRefused BEFORE the model is called.'), ('2  Model', 'Two tools only:\nlist_controls, run_control.\nNo path to sign-off or export.'), ('3  Tool result', 'Deterministic code, full\npopulation, cross-check,\nhash-chained audit row.'), ('4  Guard', 'Withholds claims of\neffectiveness. Flags figures\nnot in the result. Banners for\nMISMATCH / NOT_CONCLUSIVE.'), ('5  Answer', 'Model wording\n+ FACTS block built from the\nresult (not from the model).')]
for i, (t, b) in enumerate(steps):
    x = 150 + i * 330; box(d, (x, 300, x + 300, 760), t, b, edge=GREEN if i in (2, 3) else INK, bsize=22)
    if i < 4: arrow(d, (x + 302, 530), (x + 328, 530))
d.text((150, 840), 'Only a named control owner, with a separate scope, can sign off. The agent client never holds it.', font=F(SERIF, 30), fill=PENCIL)
save(im, 'guardrails_diagram')

im, d = paper('WP-9', 9); title(d, 'Architecture on the SAP BTP trial', 'Cloud Foundry, SAP HANA Cloud (second HDI container), XSUAA, Destination service')
box(d, (150, 240, 520, 420), 'Chat UI', 'Browser, basic-auth gate', bsize=22); box(d, (640, 240, 1090, 420), 'sox-itgc-agent', 'Cloud Foundry app. Guardrails. Two tools.', bsize=22)
box(d, (1210, 240, 1770, 420), 'Gemini', 'gemini-3.8-flash via vertex-gateway (Cloud Run); Enterprises GCP credits', bsize=22)
box(d, (640, 520, 1090, 700), 'Destination', 'SoxControlService, OAuth2 client credentials (agent scope only)', bsize=22)
box(d, (150, 780, 700, 980), 'sap-sox-itgc-agent-srv', 'CAP service. 3 controls + cross-checks, sign-off, evidence export, audit chain', bsize=22)
box(d, (780, 780, 1260, 980), 'SAP HANA Cloud', 'HDI container; seed, AuditLog, Signoffs', bsize=22); box(d, (1340, 780, 1770, 980), 'XSUAA', 'Scopes: agent, controlOwner, auditor', bsize=22)
arrow(d, (520, 330), (638, 330)); arrow(d, (1090, 330), (1208, 330)); arrow(d, (865, 422), (865, 518)); arrow(d, (800, 702), (500, 778)); arrow(d, (700, 880), (778, 880)); arrow(d, (1340, 880), (1262, 880))
save(im, 'architecture_diagram')

im, d = paper('WP-10', 10); title(d, 'What broke, and how it was caught', 'Both found on 19 Oct 2026 while running the real system')
box(d, (150, 230, 930, 780), 'HANA enforces lengths', 'The column for the conclusion was 12 characters; NOT_EFFECTIVE is 13. SQLite never complained, HANA returned a 500 at sign-off.\n\nFix: column widened. New test checks every stored value against the length the model declares; it fails on the old schema.', edge=PENCIL, tcol=PENCIL, bsize=23)
box(d, (990, 230, 1770, 780), 'A guard that blocked honest text', 'The model wrote: "does not determine whether the control is effective". The filter read it as a claim and withheld the answer.\n\nFix: each clause is judged; explicit disclaimers pass, plain conclusions ("is not effective") still do not. Tests cover both.', edge=PENCIL, tcol=PENCIL, bsize=23)
d.text((150, 840), 'Limits stated up front: synthetic data; the cross-check recomputes the logic over the same tables (not an independent source).', font=F(SERIF, 26), fill=(80, 100, 88))
save(im, 'bugs_found_table')

im, d = paper('WP-11', 11); d.text((150, 120), 'Prepared and reviewed', font=F(SERIFB, 54), fill=INK)
d.rounded_rectangle([150, 260, 1770, 760], 12, fill=(255, 255, 255), outline=INK, width=4)
d.text((200, 300), 'Prepared by', font=F(MONO, 28), fill=(100, 120, 106)); d.text((200, 345), 'Yuvaraj Aravindan', font=F(SERIFB, 62), fill=INK)
d.text((200, 440), 'Enterprise and AI applications for regulated industries', font=F(SERIF, 34), fill=(60, 84, 70)); d.text((200, 500), 'ai-agentic-enterprises.com', font=F(MONO, 34), fill=PENCIL)
d.line([(200, 640), (900, 640)], fill=INK, width=2); d.text((200, 655), 'Reviewed by: a named control owner (never the agent)', font=F(MONO, 24), fill=(100, 120, 106)); tick(d, 1500, 330)
d.text((1250, 420), 'chain: intact from genesis', font=F(MONO, 26), fill=GREEN)
save(im, 'signoff_block_founder')

# ---- renders of real terminal output ----
for name, f in [('cf_apps_terminal', 'cf_apps.txt'), ('deploy_log_terminal', 'deploy_log.txt'), ('verify_pack_terminal', 'verify_pack.txt'), ('audit_chain_terminal', 'audit_chain.txt'), ('npm_test_terminal', 'npm_test.txt')]: terminal(name, f)

# ---- the signed evidence pack as a PDF page ----
pdf = os.path.join(HERE, '..', 'evidence', 'hana-evidence-run2-signed.pdf')
if os.path.exists(pdf): subprocess.run(['pdftoppm', '-r', '130', '-png', '-f', '1', '-l', '1', pdf, os.path.join(OUT, 'evidence_pdf_p1')]); [os.rename(p, os.path.join(OUT, 'evidence_pdf_p1.png')) for p in glob.glob(os.path.join(OUT, 'evidence_pdf_p1-*.png'))]

# ---- copies of the real captures (browser) ----
SRC = os.path.join(HERE, 'captures'); [shutil.copy(p, os.path.join(OUT, os.path.basename(p))) for p in glob.glob(os.path.join(SRC, '*')) if os.path.isfile(p)]
print('done:', len(os.listdir(OUT)), 'files in', OUT)
