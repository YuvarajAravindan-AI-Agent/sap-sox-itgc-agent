// FIN-JE-01 and ITGC-CM-01 as pure functions: planted numbers, boundaries, calendar helpers, cross-checks.
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { boot } = require('./helpers')
const je01 = require('../srv/controls/je01'), je01x = require('../srv/controls/je01-crosscheck')
const cm01 = require('../srv/controls/cm01'), cm01x = require('../srv/controls/cm01-crosscheck')
const dates = require('../srv/controls/dates')

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'manifest.json'), 'utf8'))
const REF = manifest.parameters.referenceDate, Q = { from: manifest.parameters.quarter.from, to: manifest.parameters.quarter.to }
const sorted = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [...v].sort()]))
const clone = x => JSON.parse(JSON.stringify(x))

;(async () => {
  // Calendar helpers.
  assert.deepStrictEqual(dates.lastCompletedQuarter('2026-10-19'), Q)
  assert.deepStrictEqual(dates.lastCompletedQuarter('2026-01-02'), { from: '2025-10-01', to: '2025-12-31' })
  assert.deepStrictEqual(dates.lastCompletedQuarter('2026-04-01'), { from: '2026-01-01', to: '2026-03-31' })
  assert.deepStrictEqual(dates.lastCompletedQuarter('2026-12-31'), { from: '2026-07-01', to: '2026-09-30' })
  assert.deepStrictEqual(dates.usHolidays(2026), ['2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25'])
  assert.deepStrictEqual([...dates.holidaySet(Q.from, Q.to)].filter(h => h >= Q.from && h <= Q.to).sort(), manifest.parameters.holidays, 'computed Q3 holidays equal the seed list')
  console.log('calendar helpers ok')

  const cds = await boot()
  const t = n => cds.db.run(SELECT.from('sox.' + n))
  const jd = { lines: await t('JournalLines'), periods: await t('PostingPeriods'), users: await t('Users') }
  const cd = { transports: await t('Transports'), tickets: await t('ChangeTickets') }

  // FIN-JE-01
  const J = manifest['FIN-JE-01']
  const r = je01.run(jd, REF, Q)
  assert.strictEqual(r.population.manualDocuments, J.population.manualDocuments); assert.strictEqual(r.population.totalDocuments, J.population.totalDocuments)
  assert.deepStrictEqual(sorted(Object.fromEntries(r.flagged.documents.map(d => [d.docNumber, d.reasons]))), sorted(J.flagged))
  assert.deepStrictEqual(r.flagged.reasonCounts, J.reasonCounts)
  assert.strictEqual(r.result, 'EXCEPTIONS')
  for (const d of J.decoys) assert.ok(!r.flagged.documents.some(f => f.docNumber === d.doc), 'decoy flagged ' + d.doc)
  assert.strictEqual(je01x.reconcile(r, jd).status, 'MATCH')
  console.log('JE-01 planted numbers reproduced, decoys clean, cross-check MATCH')

  // Boundaries on a copy of the data: edit one decoy at a time.
  const edit = (docNumber, patch) => { const d = clone(jd); d.lines.filter(l => l.docNumber === docNumber).forEach(l => Object.assign(l, patch)); return d }
  const flaggedFor = (d, doc) => je01.run(d, REF, Q).flagged.documents.find(f => f.docNumber === doc)?.reasons
  const closing = J.decoys.find(x => /closing day/.test(x.why)).doc, below = J.decoys.find(x => /under the 100,000/.test(x.why)).doc, large = J.decoys.find(x => /not a multiple/.test(x.why)).doc
  assert.deepStrictEqual(flaggedFor(edit(closing, { entryDate: '2026-10-08' }), closing), ['AFTER_PERIOD_CLOSE'], 'one day after close is flagged; the closing day itself is not')
  assert.strictEqual(flaggedFor(edit(below, { amount: '100000.00' }), below).join(), 'ROUND_AMOUNT', 'exactly 100,000.00 is flagged')
  assert.strictEqual(flaggedFor(edit(below, { amount: '99999.99' }), below), undefined)
  assert.strictEqual(flaggedFor(edit(below, { amount: '110000.00' }), below).join(), 'ROUND_AMOUNT')
  assert.strictEqual(flaggedFor(edit(large, { amount: '100010.00' }), large), undefined, '100,010 is not a multiple of 10,000')
  assert.strictEqual(flaggedFor(edit(large, { amount: '100000.01' }), large), undefined, 'cents break roundness')
  assert.deepStrictEqual(flaggedFor(edit(large, { entryDate: '2026-08-29' }), large), ['WEEKEND_OR_HOLIDAY'], 'a Saturday')
  assert.deepStrictEqual(flaggedFor(edit(large, { entryDate: '2026-08-30' }), large), ['WEEKEND_OR_HOLIDAY'], 'a Sunday')
  assert.strictEqual(flaggedFor(edit(large, { entryDate: '2026-08-31' }), large), undefined, 'the Monday after is fine')
  assert.deepStrictEqual(flaggedFor(edit(large, { reviewedBy: '' }), large), ['NO_INDEPENDENT_APPROVAL'])
  assert.deepStrictEqual(flaggedFor(edit(large, { reviewedBy: 'GL002' }), large), ['NO_INDEPENDENT_APPROVAL'], 'the poster reviewing their own entry')
  const edited = edit(large, { entryDate: '2026-08-29', amount: '100000.00' })
  assert.strictEqual(je01x.reconcile(je01.run(edited, REF, Q), edited).status, 'MATCH', 'cross-check agrees on edited data')
  // A document posted outside the period is not in the population.
  assert.strictEqual(je01.run(jd, REF, { from: '2026-10-01', to: '2026-12-31' }).population.manualDocuments, 0)
  const bad = clone(r); bad.flagged.documents.pop(); assert.strictEqual(je01x.reconcile(bad, jd).status, 'MISMATCH')
  assert.strictEqual(je01x.reconcile(r, { ...jd, users: null }).status, 'UNAVAILABLE')
  console.log('JE-01 boundaries ok: close day, 100,000 threshold, multiples, weekends, self-review, period')

  // ITGC-CM-01
  const C = manifest['ITGC-CM-01']
  const c = cm01.run(cd, REF, Q)
  assert.strictEqual(c.population.productionTransports, C.population.productionTransportsInQuarter)
  assert.deepStrictEqual(sorted(Object.fromEntries(c.flagged.transports.map(x => [x.trkorr, x.reasons]))), sorted(C.flagged))
  assert.deepStrictEqual(c.flagged.reasonCounts, C.reasonCounts)
  for (const d of C.decoys) assert.ok(!c.flagged.transports.some(f => f.trkorr === d.trkorr), 'decoy flagged ' + d.trkorr)
  assert.strictEqual(cm01x.reconcile(c, cd).status, 'MATCH')
  console.log('CM-01 planted numbers reproduced, decoys clean, cross-check MATCH')
  const ok = C.decoys.find(x => /3 days/.test(x.why)).trkorr
  const tedit = (trkorr, patch) => { const d = clone(cd); Object.assign(d.transports.find(x => x.trkorr === trkorr), patch); return d }
  const cflag = (d, id) => cm01.run(d, REF, Q).flagged.transports.find(f => f.trkorr === id)?.reasons
  const rel = cd.transports.find(x => x.trkorr === ok).releasedAt
  assert.strictEqual(cflag(tedit(ok, { reviewedAt: dates.addDays(rel, 5) }), ok), undefined, 'review on day 5 is inside the window')
  assert.deepStrictEqual(cflag(tedit(ok, { reviewedAt: dates.addDays(rel, 6) }), ok), ['EMERGENCY_REVIEW_LATE'], 'day 6 is late')
  assert.deepStrictEqual(cflag(tedit(ok, { reviewedAt: '' }), ok), ['EMERGENCY_NOT_REVIEWED'])
  assert.strictEqual(cflag(tedit(ok, { priority: 'NORMAL', reviewedAt: '' }), ok), undefined, 'normal changes need no emergency review')
  const tk = cd.transports.find(x => x.trkorr === ok).ticketId
  const kedit = patch => { const d = clone(cd); Object.assign(d.tickets.find(x => x.ticketId === tk), patch); return d }
  assert.strictEqual(cflag(kedit({ approvedAt: rel }), ok), undefined, 'approved on the release day is fine')
  assert.deepStrictEqual(cflag(kedit({ approvedAt: dates.addDays(rel, 1) }), ok), ['APPROVED_AFTER_RELEASE'])
  assert.deepStrictEqual(cflag(kedit({ status: 'DRAFT' }), ok), ['TICKET_NOT_APPROVED'])
  const owner = cd.transports.find(x => x.trkorr === ok).owner
  assert.deepStrictEqual(cflag(kedit({ approver: owner }), ok), ['SELF_APPROVED'])
  const ed = kedit({ approver: owner }); assert.strictEqual(cm01x.reconcile(cm01.run(ed, REF, Q), ed).status, 'MATCH')
  assert.strictEqual(cm01.run(cd, REF, { from: '2026-10-01', to: '2026-12-31' }).population.productionTransports, 1, 'only the out-of-quarter Oct 2 transport')
  const cbad = clone(c); cbad.flagged.transports.shift(); assert.strictEqual(cm01x.reconcile(cbad, cd).status, 'MISMATCH')
  assert.strictEqual(cm01x.reconcile(c, { ...cd, tickets: null }).status, 'UNAVAILABLE')
  console.log('CM-01 boundaries ok: review window day 5/6, approval on release day, draft, self-approval, period')
  console.log('OK - je01/cm01')
  await cds.disconnect(); process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
