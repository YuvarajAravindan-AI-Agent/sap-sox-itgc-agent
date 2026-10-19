#!/usr/bin/env node
// Verifies an evidence pack offline: no SAP system, no database, no network.
//   node tools/verify-pack.js evidence-pack.jsonl
// Exit 0 = everything checks out, 1 = something is wrong (the first problem is printed), 2 = usage.
const fs = require('node:fs')
const assert = require('node:assert')
const { verifyRows, GENESIS } = require('../srv/chain')
const { buildNarrative } = require('../srv/narrative')
const crypto = require('node:crypto')
const sha = s => crypto.createHash('sha256').update(s).digest('hex')

const file = process.argv[2]
if (!file) { console.error('usage: verify-pack.js <pack.jsonl>'); process.exit(2) }
try {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  const header = lines.find(l => l.type === 'header')
  if (!header || header.format !== 'sox-evidence-pack/1') throw new Error('not a sox-evidence-pack/1 file')
  const rows = lines.filter(l => l.type === 'row'), result = lines.find(l => l.type === 'result')?.result
  const signoff = lines.find(l => l.type === 'signoff')?.signoff ?? null, narrative = lines.find(l => l.type === 'narrative')?.text
  if (!result || narrative === undefined) throw new Error('pack is missing its result or narrative')
  if (rows.length !== header.chainRows) throw new Error(`header says ${header.chainRows} chain rows, file has ${rows.length}`)

  const chain = verifyRows(rows, { seq: 1, prevHash: GENESIS })
  if (!chain.ok) throw new Error(`audit chain broken at seq ${chain.firstBadSeq}: ${chain.reason}`)

  const run = rows.find(r => r.seq === header.runSeq)
  if (!run) throw new Error('the run row is not in the chain segment')
  if (run.hash !== header.runHash) throw new Error('run row hash differs from the header')
  if (run.tool !== 'runControl' || run.outcome !== 'OK') throw new Error('the row is not a successful control run')
  assert.deepStrictEqual(JSON.parse(run.output), result, 'result does not equal the audited run output')
  if (result.controlId !== header.controlId) throw new Error('control id differs between header and result')

  if (header.signoffSeq === null) {
    if (signoff) throw new Error('a sign-off is attached but the header says there is none')
  } else {
    const s = rows.find(r => r.seq === header.signoffSeq)
    if (!s || s.tool !== 'signOffControl') throw new Error('sign-off row missing from the chain segment')
    assert.deepStrictEqual(JSON.parse(s.output), signoff, 'sign-off does not equal the audited sign-off output')
    if (signoff.runHash !== run.hash || signoff.runSeq !== run.seq) throw new Error('sign-off does not refer to this run (hash or seq differs)')
    if (run.endUser && signoff.signedBy === run.endUser) throw new Error('signer is the person the run was made for: not independent')
    if (signoff.conclusion === 'EFFECTIVE' && result.result === 'NOT_CONCLUSIVE') throw new Error('an inconclusive run was concluded effective')
  }
  const expected = buildNarrative(result, signoff)
  if (narrative !== expected) throw new Error('narrative differs from the one regenerated from the result')
  if (sha(narrative) !== header.narrativeSha256) throw new Error('narrative hash differs from the header')

  console.log(`OK  ${header.controlId} run seq ${header.runSeq} (${result.result}), chain ${rows.length} rows intact from genesis, ${signoff ? `signed off by ${signoff.signedBy}: ${signoff.conclusion}` : 'no sign-off'}`)
  process.exit(0)
} catch (e) { console.log('FAILED: ' + e.message.split('\n')[0]); process.exit(1) }
