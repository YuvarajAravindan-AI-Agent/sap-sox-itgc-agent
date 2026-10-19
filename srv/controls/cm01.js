// ITGC-CM-01: change management to production. Every production transport released in the period is tested.
// Deterministic code over the full population. Nothing here calls a language model.
const { norm, daysBetween } = require('./dates')

const ID = 'ITGC-CM-01'
const VERSION = '1.0.0'
const DEFAULTS = { emergencyReviewDays: 5 }
const REASONS = ['NO_TICKET', 'TICKET_NOT_APPROVED', 'SELF_APPROVED', 'APPROVED_AFTER_RELEASE', 'EMERGENCY_NOT_REVIEWED', 'EMERGENCY_REVIEW_LATE']

function run(data, ref, period, options = {}) {
  const { emergencyReviewDays } = { ...DEFAULTS, ...options }
  const tickets = new Map(data.tickets.map(t => [t.ticketId, t]))
  const pop = data.transports.filter(t => t.targetSystem === 'PRD' && norm(t.releasedAt) >= period.from && norm(t.releasedAt) <= period.to)
  const flagged = []
  for (const t of [...pop].sort((a, b) => a.trkorr.localeCompare(b.trkorr))) {
    const reasons = []
    const released = norm(t.releasedAt), k = t.ticketId ? tickets.get(t.ticketId) : undefined
    if (!k) reasons.push('NO_TICKET')
    else {
      if (k.status !== 'APPROVED') reasons.push('TICKET_NOT_APPROVED')
      if (k.approver === t.owner) reasons.push('SELF_APPROVED')
      if (norm(k.approvedAt) && norm(k.approvedAt) > released) reasons.push('APPROVED_AFTER_RELEASE')
    }
    if (t.priority === 'EMERGENCY') {
      if (!norm(t.reviewedAt)) reasons.push('EMERGENCY_NOT_REVIEWED')
      else if (daysBetween(released, norm(t.reviewedAt)) > emergencyReviewDays) reasons.push('EMERGENCY_REVIEW_LATE')
    }
    if (reasons.length) flagged.push({ trkorr: t.trkorr, owner: t.owner, releasedAt: released, priority: t.priority, ticketId: t.ticketId || null, ticketApprover: k?.approver ?? null, reasons })
  }
  const reasonCounts = Object.fromEntries(REASONS.map(r => [r, flagged.filter(f => f.reasons.includes(r)).length]).filter(([, n]) => n))
  return {
    controlId: ID, controlVersion: VERSION, referenceDate: ref, period, parameters: { emergencyReviewDays },
    population: { productionTransports: pop.length, emergencyChanges: pop.filter(t => t.priority === 'EMERGENCY').length },
    flagged: { count: flagged.length, reasonCounts, transports: flagged },
    result: flagged.length === 0 ? 'PASS' : 'EXCEPTIONS'
  }
}

module.exports = { ID, VERSION, REASONS, run }
