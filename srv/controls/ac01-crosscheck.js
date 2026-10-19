// A second, differently built computation of the same ITGC-AC-01 headline numbers, used to cross-check the first.
// ac01.js walks user by user. This one indexes by capability: for each capability, the set of users who hold it, then
// intersects the sets per rule. Date maths uses a millisecond cutoff, not a day count. It reads the same tables, so it
// catches logic errors in either implementation, not a wrong or incomplete extract. Say so wherever the result is shown.
const { norm, day } = require('./dates')

function crosscheck(data, ref, options = {}) {
  const dormantDays = options.dormantDays ?? 90
  const refMs = day(ref)
  const inScope = new Set(data.users.filter(u => u.userType === 'DIALOG' && !u.locked).map(u => u.userId))
  const byCap = new Map()                                              // capability -> Set(user)
  const rolesGranting = new Map()                                      // role -> Set(capability)
  for (const c of data.capabilities) {
    for (const a of data.roleAuths) {
      if (a.authObject === c.authObject && a.activity === c.activity) {
        if (!rolesGranting.has(a.role)) rolesGranting.set(a.role, new Set())
        rolesGranting.get(a.role).add(c.capability)
      }
    }
  }
  for (const a of data.assignments) {
    const from = norm(a.validFrom), to = norm(a.validTo)
    if (!inScope.has(a.userId) || (from !== null && day(from) > refMs) || (to !== null && day(to) < refMs)) continue
    for (const cap of rolesGranting.get(a.role) || []) {
      if (!byCap.has(cap)) byCap.set(cap, new Set())
      byCap.get(cap).add(a.userId)
    }
  }
  const live = new Set(data.mitigations.filter(m => day(norm(m.validFrom)) <= refMs && day(norm(m.validTo)) >= refMs).map(m => `${m.userId}|${m.ruleId}`))
  const pairs = []
  for (const r of data.sodRules) {
    const a = byCap.get(r.capabilityA) || new Set(), b = byCap.get(r.capabilityB) || new Set()
    for (const u of a) if (b.has(u)) pairs.push(`${u}|${r.ruleId}`)
  }
  pairs.sort()
  const privileged = new Set()
  for (const c of data.capabilities) if (c.privileged) for (const u of byCap.get(c.capability) || []) privileged.add(u)
  const cutoff = refMs - dormantDays * 86400000
  const dormant = data.users.filter(u => privileged.has(u.userId) && (norm(u.lastLogon) === null || day(norm(u.lastLogon)) < cutoff)).map(u => u.userId).sort()
  return { conflictPairs: pairs, exceptionPairs: pairs.filter(p => !live.has(p)), dormantPrivileged: dormant }
}

// Compare the primary result with the cross-check. Never throws: a failure to cross-check is UNAVAILABLE, not a pass.
function reconcile(result, data, options) {
  try {
    const x = crosscheck(data, result.referenceDate, options)
    const mine = {
      conflictPairs: result.sod.conflicts.map(c => `${c.userId}|${c.ruleId}`).sort(),
      exceptionPairs: result.sod.conflicts.filter(c => c.exception).map(c => `${c.userId}|${c.ruleId}`).sort(),
      dormantPrivileged: result.dormantPrivileged.users.map(u => u.userId).sort()
    }
    const mismatches = []
    for (const k of Object.keys(mine)) {
      const a = JSON.stringify(mine[k]), b = JSON.stringify(x[k])
      if (a !== b) mismatches.push({ field: k, computed: mine[k], crosscheck: x[k] })
    }
    return { status: mismatches.length ? 'MISMATCH' : 'MATCH', source: 'capability-indexed recomputation over the same tables (cross-check of logic, not an independent data source)', mismatches }
  } catch (e) {
    return { status: 'UNAVAILABLE', source: 'cross-check', reason: String(e.message).slice(0, 200), mismatches: [] }
  }
}

module.exports = { crosscheck, reconcile }
