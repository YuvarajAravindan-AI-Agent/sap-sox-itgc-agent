#!/usr/bin/env node
// Deterministic synthetic SAP-shaped data for the SOX/ITGC controls, with planted, countable exceptions.
//   node seed/generate.js            writes db/data/sox-*.csv and seed/manifest.json
//   node seed/generate.js --out DIR  writes the same files elsewhere (used by the determinism test)
// Same seed, same bytes. Every exception the control tests must find is listed in manifest.json; decoys (rows that
// look suspicious but must NOT be flagged) are listed too. Names and ids are made up; nothing here is real data.
const fs = require('node:fs')
const path = require('node:path')

const REF_DATE = '2026-10-19'                   // "today" for the dormancy test
const PARAMS = {
  quarter: { fiscalYear: 2026, periods: [7, 8, 9], from: '2026-07-01', to: '2026-09-30', label: 'Q3 2026' },
  companyCode: '1000',
  dormantDays: 90,
  roundThreshold: 100000, roundModulus: 10000,  // manual journal "round amount": >= 100,000 and a multiple of 10,000
  holidays: ['2026-07-03', '2026-09-07'],       // US federal holidays observed in Q3 2026 (Independence Day observed, Labor Day)
  emergencyReviewDays: 5,                       // emergency change must be reviewed within this many calendar days of release
  referenceDate: REF_DATE
}

// ---- tiny deterministic PRNG (mulberry32) ------------------------------------------------------------------------------
let state = 20261019
const rnd = () => { state = (state + 0x6D2B79F5) | 0; let t = Math.imul(state ^ (state >>> 15), 1 | state); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1))
const pick = arr => arr[int(0, arr.length - 1)]

// ---- date helpers (UTC, ISO yyyy-mm-dd strings) ------------------------------------------------------------------------
const toDate = s => new Date(s + 'T00:00:00Z')
const fmt = d => d.toISOString().slice(0, 10)
const addDays = (s, n) => fmt(new Date(toDate(s).getTime() + n * 86400000))
const dow = s => toDate(s).getUTCDay()                           // 0 Sun .. 6 Sat
const isBusinessDay = s => dow(s) !== 0 && dow(s) !== 6 && !PARAMS.holidays.includes(s)
const businessDaysIn = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) if (isBusinessDay(d)) out.push(d); return out }
const Q3_BUSINESS_DAYS = businessDaysIn(PARAMS.quarter.from, PARAMS.quarter.to)
const periodOf = s => Number(s.slice(5, 7))                      // calendar fiscal year: period = month

// ---- reference data: capabilities, roles, SoD ruleset -----------------------------------------------------------------
const capabilities = [
  { capability: 'VENDOR_MAINTAIN', authObject: 'F_LFA1_BUK', activity: '02', privileged: true, description: 'Create or change vendor master records' },
  { capability: 'PAYMENT_RUN', authObject: 'F_REGU_BUK', activity: '01', privileged: true, description: 'Run and release automatic payments' },
  { capability: 'INVOICE_POST', authObject: 'F_BKPF_KOA', activity: '01', privileged: false, description: 'Post vendor invoices' },
  { capability: 'JOURNAL_POST', authObject: 'F_BKPF_BUK', activity: '01', privileged: false, description: 'Post general ledger journals' },
  { capability: 'JOURNAL_APPROVE', authObject: 'F_BKPF_BUK', activity: '43', privileged: true, description: 'Release or approve journals' },
  { capability: 'TRANSPORT_RELEASE', authObject: 'S_TRANSPRT', activity: '43', privileged: true, description: 'Release transports toward production' }
]
const cap = Object.fromEntries(capabilities.map(c => [c.capability, c]))
const rolesDef = {
  Z_AP_CLERK: ['INVOICE_POST'], Z_VENDOR_MASTER: ['VENDOR_MAINTAIN'], Z_PAYMENT_RUN: ['PAYMENT_RUN'],
  Z_GL_ACCOUNTANT: ['JOURNAL_POST'], Z_GL_APPROVER: ['JOURNAL_APPROVE'], Z_BASIS_TRANSPORT: ['TRANSPORT_RELEASE'],
  Z_AP_BAD_COMBO: ['VENDOR_MAINTAIN', 'PAYMENT_RUN'],                       // one badly designed role that carries a conflict by itself
  Z_FIREFIGHTER: ['VENDOR_MAINTAIN', 'PAYMENT_RUN', 'JOURNAL_POST', 'JOURNAL_APPROVE'],
  Z_DISPLAY: [], Z_DEVELOP: []
}
const roleAuthorizations = []
for (const [role, caps] of Object.entries(rolesDef)) {
  for (const c of caps) roleAuthorizations.push({ role, authObject: cap[c].authObject, activity: cap[c].activity })
}
roleAuthorizations.push({ role: 'Z_DISPLAY', authObject: 'S_TCODE', activity: '03' }, { role: 'Z_DEVELOP', authObject: 'S_DEVELOP', activity: '02' })

