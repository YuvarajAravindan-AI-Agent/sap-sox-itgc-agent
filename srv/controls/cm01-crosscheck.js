// A second computation of ITGC-CM-01, built by reason: for each test, the set of transports that fail it, using set lookups and
// day counts rather than the per-transport walk. Reads the same tables, so it cross-checks the logic, not the extract.
const { norm, day } = require('./dates')
const { compare } = require('./compare')

function crosscheck(data, period, options) {
  const win = options?.emergencyReviewDays ?? 5
  const inPeriod = data.transports.filter(t => t.targetSystem === 'PRD' && day(norm(t.releasedAt)) >= day(period.from) && day(norm(t.releasedAt)) <= day(period.to))
  const known = new Set(data.tickets.map(k => k.ticketId))
  const ticket = new Map(data.tickets.map(k => [k.ticketId, k]))
  const linked = inPeriod.filter(t => known.has(t.ticketId))
  const sets = {
    NO_TICKET: inPeriod.filter(t => !known.has(t.ticketId)),
    TICKET_NOT_APPROVED: linked.filter(t => ticket.get(t.ticketId).status !== 'APPROVED'),
    SELF_APPROVED: linked.filter(t => ticket.get(t.ticketId).approver === t.owner),
    APPROVED_AFTER_RELEASE: linked.filter(t => norm(ticket.get(t.ticketId).approvedAt) && day(norm(ticket.get(t.ticketId).approvedAt)) > day(norm(t.releasedAt))),
    EMERGENCY_NOT_REVIEWED: inPeriod.filter(t => t.priority === 'EMERGENCY' && !norm(t.reviewedAt)),
    EMERGENCY_REVIEW_LATE: inPeriod.filter(t => t.priority === 'EMERGENCY' && norm(t.reviewedAt) && day(norm(t.reviewedAt)) - day(norm(t.releasedAt)) > win * 86400000)
  }
  const out = {}
  for (const [r, ts] of Object.entries(sets)) if (ts.length) out[r] = ts.map(t => t.trkorr).sort()
  return { population: inPeriod.length, byReason: out }
}

function reconcile(result, data, options) {
  return compare(() => {
    const x = crosscheck(data, result.period, options)
    const mine = {}
    for (const t of result.flagged.transports) for (const r of t.reasons) (mine[r] = mine[r] || []).push(t.trkorr)
    for (const k of Object.keys(mine)) mine[k].sort()
    return { mine: { population: result.population.productionTransports, byReason: mine }, theirs: { population: x.population, byReason: x.byReason } }
  }, 'reason-indexed recomputation over the same tables (cross-check of logic, not an independent data source)')
}

module.exports = { crosscheck, reconcile }
