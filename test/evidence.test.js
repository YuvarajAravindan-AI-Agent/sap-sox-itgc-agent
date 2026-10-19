// Human sign-off rules and the evidence pack: what can be concluded, by whom, and that the pack verifies offline and fails when touched.
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { boot } = require('./helpers')
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'manifest.json'), 'utf8'))
const REF = manifest.parameters.referenceDate
const TOOLS = path.join(__dirname, '..', 'tools')

;(async () => {
  const cds = await boot()
  const srv = await cds.serve('ControlService').from(cds.model, { at: '/controls' })
  const as = (id, roles) => new cds.User({ id, roles })
  const send = (user, event, data, headers = {}) => srv.tx({ user, headers }, tx => tx.send({ event, data }))
  const agent = as('agent', ['agent']), owner1 = as('owner1', ['controlOwner']), owner2 = as('owner2', ['controlOwner'])
  const run = async (controlId, headers = {}) => { await send(agent, 'runControl', { controlId, referenceDate: REF }, headers); return (await cds.run(SELECT.one.from('sox.AuditLog').where({ tool: 'runControl', outcome: 'OK' }).orderBy('seq desc'))).seq }
  const reject = async (p, status, label) => { try { await p; assert.fail(label + ': should have been rejected') } catch (e) { assert.strictEqual(Number(e.statusCode || e.code), status, `${label}: ${e.message}`) } }
  const sign = (user, d) => send(user, 'signOffControl', d)

  // ---- sign-off rules ----
  const ac = await run('ITGC-AC-01', { 'x-end-user': 'analyst1' })
  await reject(sign(owner1, { runSeq: ac, conclusion: 'MAYBE' }), 400, 'bad conclusion')
  await reject(sign(owner1, { runSeq: 99999, conclusion: 'NOT_EFFECTIVE' }), 404, 'missing run')
  const listRow = await send(agent, 'listControls', {}).then(() => cds.run(SELECT.one.from('sox.AuditLog').where({ tool: 'listControls' })))
  await reject(sign(owner1, { runSeq: listRow.seq, conclusion: 'NOT_EFFECTIVE' }), 422, 'not a run row')
  await reject(sign(owner1, { runSeq: ac, conclusion: 'EFFECTIVE' }), 422, 'effective with exceptions, no review')
  await reject(sign(owner1, { runSeq: ac, conclusion: 'EFFECTIVE', exceptionsReviewed: true, comment: 'ok' }), 422, 'effective with exceptions, thin comment')
  await reject(sign(as('analyst1', ['controlOwner']), { runSeq: ac, conclusion: 'NOT_EFFECTIVE' }), 409, 'signer is the person the run was made for')
  console.log('sign-off rules: bad input, missing/non-run rows, effective-with-exceptions and independence rejected')

  // The pack for an unsigned run verifies and says so.
  const write = (name, text) => { const f = path.join(os.tmpdir(), `evid-${process.pid}-${name}`); fs.writeFileSync(f, text); return f }
  const verify = f => spawnSync(process.execPath, [path.join(TOOLS, 'verify-pack.js'), f], { encoding: 'utf8' })
  let pack = await send(as('aud', ['auditor']), 'exportEvidence', { runSeq: ac })
  let res = verify(write('unsigned.jsonl', pack)); assert.strictEqual(res.status, 0, res.stdout); assert.match(res.stdout, /no sign-off/)

  // Conclude (NOT_EFFECTIVE is always allowed) and export again.
  const rec = JSON.parse(await sign(owner1, { runSeq: ac, conclusion: 'NOT_EFFECTIVE', exceptionsReviewed: true, comment: 'Five SoD exceptions open; remediation ticket raised.' }))
  assert.strictEqual(rec.signedBy, 'owner1'); assert.strictEqual(rec.runSeq, ac); assert.match(rec.runHash, /^[0-9a-f]{64}$/)
  await reject(sign(owner2, { runSeq: ac, conclusion: 'NOT_EFFECTIVE' }), 409, 'second sign-off on the same run')
  const stored = await cds.run(SELECT.one.from('sox.Signoffs').where({ runSeq: ac })); assert.strictEqual(stored.auditSeq, rec.auditSeq)
  pack = await send(as('aud', ['auditor']), 'exportEvidence', { runSeq: ac })
  const file = write('signed.jsonl', pack)
  res = verify(file); assert.strictEqual(res.status, 0, res.stdout); assert.match(res.stdout, /signed off by owner1: NOT_EFFECTIVE/)
  console.log('signed pack verifies:', res.stdout.trim())

  // The same text twice (determinism of the narrative) and PDF rendering.
  const narr = l => JSON.parse(l.split('\n').find(x => x.includes('"type":"narrative"'))).text
  assert.strictEqual(narr(pack), narr(await send(as('aud', ['auditor']), 'exportEvidence', { runSeq: ac })))
  const pdf = path.join(os.tmpdir(), `evid-${process.pid}.pdf`)
  assert.strictEqual(spawnSync(process.execPath, [path.join(TOOLS, 'make-pdf.js'), file, pdf]).status, 0)
  await new Promise(r => setTimeout(r, 300))
  const txt = spawnSync('pdftotext', [pdf, '-'], { encoding: 'utf8' }).stdout
  if (txt) { assert.match(txt, /ITGC-AC-01/); assert.match(txt, /AP006 breaks SOD-P2P-01/); assert.match(txt, /owner1 concluded NOT_EFFECTIVE/) }
  assert.ok(fs.readFileSync(pdf).subarray(0, 4).toString() === '%PDF')
  console.log('narrative deterministic; PDF rendered' + (txt ? ' and its text checked' : ''))

  // ---- tampering: every change to the pack must make verification fail ----
  const L = pack.split('\n').filter(Boolean).map(x => JSON.parse(x))
  const fails = (name, mutate, expect) => { const c = JSON.parse(JSON.stringify(L)); mutate(c); const r = verify(write(name, c.map(x => JSON.stringify(x)).join('\n') + '\n')); assert.strictEqual(r.status, 1, `${name} should fail: ${r.stdout}`); assert.match(r.stdout, expect, `${name}: ${r.stdout}`) }
  fails('result', c => { c.find(x => x.type === 'result').result.sod.exceptionPairs = 0 }, /result does not equal/)
  fails('chainrow', c => { c.find(x => x.type === 'row' && x.seq === 2).output = '{"x":1}' }, /chain broken at seq 2/)
  fails('dropsignoff', c => { c.find(x => x.type === 'signoff').signoff = null }, /sign-off does not equal|sign-off row/)
  fails('signer', c => { c.find(x => x.type === 'signoff').signoff.signedBy = 'someoneelse' }, /sign-off does not equal/)
  fails('narrative', c => { c.find(x => x.type === 'narrative').text += ' All good.' }, /narrative differs/)
  fails('truncate', c => { c.splice(c.findIndex(x => x.type === 'row' && x.seq === 3), 1) }, /header says|chain broken/)
  fails('header', c => { c[0].runHash = '0'.repeat(64) }, /run row hash differs/)
  fails('format', c => { c[0].format = 'nope' }, /not a sox-evidence-pack/)
  console.log('tampering with result, chain row, sign-off, signer, narrative, rows or header all fail verification')

  // ---- table vs audit disagreement blocks export ----
  await cds.run(UPDATE('sox.Signoffs').set({ conclusion: 'EFFECTIVE' }).where({ runSeq: ac }))
  await reject(send(as('aud', ['auditor']), 'exportEvidence', { runSeq: ac }), 409, 'tampered Signoffs table')
  await cds.run(UPDATE('sox.Signoffs').set({ conclusion: 'NOT_EFFECTIVE' }).where({ runSeq: ac }))

  // ---- inconclusive and clean runs ----
  const xc = require('../srv/controls/ac01-crosscheck'), real = xc.reconcile
  await cds.run(UPDATE('sox.Users').set({ lastLogon: REF })); await cds.run(DELETE.from('sox.SodRules'))
  xc.reconcile = () => ({ status: 'UNAVAILABLE', source: 'stub', mismatches: [] })
  const inc = await run('ITGC-AC-01', { 'x-end-user': 'analyst1' })
  await reject(sign(owner1, { runSeq: inc, conclusion: 'EFFECTIVE', exceptionsReviewed: true, comment: 'x'.repeat(40) }), 422, 'inconclusive cannot be effective')
  xc.reconcile = real
  const clean = await run('ITGC-AC-01', { 'x-end-user': 'analyst1' })
  const ok = JSON.parse(await sign(owner2, { runSeq: clean, conclusion: 'EFFECTIVE' }))
  assert.strictEqual(ok.conclusion, 'EFFECTIVE')
  res = verify(write('clean.jsonl', await send(as('aud', ['auditor']), 'exportEvidence', { runSeq: clean }))); assert.strictEqual(res.status, 0, res.stdout)
  console.log('inconclusive run cannot be concluded effective; a clean run can, without extra comment; packs verify')

  const v = JSON.parse(await send(as('aud', ['auditor']), 'verifyAuditChain', {})); assert.strictEqual(v.ok, true, JSON.stringify(v))
  const exportRows = await cds.run(SELECT.from('sox.AuditLog').where({ tool: 'exportEvidence' })); assert.ok(exportRows.length >= 4, 'exports are audited')
  console.log('OK - evidence'); await cds.disconnect(); process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