const sodRules = [
  { ruleId: 'SOD-P2P-01', capabilityA: 'VENDOR_MAINTAIN', capabilityB: 'PAYMENT_RUN', riskLevel: 'CRITICAL', description: 'Create or change a vendor and also release payments to it' },
  { ruleId: 'SOD-P2P-02', capabilityA: 'INVOICE_POST', capabilityB: 'PAYMENT_RUN', riskLevel: 'HIGH', description: 'Post a vendor invoice and also release the payment' },
  { ruleId: 'SOD-GL-01', capabilityA: 'JOURNAL_POST', capabilityB: 'JOURNAL_APPROVE', riskLevel: 'HIGH', description: 'Post a journal and also approve journals' }
]

// ---- users and role assignments ---------------------------------------------------------------------------------------
const users = [], assignments = [], decoys = { accessControl: [], journals: [], changes: [] }
const FIRST = ['Avery', 'Jordan', 'Riley', 'Morgan', 'Casey', 'Taylor', 'Quinn', 'Harper', 'Rowan', 'Emerson', 'Sage', 'Dakota', 'Reese', 'Skyler', 'Parker']
const LAST = ['Nguyen', 'Patel', 'Kim', 'Garcia', 'Johnson', 'Brooks', 'Rivera', 'Chen', 'Walker', 'Hughes', 'Foster', 'Murphy', 'Reed', 'Bailey', 'Cooper']
let nameCounter = 0
const nextName = () => `${FIRST[nameCounter % FIRST.length]} ${LAST[Math.floor(nameCounter++ / FIRST.length) % LAST.length]}`
const recentLogon = () => addDays(REF_DATE, -int(1, 40))
function user(userId, department, roles, over = {}) {
  users.push({ userId, fullName: over.fullName || nextName(), department, userType: 'DIALOG', locked: false, lastLogon: recentLogon(), validTo: '', ...over })
  for (const r of roles) assignments.push(typeof r === 'string' ? { userId, role: r, validFrom: '2025-01-01', validTo: '' } : { userId, validFrom: '2025-01-01', validTo: '', ...r })
}

