// ITGC-AC-01: segregation of duties in purchase-to-pay and general ledger, plus dormant privileged users.
// Pure function of the data it is given, so the same code runs on seeded tables here and on a customer's extract later.
// All logic is deterministic code. Nothing here calls a language model.
const { norm, daysBetween } = require('./dates')

const ID = 'ITGC-AC-01'
const VERSION = '1.0.0'
const DEFAULTS = { dormantDays: 90 }

// Currently valid role assignments of in-scope users: active (unlocked) dialog users. Firefighter and service ids are out of scope.
function inScope(data, ref) {
  const users = data.users.filter(u => u.userType === 'DIALOG' && !u.locked)
  const ok = new Set(users.map(u => u.userId))
  const current = data.assignments.filter(a => ok.has(a.userId) && norm(a.validFrom) <= ref && (norm(a.validTo) === null || norm(a.validTo) >= ref))
  return { users, current }
}

function run(data, ref, options = {}) {
  const dormantDays = options.dormantDays ?? DEFAULTS.dormantDays
  const { users, current } = inScope(data, ref)

  const capsOfRole = new Map()
  const capByKey = new Map(data.capabilities.map(c => [`${c.authObject}|${c.activity}`, c]))
  for (const a of data.roleAuths) {
    const c = capByKey.get(`${a.authObject}|${a.activity}`)
    if (!c) continue
    if (!capsOfRole.has(a.role)) capsOfRole.set(a.role, new Set())
    capsOfRole.get(a.role).add(c.capability)
  }
  const privileged = new Set(data.capabilities.filter(c => c.privileged).map(c => c.capability))

  // user -> capability -> roles that grant it
  const held = new Map()
  for (const a of current) {
    for (const cap of capsOfRole.get(a.role) || []) {
      if (!held.has(a.userId)) held.set(a.userId, new Map())
      const m = held.get(a.userId)
      if (!m.has(cap)) m.set(cap, new Set())
      m.get(cap).add(a.role)
    }
  }

  const mitigationFor = (userId, ruleId) => {
    const ms = data.mitigations.filter(m => m.userId === userId && m.ruleId === ruleId)
    const live = ms.find(m => norm(m.validFrom) <= ref && norm(m.validTo) >= ref)
    if (live) return { status: 'VALID', id: live.ID, description: live.description, approvedBy: live.approvedBy, validTo: norm(live.validTo) }
    const past = ms.filter(m => norm(m.validTo) < ref).sort((a, b) => norm(b.validTo).localeCompare(norm(a.validTo)))[0]
    if (past) return { status: 'EXPIRED', id: past.ID, validTo: norm(past.validTo) }
    const future = ms.find(m => norm(m.validFrom) > ref)
    if (future) return { status: 'NOT_YET_VALID', id: future.ID, validFrom: norm(future.validFrom) }
    return { status: 'NONE' }
  }

  const conflicts = []
  for (const u of [...users].sort((a, b) => a.userId.localeCompare(b.userId))) {
    const caps = held.get(u.userId)
    if (!caps) continue
    for (const rule of [...data.sodRules].sort((a, b) => a.ruleId.localeCompare(b.ruleId))) {
      if (!caps.has(rule.capabilityA) || !caps.has(rule.capabilityB)) continue
      const mitigation = mitigationFor(u.userId, rule.ruleId)
      conflicts.push({
        userId: u.userId, department: u.department, ruleId: rule.ruleId, riskLevel: rule.riskLevel, description: rule.description,
        rolesForA: [...caps.get(rule.capabilityA)].sort(), rolesForB: [...caps.get(rule.capabilityB)].sort(), mitigation,
        exception: mitigation.status !== 'VALID'
      })
    }
  }

  const dormant = []
  for (const u of [...users].sort((a, b) => a.userId.localeCompare(b.userId))) {
    const caps = held.get(u.userId)
    const priv = caps ? [...caps.keys()].filter(c => privileged.has(c)).sort() : []
    if (!priv.length) continue
    const last = norm(u.lastLogon)
    const idle = last === null ? null : daysBetween(last, ref)
    if (last === null || idle > dormantDays) dormant.push({ userId: u.userId, department: u.department, lastLogon: last, daysSinceLogon: idle, privilegedCapabilities: priv })
  }

  const exceptions = conflicts.filter(c => c.exception)
  return {
    controlId: ID, controlVersion: VERSION, referenceDate: ref, parameters: { dormantDays },
    population: { activeDialogUsers: users.length, usersHoldingAnyCapability: held.size },
    sod: { conflictPairs: conflicts.length, validMitigations: conflicts.length - exceptions.length, exceptionPairs: exceptions.length, conflicts },
    dormantPrivileged: { count: dormant.length, users: dormant },
    result: exceptions.length === 0 && dormant.length === 0 ? 'PASS' : 'EXCEPTIONS'
  }
}

module.exports = { ID, VERSION, DEFAULTS, run }
