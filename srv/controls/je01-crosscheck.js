// A second computation of FIN-JE-01, built by reason instead of by document: for each test, the set of documents that fail it.
// Weekday comes from a day count against a known Monday; the round test uses integer cents. It reads the same tables, so it
// cross-checks the logic, not the extract.
const { norm, daysBetween, holidaySet } = require('./dates')
const { compare } = require('./compare')

const MONDAY = '2026-01-05'

function crosscheck(data, period, options) {
  const T = options?.roundThreshold ?? 100000, MOD = options?.roundModulus ?? 10000
  const holidays = options?.holidays ? new Set(options.holidays) : holidaySet(period.from, period.to)
  const head = data.lines.filter(l => l.source === 'MANUAL' && norm(l.postingDate) >= period.from && norm(l.postingDate) <= period.to && l.lineItem === 1)
  const byReason = {}
  const fire = new Set(data.users.filter(u => u.userType === 'FIREFIGHTER').map(u => u.userId))
  byReason.FIREFIGHTER_POSTER = head.filter(l => fire.has(l.postedBy))
  byReason.AFTER_PERIOD_CLOSE = head.filter(l => { const p = data.periods.find(x => x.fiscalYear === l.fiscalYear && x.period === l.period); return p && norm(p.closedAt) && daysBetween(norm(p.closedAt), norm(l.entryDate)) > 0 })
  byReason.ROUND_AMOUNT = head.filter(l => { const cents = Math.round(Number(l.amount) * 100); return cents >= T * 100 && cents % (MOD * 100) === 0 })
  byReason.WEEKEND_OR_HOLIDAY = head.filter(l => { const dow = ((daysBetween(MONDAY, norm(l.entryDate)) % 7) + 7) % 7; return dow >= 5 || holidays.has(norm(l.entryDate)) })
  byReason.NO_INDEPENDENT_APPROVAL = head.filter(l => !l.reviewedBy || l.reviewedBy === l.postedBy)
  const out = {}
  for (const [r, ls] of Object.entries(byReason)) if (ls.length) out[r] = ls.map(l => l.docNumber).sort()
  return { head, byReason: out }
}

function reconcile(result, data, options) {
  return compare(() => {
    const x = crosscheck(data, result.period, options)
    const mine = {}
    for (const d of result.flagged.documents) for (const r of d.reasons) (mine[r] = mine[r] || []).push(d.docNumber)
    for (const k of Object.keys(mine)) mine[k].sort()
    return { mine: { population: result.population.manualDocuments, byReason: mine }, theirs: { population: x.head.length, byReason: x.byReason } }
  }, 'reason-indexed recomputation over the same tables (cross-check of logic, not an independent data source)')
}

module.exports = { crosscheck, reconcile }