// Ordinary users: no conflicts, recent logons.
for (let i = 1; i <= 5; i++) user('AP' + String(i).padStart(3, '0'), 'Accounts Payable', ['Z_AP_CLERK'])
for (let i = 1; i <= 2; i++) user('MD' + String(i).padStart(3, '0'), 'Master Data', ['Z_VENDOR_MASTER'])
for (const id of ['TR001', 'TR003']) user(id, 'Treasury', ['Z_PAYMENT_RUN'])
for (let i = 1; i <= 3; i++) user('GL' + String(i).padStart(3, '0'), 'General Ledger', ['Z_GL_ACCOUNTANT'])
for (const id of ['GL005', 'GL006']) user(id, 'General Ledger', ['Z_GL_APPROVER'])
for (let i = 1; i <= 4; i++) { if (i === 2) continue; user('BS' + String(i).padStart(3, '0'), 'Basis', ['Z_BASIS_TRANSPORT'], i === 4 ? { lastLogon: '2026-07-31' } : {}) }
for (let i = 1; i <= 6; i++) user('DV' + String(i).padStart(3, '0'), 'Development', ['Z_DEVELOP'])
for (const id of ['CM001', 'CM002']) user(id, 'Change Management', ['Z_DISPLAY'])
user('CTL001', 'Finance Controllership', ['Z_DISPLAY'])
for (let i = 1; i <= 20; i++) user('SD' + String(i).padStart(3, '0'), 'Sales', ['Z_DISPLAY'])
for (let i = 1; i <= 3; i++) user('FF0' + i, 'Firefighter', ['Z_FIREFIGHTER'], { userType: 'FIREFIGHTER', fullName: 'Firefighter ' + i })
user('SV01', 'Batch', [], { userType: 'SERVICE', fullName: 'Subledger batch interface', lastLogon: REF_DATE })

// Planted access-control exceptions (SoD conflicts, dormant privileged users) and the decoys that must not be flagged.
user('AP006', 'Accounts Payable', ['Z_VENDOR_MASTER', 'Z_PAYMENT_RUN'])                 // R1 via two roles
user('AP007', 'Accounts Payable', ['Z_AP_BAD_COMBO'])                                    // R1 via one bad role
user('AP008', 'Accounts Payable', ['Z_VENDOR_MASTER', 'Z_PAYMENT_RUN', 'Z_AP_CLERK'])    // R1 and R2
user('TR002', 'Treasury', ['Z_AP_CLERK', 'Z_PAYMENT_RUN'])                              // R2, valid mitigation
user('GL004', 'General Ledger', ['Z_GL_ACCOUNTANT', 'Z_GL_APPROVER'])                    // R3, mitigation expired
user('AP011', 'Accounts Payable', ['Z_PAYMENT_RUN'], { lastLogon: '2026-05-02' })        // dormant privileged (170 days)
user('MD003', 'Master Data', ['Z_VENDOR_MASTER'], { lastLogon: '2026-06-10' })           // dormant privileged (131 days)
// Decoys
user('AP009', 'Accounts Payable', ['Z_VENDOR_MASTER'])                                    // one side of a rule only
user('AP010', 'Accounts Payable', ['Z_VENDOR_MASTER', { role: 'Z_PAYMENT_RUN', validFrom: '2025-01-01', validTo: '2026-03-31' }])   // payment role expired
user('AP012', 'Accounts Payable', ['Z_VENDOR_MASTER', 'Z_PAYMENT_RUN'], { locked: true }) // conflict, but locked
user('AP013', 'Accounts Payable', ['Z_VENDOR_MASTER', { role: 'Z_PAYMENT_RUN', validFrom: '2026-11-01', validTo: '' }])              // payment role not yet valid
user('AP014', 'Accounts Payable', ['Z_AP_CLERK'], { lastLogon: '2026-02-10' })           // dormant, but not privileged
user('BS002', 'Basis', ['Z_BASIS_TRANSPORT'], { lastLogon: '2026-03-01', locked: true }) // dormant privileged, but locked
decoys.accessControl.push(
  { user: 'AP009', why: 'holds only one side of SOD-P2P-01' },
  { user: 'AP010', why: 'payment role expired 2026-03-31, no current conflict' },
  { user: 'AP012', why: 'conflict (SOD-P2P-01) but the user is locked' },
  { user: 'AP013', why: 'payment role starts 2026-11-01, no current conflict' },
  { user: 'AP014', why: 'dormant but holds no privileged capability' },
  { user: 'BS002', why: 'dormant privileged but locked' },
  { user: 'BS004', why: 'privileged, last logon 80 days before the reference date (under the 90 day limit)' },
  { user: 'FF01..FF03', why: 'firefighter ids are out of scope of this control (release 2)' })

