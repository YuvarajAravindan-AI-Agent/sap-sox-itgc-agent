// The synthetic data and its planted exceptions. An independent oracle (plain SQL, written separately from the generator and,
// later, from the control code) recomputes every planted number from the loaded tables and must match seed/manifest.json.
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { boot } = require('./helpers')

const root = path.join(__dirname, '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'seed', 'manifest.json'), 'utf8'))
const P = manifest.parameters
const REF = P.referenceDate

;(async () => {
  // 1. Determinism: regenerating gives byte-identical files.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seedcheck-'))
  execFileSync(process.execPath, [path.join(root, 'seed', 'generate.js'), '--out', tmp], { stdio: 'ignore' })
  for (const f of fs.readdirSync(path.join(root, 'db', 'data')).filter(f => f.endsWith('.csv'))) {
    assert.strictEqual(fs.readFileSync(path.join(tmp, f), 'utf8'), fs.readFileSync(path.join(root, 'db', 'data', f), 'utf8'), `${f} is not reproducible`)
  }
  assert.strictEqual(fs.readFileSync(path.join(tmp, 'manifest.json'), 'utf8'), fs.readFileSync(path.join(root, 'seed', 'manifest.json'), 'utf8'), 'manifest is not reproducible')
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log('seed is deterministic')

  const cds = await boot()
  const sql = (q, ...args) => cds.db.run(q, args)
  const none = col => `COALESCE(NULLIF(${col}, ''), '')`

  // 2. ITGC-AC-01: segregation of duties and dormant privileged users.
  const current = `SELECT ra.userId AS userId, ra.role AS role FROM sox_RoleAssignments ra JOIN sox_Users u ON u.userId = ra.userId
    WHERE u.userType = 'DIALOG' AND u.locked = 0 AND ra.validFrom <= ? AND COALESCE(NULLIF(ra.validTo, ''), '9999-12-31') >= ?`
  const userCaps = `SELECT DISTINCT cur.userId AS userId, c.capability AS capability, c.privileged AS privileged FROM (${current}) cur
    JOIN sox_RoleAuthorizations a ON a.role = cur.role JOIN sox_Capabilities c ON c.authObject = a.authObject AND c.activity = a.activity`
  const pairs = await sql(`SELECT DISTINCT a.userId AS userId, r.ruleId AS ruleId FROM (${userCaps}) a JOIN (${userCaps}) b ON a.userId = b.userId
    JOIN sox_SodRules r ON r.capabilityA = a.capability AND r.capabilityB = b.capability ORDER BY 1, 2`, REF, REF, REF, REF)
  const keys = pairs.map(p => `${p.userId}|${p.ruleId}`)
  assert.deepStrictEqual(keys, [...manifest['ITGC-AC-01'].sodConflictPairList].sort(), 'SoD conflict pairs')
  const valid = await sql(`SELECT userId || '|' || ruleId AS k FROM sox_MitigatingControls WHERE validFrom <= ? AND validTo >= ?`, REF, REF)
  const mitigated = new Set(valid.map(v => v.k))
  assert.deepStrictEqual(keys.filter(k => !mitigated.has(k)), [...manifest['ITGC-AC-01'].sodExceptionPairList].sort(), 'SoD exception pairs (after valid mitigations)')
  const dormant = await sql(`SELECT DISTINCT u.userId AS userId FROM sox_Users u WHERE u.userType = 'DIALOG' AND u.locked = 0 AND u.lastLogon < date(?, '-${P.dormantDays} days')
    AND EXISTS (SELECT 1 FROM (${userCaps}) uc WHERE uc.userId = u.userId AND uc.privileged = 1) ORDER BY 1`, REF, REF, REF)
  assert.deepStrictEqual(dormant.map(d => d.userId), manifest['ITGC-AC-01'].dormantPrivilegedUsers, 'dormant privileged users')
  const pop = await sql(`SELECT COUNT(*) AS n FROM sox_Users WHERE userType = 'DIALOG' AND locked = 0`)
  assert.strictEqual(pop[0].n, manifest['ITGC-AC-01'].population.activeDialogUsers)
  console.log(`AC-01 ok: ${keys.length} conflict pairs, ${manifest['ITGC-AC-01'].sodExceptionPairs} exceptions, ${dormant.length} dormant privileged`)

  // 3. FIN-JE-01: manual journal review.
  const docs = await sql(`SELECT l.docNumber AS docNumber, l.postedBy AS postedBy, l.entryDate AS entryDate, l.amount AS amount, l.reviewedBy AS reviewedBy, p.closedAt AS closedAt,
      (SELECT userType FROM sox_Users WHERE userId = l.postedBy) AS posterType
    FROM sox_JournalLines l LEFT JOIN sox_PostingPeriods p ON p.fiscalYear = l.fiscalYear AND p.period = l.period
    WHERE l.lineItem = 1 AND l.source = 'MANUAL' AND l.fiscalYear = ? AND l.period IN (${P.quarter.periods.join(',')})`, P.quarter.fiscalYear)
  const weekday = d => new Date(d + 'T00:00:00Z').getUTCDay()
  const found = {}
  for (const d of docs) {
    const r = []
    if (d.posterType === 'FIREFIGHTER') r.push('FIREFIGHTER_POSTER')
    if (d.closedAt && d.entryDate > d.closedAt) r.push('AFTER_PERIOD_CLOSE')
    const amt = Number(d.amount)
    if (amt >= P.roundThreshold && Number.isInteger(amt) && amt % P.roundModulus === 0) r.push('ROUND_AMOUNT')
    if ([0, 6].includes(weekday(d.entryDate)) || P.holidays.includes(d.entryDate)) r.push('WEEKEND_OR_HOLIDAY')
    if (!d.reviewedBy || d.reviewedBy === d.postedBy) r.push('NO_INDEPENDENT_APPROVAL')
    if (r.length) found[d.docNumber] = r.sort()
  }
  const expectJe = Object.fromEntries(Object.entries(manifest['FIN-JE-01'].flagged).map(([k, v]) => [k, [...v].sort()]))
  assert.strictEqual(docs.length, manifest['FIN-JE-01'].population.manualDocuments, 'manual document population')
  assert.deepStrictEqual(found, expectJe, 'flagged manual journals and their reasons')
  console.log(`JE-01 ok: ${Object.keys(found).length} flagged of ${docs.length} manual documents`)

  // 4. ITGC-CM-01: production changes.
  const trs = await sql(`SELECT t.trkorr AS trkorr, t.owner AS owner, t.releasedAt AS releasedAt, t.priority AS priority, t.reviewedAt AS reviewedAt,
      k.ticketId AS tk, k.status AS status, k.approver AS approver, k.approvedAt AS approvedAt,
      julianday(t.reviewedAt) - julianday(t.releasedAt) AS reviewDays
    FROM sox_Transports t LEFT JOIN sox_ChangeTickets k ON k.ticketId = t.ticketId
    WHERE t.targetSystem = 'PRD' AND t.releasedAt >= ? AND t.releasedAt <= ?`, P.quarter.from, P.quarter.to)
  const foundCm = {}
  for (const t of trs) {
    const r = []
    if (!t.tk) r.push('NO_TICKET')
    else {
      if (t.status !== 'APPROVED') r.push('TICKET_NOT_APPROVED')
      if (t.approver === t.owner) r.push('SELF_APPROVED')
      if (t.approvedAt && t.approvedAt > t.releasedAt) r.push('APPROVED_AFTER_RELEASE')
    }
    if (t.priority === 'EMERGENCY') { if (!t.reviewedAt) r.push('EMERGENCY_NOT_REVIEWED'); else if (t.reviewDays > P.emergencyReviewDays) r.push('EMERGENCY_REVIEW_LATE') }
    if (r.length) foundCm[t.trkorr] = r.sort()
  }
  const expectCm = Object.fromEntries(Object.entries(manifest['ITGC-CM-01'].flagged).map(([k, v]) => [k, [...v].sort()]))
  assert.strictEqual(trs.length, manifest['ITGC-CM-01'].population.productionTransportsInQuarter, 'production transport population')
  assert.deepStrictEqual(foundCm, expectCm, 'flagged production changes and their reasons')
  console.log(`CM-01 ok: ${Object.keys(foundCm).length} exceptions of ${trs.length} production transports`)

  // 5. Decoys named in the manifest are not flagged by the oracle.
  for (const d of manifest['FIN-JE-01'].decoys) assert.ok(!found[d.doc], 'journal decoy flagged: ' + d.doc)
  for (const d of manifest['ITGC-CM-01'].decoys) assert.ok(!foundCm[d.trkorr], 'change decoy flagged: ' + d.trkorr)
  for (const d of ['AP009', 'AP010', 'AP012', 'AP013', 'AP014', 'BS002', 'BS004']) {
    assert.ok(!keys.some(k => k.startsWith(d + '|')) && !dormant.some(x => x.userId === d), 'access decoy flagged: ' + d)
  }
  console.log('decoys ok: none flagged')
  console.log('OK - seed')
  await cds.disconnect(); process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
