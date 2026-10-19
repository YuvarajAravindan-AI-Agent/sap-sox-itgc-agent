// ControlService: runs the control through the service layer, audits every call (success and failure), chains the rows.
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { boot } = require('./helpers')
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'manifest.json'), 'utf8'))
const M = manifest['ITGC-AC-01'], REF = manifest.parameters.referenceDate

;(async () => {
  const cds = await boot()
  const srv = await cds.serve('ControlService').from(cds.model, { at: '/controls' })
  const send = (event, data, headers = {}) => srv.tx({ user: cds.User.privileged, headers }, tx => tx.send({ event, data }))
  const run = async (d, h) => JSON.parse(await send('runControl', { controlId: 'ITGC-AC-01', referenceDate: d }, h))

  const lib = JSON.parse(await send('listControls', {}, { 'x-correlation-id': 'conv-a' }))
  assert.deepStrictEqual(lib.controls.map(c => [c.controlId, c.available]), [['ITGC-AC-01', true], ['FIN-JE-01', true], ['ITGC-CM-01', true]])

  const r = await run(REF, { 'x-correlation-id': 'conv-a', 'x-end-user': 'analyst1' })
  assert.strictEqual(r.result, 'EXCEPTIONS'); assert.strictEqual(r.reconciliation.status, 'MATCH')
  assert.deepStrictEqual(r.sod.conflicts.filter(c => c.exception).map(c => `${c.userId}|${c.ruleId}`).sort(), [...M.sodExceptionPairList].sort())
  assert.deepStrictEqual(r.dormantPrivileged.users.map(u => u.userId), M.dormantPrivilegedUsers)
  assert.match(r.dataVersion, /^[0-9a-f]{64}$/); assert.match(r.notice, /not an assessment/)
  const r2 = await run(REF); assert.strictEqual(r2.dataVersion, r.dataVersion, 'same data, same data version')
  console.log('service result matches the planted numbers; reconciliation MATCH')

  // Failures: unknown control, not-yet-available control, bad date. Each is audited as an ERROR row.
  const fail = async (data, status) => { try { await send('runControl', data); assert.fail('should have failed') } catch (e) { assert.strictEqual(Number(e.statusCode || e.code), status, e.message) } }
  await fail({ controlId: 'NOPE-01' }, 404)
  await fail({ controlId: 'FIN-JE-01', periodStart: '2026-07-01' }, 400)
  await fail({ controlId: 'FIN-JE-01', periodStart: '2026-09-30', periodEnd: '2026-07-01' }, 400)
  await fail({ controlId: 'ITGC-AC-01', referenceDate: '2026-02-30' }, 400)
  await fail({ controlId: 'ITGC-AC-01', referenceDate: 'yesterday' }, 400)

  const v = JSON.parse(await send('verifyAuditChain', {})); assert.strictEqual(v.ok, true, JSON.stringify(v))
  const rows = await cds.run(SELECT.from('sox.AuditLog').orderBy('seq'))
  assert.deepStrictEqual(rows.map(x => x.seq), rows.map((_, i) => i + 1))
  const runRow = rows.find(x => x.tool === 'runControl' && x.outcome === 'OK')
  assert.strictEqual(runRow.endUser, 'analyst1'); assert.strictEqual(runRow.reconciliation, 'MATCH'); assert.strictEqual(runRow.dataVersion, r.dataVersion)
  assert.strictEqual(JSON.parse(runRow.output).sod.exceptionPairs, 5, 'the audit row holds the full result')
  assert.strictEqual(rows.filter(x => x.outcome === 'ERROR').length, 5, 'every failure audited')
  console.log('audit ok:', rows.length, 'rows chained, 5 failures recorded')

  // The period controls through the service: default period = last completed quarter before the reference date.
  const J = manifest['FIN-JE-01'], C = manifest['ITGC-CM-01']
  const je = JSON.parse(await send('runControl', { controlId: 'FIN-JE-01', referenceDate: REF }, { 'x-end-user': 'analyst1' }))
  assert.deepStrictEqual(je.period, { from: '2026-07-01', to: '2026-09-30' })
  assert.strictEqual(je.flagged.count, J.flaggedDocuments); assert.strictEqual(je.population.manualDocuments, J.population.manualDocuments)
  assert.deepStrictEqual(je.flagged.reasonCounts, J.reasonCounts); assert.strictEqual(je.reconciliation.status, 'MATCH'); assert.strictEqual(je.result, 'EXCEPTIONS')
  const cm = JSON.parse(await send('runControl', { controlId: 'ITGC-CM-01', referenceDate: REF }))
  assert.strictEqual(cm.flagged.count, C.exceptions); assert.strictEqual(cm.population.productionTransports, C.population.productionTransportsInQuarter)
  assert.deepStrictEqual(cm.flagged.reasonCounts, C.reasonCounts); assert.strictEqual(cm.reconciliation.status, 'MATCH')
  const explicit = JSON.parse(await send('runControl', { controlId: 'FIN-JE-01', referenceDate: REF, periodStart: '2026-07-01', periodEnd: '2026-09-30' }))
  assert.strictEqual(explicit.dataVersion, je.dataVersion, 'explicit period equal to the default reads the same data')
  const empty = JSON.parse(await send('runControl', { controlId: 'FIN-JE-01', referenceDate: '2026-12-31', periodStart: '2026-10-01', periodEnd: '2026-12-31' }))
  assert.strictEqual(empty.result, 'PASS'); assert.strictEqual(empty.population.manualDocuments, 0)
  console.log('FIN-JE-01 and ITGC-CM-01 through the service: planted numbers, MATCH, default and explicit period')

  // A clean control passes only while its cross-check agrees. A disagreeing or unavailable cross-check can never leave it looking clean.
  const xc = require('../srv/controls/ac01-crosscheck')
  const real = xc.reconcile
  await cds.run(UPDATE('sox.Users').set({ lastLogon: REF }))             // everyone just logged in
  await cds.run(DELETE.from('sox.SodRules'))                              // and no rules: the primary computation is clean
  const clean = await run(REF); assert.strictEqual(clean.result, 'PASS'); assert.strictEqual(clean.reconciliation.status, 'MATCH')
  xc.reconcile = () => ({ status: 'MISMATCH', source: 'stub', mismatches: [{ field: 'exceptionPairs' }] })
  const mism = await run(REF); assert.strictEqual(mism.result, 'NOT_CONCLUSIVE', 'MISMATCH on a clean run is not a pass')
  xc.reconcile = () => ({ status: 'UNAVAILABLE', source: 'stub', mismatches: [] })
  const unav = await run(REF); assert.strictEqual(unav.result, 'NOT_CONCLUSIVE', 'UNAVAILABLE on a clean run is not a pass')
  xc.reconcile = real
  const last = await cds.run(SELECT.one.from('sox.AuditLog').orderBy('seq desc'))
  assert.strictEqual(last.reconciliation, 'UNAVAILABLE'); assert.strictEqual(JSON.parse(last.output).result, 'NOT_CONCLUSIVE')
  assert.strictEqual(JSON.parse(await send('verifyAuditChain', {})).ok, true)
  console.log('NOT_CONCLUSIVE when the cross-check disagrees or is unavailable; audited')
  console.log('OK - ac01 service')
  await cds.disconnect(); process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