const mitigations = [
  { ID: 'MIT-001', userId: 'TR002', ruleId: 'SOD-P2P-02', description: 'Treasury lead reviews every payment run report weekly', approvedBy: 'CTL001', validFrom: '2026-01-01', validTo: '2027-06-30' },
  { ID: 'MIT-002', userId: 'GL004', ruleId: 'SOD-GL-01', description: 'Controller second-reviews all self-approved journals', approvedBy: 'CTL001', validFrom: '2025-07-01', validTo: '2026-06-30' },
  { ID: 'MIT-003', userId: 'AP007', ruleId: 'SOD-P2P-02', description: 'Mitigation for a different rule, does not cover SOD-P2P-01', approvedBy: 'CTL001', validFrom: '2026-01-01', validTo: '2027-06-30' }
]

// ---- posting periods -------------------------------------------------------------------------------------------------
const closedAt = { 7: '2026-08-06', 8: '2026-09-08', 9: '2026-10-07' }
const postingPeriods = [1, 2, 3, 4, 5, 6].map(p => ({ fiscalYear: 2026, period: p, closedAt: `2026-${String(p + 1).padStart(2, '0')}-05` }))
for (const p of [7, 8, 9]) postingPeriods.push({ fiscalYear: 2026, period: p, closedAt: closedAt[p] })
postingPeriods.push({ fiscalYear: 2026, period: 10, closedAt: '' })

// ---- journals --------------------------------------------------------------------------------------------------------
const journalLines = []
let docSeq = 0
const money = n => (Math.round(n * 100) / 100).toFixed(2)
function doc(over) {
  const docNumber = '49' + String(++docSeq).padStart(8, '0')
  const d = { companyCode: PARAMS.companyCode, fiscalYear: 2026, source: 'MANUAL', currency: 'USD', reviewedBy: '', reviewedAt: '', ...over }
  d.period = periodOf(d.postingDate)
  journalLines.push(
    { docNumber, lineItem: 1, ...d, account: d.source === 'MANUAL' ? '400100' : '300200', debitCredit: 'D' },
    { docNumber, lineItem: 2, ...d, account: '113100', debitCredit: 'C' })
  return docNumber
}
const normalAmount = () => { let a; do { a = int(5000, 9999999) / 100 * (rnd() < 0.1 ? 8 : 1) } while (a >= PARAMS.roundThreshold && a % PARAMS.roundModulus === 0 || a % 1000 === 0); return money(a) }
const manualPosters = ['GL001', 'GL002', 'GL003'], reviewers = ['GL005', 'GL006']
const manualPlanted = {}   // docNumber -> reasons
const planted = (reasons, over) => { const n = doc({ source: 'MANUAL', ...over }); manualPlanted[n] = reasons; return n }

// Planted flagged manual journals.
planted(['FIREFIGHTER_POSTER'], { postedBy: 'FF01', postingDate: '2026-08-19', entryDate: '2026-08-19', amount: '18420.30', reviewedBy: 'GL005', reviewedAt: '2026-08-20' })
planted(['FIREFIGHTER_POSTER', 'WEEKEND_OR_HOLIDAY'], { postedBy: 'FF02', postingDate: '2026-07-10', entryDate: '2026-07-11', amount: '9150.75', reviewedBy: 'GL006', reviewedAt: '2026-07-13' })
planted(['AFTER_PERIOD_CLOSE'], { postedBy: 'GL001', postingDate: '2026-08-20', entryDate: '2026-09-15', amount: '31207.44', reviewedBy: 'GL005', reviewedAt: '2026-09-16' })
planted(['AFTER_PERIOD_CLOSE', 'NO_INDEPENDENT_APPROVAL'], { postedBy: 'GL002', postingDate: '2026-07-24', entryDate: '2026-08-12', amount: '6480.12' })
planted(['ROUND_AMOUNT'], { postedBy: 'GL002', postingDate: '2026-09-22', entryDate: '2026-09-22', amount: '250000.00', reviewedBy: 'GL005', reviewedAt: '2026-09-23' })
planted(['ROUND_AMOUNT', 'NO_INDEPENDENT_APPROVAL'], { postedBy: 'GL003', postingDate: '2026-07-21', entryDate: '2026-07-21', amount: '500000.00', reviewedBy: 'GL003', reviewedAt: '2026-07-22' })
planted(['WEEKEND_OR_HOLIDAY'], { postedBy: 'GL001', postingDate: '2026-08-14', entryDate: '2026-08-15', amount: '4321.55', reviewedBy: 'GL006', reviewedAt: '2026-08-17' })
planted(['WEEKEND_OR_HOLIDAY'], { postedBy: 'GL002', postingDate: '2026-09-04', entryDate: '2026-09-07', amount: '12840.10', reviewedBy: 'GL005', reviewedAt: '2026-09-08' })

