// FIN-JE-01: manual journal entry review. Every manual posting in the period is tested; a document that trips any test is an exception.
// Deterministic code over the full population. Nothing here calls a language model.
const { norm, holidaySet } = require('./dates')

const ID = 'FIN-JE-01'
const VERSION = '1.0.0'
const DEFAULTS = { roundThreshold: 100000, roundModulus: 10000 }
const REASONS = ['FIREFIGHTER_POSTER', 'AFTER_PERIOD_CLOSE', 'ROUND_AMOUNT', 'WEEKEND_OR_HOLIDAY', 'NO_INDEPENDENT_APPROVAL']

function run(data, ref, period, options = {}) {
  const { roundThreshold, roundModulus } = { ...DEFAULTS, ...options }
  const holidays = options.holidays ? new Set(options.holidays) : holidaySet(period.from, period.to)
  const firefighters = new Set(data.users.filter(u => u.userType === 'FIREFIGHTER').map(u => u.userId))
  const closed = new Map(data.periods.filter(p => norm(p.closedAt)).map(p => [`${p.fiscalYear}|${p.period}`, norm(p.closedAt)]))

  // One document = its lines; the header facts are the same on every line, so take the first.
  const docs = new Map()
  for (const l of data.lines) {
    if (l.source !== 'MANUAL') continue
    const pd = norm(l.postingDate)
    if (pd < period.from || pd > period.to) continue
    if (!docs.has(l.docNumber)) docs.set(l.docNumber, l)
  }
  const flagged = []
  for (const l of [...docs.values()].sort((a, b) => a.docNumber.localeCompare(b.docNumber))) {
    const reasons = []
    const entry = norm(l.entryDate), amount = Number(l.amount)
    if (firefighters.has(l.postedBy)) reasons.push('FIREFIGHTER_POSTER')
    const close = closed.get(`${l.fiscalYear}|${l.period}`)
    if (close && entry > close) reasons.push('AFTER_PERIOD_CLOSE')
    if (amount >= roundThreshold && Number.isInteger(amount) && amount % roundModulus === 0) reasons.push('ROUND_AMOUNT')
    const wd = new Date(entry + 'T00:00:00Z').getUTCDay()
    if (wd === 0 || wd === 6 || holidays.has(entry)) reasons.push('WEEKEND_OR_HOLIDAY')
    if (!l.reviewedBy || l.reviewedBy === l.postedBy) reasons.push('NO_INDEPENDENT_APPROVAL')
    if (reasons.length) flagged.push({ docNumber: l.docNumber, postedBy: l.postedBy, postingDate: norm(l.postingDate), entryDate: entry, amount: amount.toFixed(2), currency: l.currency, reviewedBy: l.reviewedBy || null, reasons })
  }
  const reasonCounts = Object.fromEntries(REASONS.map(r => [r, flagged.filter(f => f.reasons.includes(r)).length]).filter(([, n]) => n))
  const totalDocs = new Set(data.lines.filter(l => norm(l.postingDate) >= period.from && norm(l.postingDate) <= period.to).map(l => l.docNumber)).size
  return {
    controlId: ID, controlVersion: VERSION, referenceDate: ref, period, parameters: { roundThreshold, roundModulus, holidays: [...holidays].filter(h => h >= period.from && h <= period.to).sort() },
    population: { manualDocuments: docs.size, totalDocuments: totalDocs },
    flagged: { count: flagged.length, reasonCounts, documents: flagged },
    result: flagged.length === 0 ? 'PASS' : 'EXCEPTIONS'
  }
}

module.exports = { ID, VERSION, REASONS, run }
