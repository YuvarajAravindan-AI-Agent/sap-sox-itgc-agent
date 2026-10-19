// The one-page narrative of an evidence pack. A fixed template over the result record, so the same record always gives the
// same text and anyone can regenerate and compare it. A language model never writes this text.
const list = a => a.join(', ')

function headline(r) {
  if (r.controlId === 'ITGC-AC-01') {
    const ex = r.sod.conflicts.filter(c => c.exception), users = [...new Set(ex.map(c => c.userId))]
    return [
      `Population: ${r.population.activeDialogUsers} active dialog users (state on ${r.referenceDate}).`,
      `Segregation of duties: ${r.sod.conflictPairs} conflicting user/rule pairs found; ${r.sod.validMitigations} covered by a valid mitigating control; ${r.sod.exceptionPairs} exceptions${users.length ? ` (${users.length} users: ${list(users)})` : ''}.`,
      ...ex.map(c => `  - ${c.userId} breaks ${c.ruleId} (${c.riskLevel}); mitigation: ${c.mitigation.status}.`),
      `Dormant privileged users (no login for ${r.parameters.dormantDays}+ days): ${r.dormantPrivileged.count}${r.dormantPrivileged.count ? ` (${list(r.dormantPrivileged.users.map(u => `${u.userId}, ${u.daysSinceLogon} days`))})` : ''}.`
    ]
  }
  if (r.controlId === 'FIN-JE-01') {
    return [
      `Population: ${r.population.manualDocuments} manual journal documents posted ${r.period.from} to ${r.period.to} (of ${r.population.totalDocuments} documents in total).`,
      `Flagged documents: ${r.flagged.count}. Reasons: ${Object.entries(r.flagged.reasonCounts).map(([k, n]) => `${k} ${n}`).join('; ') || 'none'}.`,
      ...r.flagged.documents.map(d => `  - ${d.docNumber} (${d.amount} ${d.currency}, posted by ${d.postedBy}, entered ${d.entryDate}): ${list(d.reasons)}.`)
    ]
  }
  if (r.controlId === 'ITGC-CM-01') {
    return [
      `Population: ${r.population.productionTransports} production transports released ${r.period.from} to ${r.period.to} (${r.population.emergencyChanges} emergency).`,
      `Exceptions: ${r.flagged.count}. Reasons: ${Object.entries(r.flagged.reasonCounts).map(([k, n]) => `${k} ${n}`).join('; ') || 'none'}.`,
      ...r.flagged.transports.map(t => `  - ${t.trkorr} (owner ${t.owner}, released ${t.releasedAt}${t.ticketId ? `, ticket ${t.ticketId}` : ''}): ${list(t.reasons)}.`)
    ]
  }
  return ['(no narrative template for this control)']
}

function buildNarrative(r, signoff) {
  const lines = [
    `${r.controlId} v${r.controlVersion}: test evidence`,
    `Reference date ${r.referenceDate}${r.period ? `; period ${r.period.from} to ${r.period.to}` : ''}.`,
    '',
    ...headline(r),
    '',
    `Test result: ${r.result}.`,
    `Cross-check: ${r.reconciliation.status} (${r.reconciliation.source}).`,
    `Data version (SHA-256 of the rows read): ${r.dataVersion}.`,
    '',
    signoff
      ? `Sign-off: ${signoff.signedBy} concluded ${signoff.conclusion} on ${String(signoff.signedAt).slice(0, 10)}; exceptions reviewed: ${signoff.exceptionsReviewed ? 'yes' : 'no'}. Comment: ${signoff.comment || '(none)'}`
      : 'Sign-off: none. Only a named control owner can conclude on this run.',
    '',
    'This document is test evidence produced by deterministic code over the full population. It is not an assessment that the control is effective; the conclusion above, where present, is the named control owner\'s. It is not audit or legal advice.'
  ]
  return lines.join('\n')
}

module.exports = { buildNarrative }