// Manual decoys (look odd, must NOT be flagged).
const decoyDocs = {}
decoyDocs.closingDay = doc({ postedBy: 'GL001', postingDate: '2026-09-30', entryDate: '2026-10-07', amount: '7310.25', reviewedBy: 'GL005', reviewedAt: '2026-10-08' })
decoys.journals.push({ doc: decoyDocs.closingDay, why: 'entered on the closing day of period 9 (2026-10-07), not after it' })
decoyDocs.below = doc({ postedBy: 'GL003', postingDate: '2026-08-26', entryDate: '2026-08-26', amount: '90000.00', reviewedBy: 'GL006', reviewedAt: '2026-08-27' })
decoys.journals.push({ doc: decoyDocs.below, why: 'round (90,000.00) but under the 100,000 threshold' })
decoyDocs.large = doc({ postedBy: 'GL002', postingDate: '2026-08-27', entryDate: '2026-08-27', amount: '125000.00', reviewedBy: 'GL005', reviewedAt: '2026-08-28' })
decoys.journals.push({ doc: decoyDocs.large, why: '125,000.00 is over the threshold but not a multiple of 10,000' })

// Subledger decoys: look like every flag at once, but are not manual postings, so out of this control's population.
for (const [by, posting, entry, amount, why] of [
  ['FF02', '2026-07-28', '2026-08-22', '300000.00', 'subledger source: firefighter, weekend, after close, round, but not a manual posting'],
  ['SV01', '2026-09-30', '2026-10-03', '200000.00', 'subledger source: weekend, round, but not a manual posting'],
  ['FF03', '2026-08-12', '2026-09-07', '150000.00', 'subledger source: firefighter on a holiday, round, but not a manual posting']]) {
  decoys.journals.push({ doc: doc({ source: 'SUBLEDGER', postedBy: by, postingDate: posting, entryDate: entry, amount }), why })
}

// Ordinary manual and subledger documents.
const NORMAL_MANUAL = 150 - Object.keys(manualPlanted).length - 3        // total manual documents in the quarter is exactly 150
for (let i = 0; i < NORMAL_MANUAL; i++) {
  const entryDate = pick(Q3_BUSINESS_DAYS)
  doc({ postedBy: pick(manualPosters), postingDate: entryDate, entryDate, amount: normalAmount(), reviewedBy: pick(reviewers), reviewedAt: addDays(entryDate, int(1, 3)) })
}
for (let i = 0; i < 250; i++) {
  const entryDate = pick(Q3_BUSINESS_DAYS)
  doc({ source: 'SUBLEDGER', postedBy: 'SV01', postingDate: entryDate, entryDate, amount: normalAmount() })
}

