// ITGC-AC-01 as a pure function: it must reproduce the planted numbers in seed/manifest.json, handle dates correctly,
// and its cross-check must agree with it, and must disagree when the result has been tampered with.
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { boot } = require('./helpers')
const ac01 = require('../srv/controls/ac01')
const { reconcile } = require('../srv/controls/ac01-crosscheck')

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'manifest.json'), 'utf8'))
const M = manifest['ITGC-AC-01'], REF = manifest.parameters.referenceDate

;(async () => {
  const cds = await boot()
  const t = n => cds.db.run(SELECT.from('sox.' + n))
  const data = { users: await t('Users'), assignments: await t('RoleAssignments'), roleAuths: await t('RoleAuthorizations'), capabilities: await t('Capabilities'), sodRules: await t('SodRules'), mitigations: await t('MitigatingControls') }
  const keys = r => r.sod.conflicts.map(c => `${c.userId}|${c.ruleId}`)

  // 1. The planted numbers.
  let r = ac01.run(data, REF)
  assert.deepStrictEqual(keys(r).sort(), [...M.sodConflictPairList].sort(), 'conflict pairs')
  assert.deepStrictEqual(r.sod.conflicts.filter(c => c.exception).map(c => `${c.userId}|${c.ruleId}`).sort(), [...M.sodExceptionPairList].sort(), 'exception pairs')
  assert.strictEqual(r.sod.exceptionPairs, M.sodExceptionPairs); assert.strictEqual(r.sod.validMitigations, 1)
  assert.deepStrictEqual(r.dormantPrivileged.users.map(u => u.userId), M.dormantPrivilegedUsers)
  assert.strictEqual(r.population.activeDialogUsers, M.population.activeDialogUsers)
  assert.strictEqual(r.result, 'EXCEPTIONS')
  const by = (u, rule) => r.sod.conflicts.find(c => c.userId === u && c.ruleId === rule)
  assert.strictEqual(by('GL004', 'SOD-GL-01').mitigation.status, 'EXPIRED')
  assert.strictEqual(by('TR002', 'SOD-P2P-02').mitigation.status, 'VALID')
  assert.strictEqual(by('AP007', 'SOD-P2P-01').mitigation.status, 'NONE', 'a mitigation for another rule does not count')
  assert.deepStrictEqual(by('AP007', 'SOD-P2P-01').rolesForA, ['Z_AP_BAD_COMBO'], 'one bad role carries both sides')
  assert.deepStrictEqual(by('AP006', 'SOD-P2P-01').rolesForA.concat(by('AP006', 'SOD-P2P-01').rolesForB), ['Z_VENDOR_MASTER', 'Z_PAYMENT_RUN'])
  assert.strictEqual(r.dormantPrivileged.users.find(u => u.userId === 'AP011').daysSinceLogon, 170)
  console.log('planted numbers reproduced; mitigation states and role evidence correct')

  // 2. Cross-check agrees.
  assert.strictEqual(reconcile(r, data).status, 'MATCH')

  // 3. Date logic moves the result the right way.
  const later = ac01.run(data, '2027-07-15')       // MIT-001 (validTo 2027-06-30) has expired; AP013's payment role (from 2026-11-01) is live
  assert.strictEqual(later.sod.exceptionPairs, 7, 'expired mitigation (TR002) and a role that has started (AP013) each add an exception')
  assert.strictEqual(later.sod.conflicts.find(c => c.userId === 'TR002').mitigation.status, 'EXPIRED')
  assert.strictEqual(later.sod.conflicts.find(c => c.userId === 'TR002').exception, true)
  assert.strictEqual(reconcile(later, data).status, 'MATCH')
  const earlier = ac01.run(data, '2026-03-01')     // before AP010's payment role expired (2026-03-31): a conflict then
  assert.ok(keys(earlier).includes('AP010|SOD-P2P-01'), 'AP010 had a live conflict on 2026-03-01')
  assert.ok(!keys(r).includes('AP010|SOD-P2P-01'), 'and not on the reference date')
  assert.strictEqual(reconcile(earlier, data).status, 'MATCH')
  assert.ok(keys(ac01.run(data, '2026-11-01')).includes('AP013|SOD-P2P-01'), 'a role valid from the reference date counts')
  assert.ok(!keys(ac01.run(data, '2026-10-31')).includes('AP013|SOD-P2P-01'), 'and one day earlier it does not')
  assert.ok(keys(ac01.run(data, '2026-03-31')).includes('AP010|SOD-P2P-01'), 'a role valid to the reference date still counts')
  assert.ok(!keys(ac01.run(data, '2026-04-01')).includes('AP010|SOD-P2P-01'), 'and one day later it does not')
  console.log('date logic ok: expiry, past reference date, role start and end boundaries')

  // 4. Dormancy boundary: BS004 last logged in 2026-07-31. Exactly 90 days idle is not dormant, 91 is.
  const idle = d => ac01.run(data, d).dormantPrivileged.users.find(u => u.userId === 'BS004')
  assert.strictEqual(idle('2026-10-29'), undefined, '90 days idle is not dormant')
  assert.strictEqual(idle('2026-10-30').daysSinceLogon, 91, '91 days idle is dormant')
  assert.strictEqual(reconcile(ac01.run(data, '2026-10-30'), data).status, 'MATCH', 'the cross-check agrees at the boundary')
  console.log('dormancy boundary checked (90 not dormant, 91 dormant)')

  // 5. The cross-check catches a wrong result (a deliberate fault in the primary computation).
  const bad = JSON.parse(JSON.stringify(r)); bad.sod.conflicts = bad.sod.conflicts.filter(c => c.userId !== 'AP008')
  const rec = reconcile(bad, data)
  assert.strictEqual(rec.status, 'MISMATCH'); assert.ok(rec.mismatches.some(m => m.field === 'exceptionPairs'))
  assert.strictEqual(reconcile(r, { ...data, users: null }).status, 'UNAVAILABLE', 'a broken cross-check is UNAVAILABLE, not a pass')
  console.log('cross-check detects a wrong result; failure is UNAVAILABLE')

  // 6. Clean data passes.
  const clean = { ...data, sodRules: [], users: data.users.map(u => ({ ...u, lastLogon: REF })) }
  const pass = ac01.run(clean, REF); assert.strictEqual(pass.result, 'PASS'); assert.strictEqual(pass.sod.conflictPairs, 0)
  console.log('OK - ac01')
  await cds.disconnect(); process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
