// Shared by the cross-checks: compare what the primary computation found with what the second one found.
// Never throws: a cross-check that cannot run is UNAVAILABLE, and the control must not then look clean.
// Key order must not matter: two objects with the same content are equal.
const canon = v => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v

function compare(fn, source) {
  try {
    const { mine, theirs } = fn()
    const mismatches = []
    for (const k of Object.keys(mine)) {
      if (JSON.stringify(canon(mine[k])) !== JSON.stringify(canon(theirs[k]))) mismatches.push({ field: k, computed: mine[k], crosscheck: theirs[k] })
    }
    return { status: mismatches.length ? 'MISMATCH' : 'MATCH', source, mismatches }
  } catch (e) {
    return { status: 'UNAVAILABLE', source, reason: String(e.message).slice(0, 200), mismatches: [] }
  }
}
module.exports = { compare }