// ---- transports and change tickets ----------------------------------------------------------------------------------
const transports = [], tickets = []
let trSeq = 0, tkSeq = 0
const devs = ['DV001', 'DV002', 'DV003', 'DV004', 'DV005', 'DV006'], approvers = ['CM001', 'CM002']
function ticket(over) { const ticketId = 'CHG' + String(1000 + ++tkSeq).padStart(7, '0'); tickets.push({ ticketId, requester: pick(devs), approver: pick(approvers), status: 'APPROVED', approvedAt: '', ...over }); return ticketId }
function transport(over) { const trkorr = 'PRDK9' + String(++trSeq).padStart(5, '0'); transports.push({ trkorr, owner: pick(devs), targetSystem: 'PRD', releasedAt: pick(Q3_BUSINESS_DAYS), priority: 'NORMAL', ticketId: '', description: 'Change ' + trkorr, reviewedBy: '', reviewedAt: '', ...over }); return trkorr }
const changePlanted = {}
const withTicket = (reason, over, ticketOver = {}) => {
  const releasedAt = over.releasedAt || pick(Q3_BUSINESS_DAYS)
  const t = ticket({ approvedAt: addDays(releasedAt, -int(1, 5)), ...ticketOver })
  const n = transport({ releasedAt, ticketId: t, ...over }); if (reason) changePlanted[n] = [reason]; return n
}
for (let i = 0; i < 32; i++) withTicket(null, {})
changePlanted[transport({ releasedAt: '2026-08-04', owner: 'DV001' })] = ['NO_TICKET']
changePlanted[transport({ releasedAt: '2026-08-18', owner: 'DV002', ticketId: 'CHG0009999' })] = ['NO_TICKET']
withTicket('TICKET_NOT_APPROVED', { releasedAt: '2026-07-14', owner: 'DV004' }, { status: 'DRAFT', approvedAt: '' })
withTicket('SELF_APPROVED', { releasedAt: '2026-09-09', owner: 'DV003' }, { approver: 'DV003' })
withTicket('APPROVED_AFTER_RELEASE', { releasedAt: '2026-08-25', owner: 'DV005' }, { approvedAt: '2026-08-27' })
withTicket('EMERGENCY_NOT_REVIEWED', { releasedAt: '2026-07-22', owner: 'DV006', priority: 'EMERGENCY' })
withTicket('EMERGENCY_REVIEW_LATE', { releasedAt: '2026-09-15', owner: 'DV002', priority: 'EMERGENCY', reviewedBy: 'CM001', reviewedAt: '2026-09-27' })
const okEmergency = withTicket(null, { releasedAt: '2026-09-02', owner: 'DV001', priority: 'EMERGENCY', reviewedBy: 'CM002', reviewedAt: '2026-09-05' })
decoys.changes.push({ trkorr: okEmergency, why: 'emergency change reviewed 3 days after release, inside the 5 day window' })
for (const [rel, target, why] of [['2026-08-11', 'DEV', 'DEV transport without a ticket: not production'], ['2026-08-12', 'QAS', 'QAS transport without a ticket: not production'],
  ['2026-06-26', 'PRD', 'production transport without a ticket, released before the quarter'], ['2026-10-02', 'PRD', 'production transport without a ticket, released after the quarter']]) {
  decoys.changes.push({ trkorr: transport({ releasedAt: rel, targetSystem: target, owner: 'DV001' }), why })
}

