// The audit chain, reused from sap-gov-sandbox: rows are chained, edits and deletions are detected, and an export verifies offline.
const cds = require('@sap/cds')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { boot } = require('./helpers')

;(async () => {
  await boot()
  const audit = require('../srv/audit')
  const entry = (tool, i) => ({ timestamp: new Date(Date.UTC(2026, 9, 19, 10, 0, i)).toISOString(), correlationID: 'conv-' + (i % 2), caller: 'test', endUser: 'analyst1',
    tool, input: JSON.stringify({ i }), output: JSON.stringify({ ok: true, i }), outcome: 'OK', httpStatus: 200, dataVersion: audit.dataVersion({ i }), asOf: new Date(Date.UTC(2026, 9, 19, 10, 0, i)).toISOString() })
  for (let i = 0; i < 6; i++) await audit.appendOwnTx(entry('runControl', i))
  let v = await audit.verify()
  assert.strictEqual(v.ok, true, JSON.stringify(v)); assert.strictEqual(v.rows, 6)
  console.log('chain ok:', v.rows, 'rows')

  const text = await audit.exportRows(1, 500)
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'auditexp-')), 'export.jsonl')
  fs.writeFileSync(file, text)
  const out = execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'verify-export.js'), file]).toString()
  assert.match(out, /^OK\s+6 rows/); console.log('offline verify:', out.trim())

  const rows = await cds.run(SELECT.from('sox.AuditLog').orderBy('seq'))
  const victim = rows[2]
  await cds.run(UPDATE('sox.AuditLog').set({ output: '{"tampered":true}' }).where({ ID: victim.ID }))
  v = await audit.verify(); assert.strictEqual(v.ok, false); assert.strictEqual(v.firstBadSeq, victim.seq)
  console.log('edit detected at seq', v.firstBadSeq)
  await cds.run(UPDATE('sox.AuditLog').set({ output: victim.output }).where({ ID: victim.ID }))
  assert.strictEqual((await audit.verify()).ok, true)
  await cds.run(DELETE.from('sox.AuditLog').where({ ID: rows[4].ID }))
  v = await audit.verify(); assert.strictEqual(v.ok, false); assert.strictEqual(v.firstBadSeq, rows[4].seq)
  console.log('deletion detected at seq', v.firstBadSeq)
  console.log('OK - chain')
  await cds.disconnect(); process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