// ---- manifest (what the controls must find) ---------------------------------------------------------------------------
const reasonCounts = obj => Object.values(obj).flat().reduce((m, r) => (m[r] = (m[r] || 0) + 1, m), {})
const sodPairs = [['AP006', 'SOD-P2P-01'], ['AP007', 'SOD-P2P-01'], ['AP008', 'SOD-P2P-01'], ['AP008', 'SOD-P2P-02'], ['TR002', 'SOD-P2P-02'], ['GL004', 'SOD-GL-01']]
const mitigatedValid = ['TR002|SOD-P2P-02']
const sodExceptions = sodPairs.map(p => p.join('|')).filter(k => !mitigatedValid.includes(k))
const manualDocs = new Set(journalLines.filter(l => l.source === 'MANUAL').map(l => l.docNumber))
const manifest = {
  generatedBy: 'seed/generate.js', note: 'Synthetic data. Every number here is planted on purpose; control tests must reproduce them exactly.', parameters: PARAMS,
  'ITGC-AC-01': {
    population: { activeDialogUsers: users.filter(u => u.userType === 'DIALOG' && !u.locked).length },
    sodConflictPairs: sodPairs.length, sodConflictPairList: sodPairs.map(p => p.join('|')), validMitigations: mitigatedValid,
    sodExceptionPairs: sodExceptions.length, sodExceptionPairList: sodExceptions, sodExceptionUsers: [...new Set(sodExceptions.map(k => k.split('|')[0]))],
    dormantPrivilegedUsers: ['AP011', 'MD003'], decoys: decoys.accessControl
  },
  'FIN-JE-01': {
    population: { manualDocuments: manualDocs.size, totalDocuments: new Set(journalLines.map(l => l.docNumber)).size },
    flaggedDocuments: Object.keys(manualPlanted).length, flagged: manualPlanted, reasonCounts: reasonCounts(manualPlanted), decoys: decoys.journals
  },
  'ITGC-CM-01': {
    population: { productionTransportsInQuarter: transports.filter(t => t.targetSystem === 'PRD' && t.releasedAt >= PARAMS.quarter.from && t.releasedAt <= PARAMS.quarter.to).length },
    exceptions: Object.keys(changePlanted).length, flagged: changePlanted, reasonCounts: reasonCounts(changePlanted), decoys: decoys.changes
  }
}

// ---- write ------------------------------------------------------------------------------------------------------------
const csvCell = v => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
const csv = (rows, cols) => cols.join(',') + '\n' + rows.map(r => cols.map(c => csvCell(r[c])).join(',')).join('\n') + '\n'
const tables = {
  Users: [users, ['userId', 'fullName', 'department', 'userType', 'locked', 'lastLogon', 'validTo']],
  RoleAssignments: [assignments, ['userId', 'role', 'validFrom', 'validTo']],
  RoleAuthorizations: [roleAuthorizations, ['role', 'authObject', 'activity']],
  Capabilities: [capabilities, ['capability', 'authObject', 'activity', 'privileged', 'description']],
  SodRules: [sodRules, ['ruleId', 'capabilityA', 'capabilityB', 'riskLevel', 'description']],
  MitigatingControls: [mitigations, ['ID', 'userId', 'ruleId', 'description', 'approvedBy', 'validFrom', 'validTo']],
  PostingPeriods: [postingPeriods, ['fiscalYear', 'period', 'closedAt']],
  JournalLines: [journalLines, ['docNumber', 'lineItem', 'companyCode', 'fiscalYear', 'period', 'postingDate', 'entryDate', 'postedBy', 'source', 'account', 'debitCredit', 'amount', 'currency', 'reviewedBy', 'reviewedAt']],
  Transports: [transports, ['trkorr', 'owner', 'targetSystem', 'releasedAt', 'priority', 'ticketId', 'description', 'reviewedBy', 'reviewedAt']],
  ChangeTickets: [tickets, ['ticketId', 'requester', 'approver', 'status', 'approvedAt']]
}
const outIdx = process.argv.indexOf('--out')
const outDir = outIdx > 0 ? path.resolve(process.argv[outIdx + 1]) : path.join(__dirname, '..', 'db', 'data')
const manifestPath = outIdx > 0 ? path.join(outDir, 'manifest.json') : path.join(__dirname, 'manifest.json')
fs.mkdirSync(outDir, { recursive: true })
for (const [name, [rows, cols]] of Object.entries(tables)) fs.writeFileSync(path.join(outDir, `sox-${name}.csv`), csv(rows, cols))
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log(Object.entries(tables).map(([n, [r]]) => `${n}:${r.length}`).join(' '))
console.log(`AC-01 exception pairs ${manifest['ITGC-AC-01'].sodExceptionPairs}, JE-01 flagged ${manifest['FIN-JE-01'].flaggedDocuments}/${manifest['FIN-JE-01'].population.manualDocuments}, CM-01 exceptions ${manifest['ITGC-CM-01'].exceptions}/${manifest['ITGC-CM-01'].population.productionTransportsInQuarter}`)
