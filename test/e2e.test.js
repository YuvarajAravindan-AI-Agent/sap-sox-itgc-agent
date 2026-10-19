// Real server, real auth path (mocked users): success, rejected input, wrong scope (403) and no credentials (401), all audited.
const { spawn } = require('node:child_process')
const assert = require('node:assert')
const PORT = 4720
const base = `http://localhost:${PORT}/controls/`
const basic = (u, p) => ({ Authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64') })

;(async () => {
  const srv = spawn('npx', ['cds-serve', '--port', String(PORT)], { cwd: __dirname + '/..', stdio: 'ignore', detached: true, env: { ...process.env, NODE_ENV: 'development' } })
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(base); break } catch { await new Promise(r => setTimeout(r, 500)) } }
    const get = (p, h) => fetch(base + p, { headers: h })
    const agent = basic('agent', 'agent'), auditor = basic('auditor', 'auditor')

    const ok = await get("runControl(controlId='ITGC-AC-01',referenceDate='2026-10-19')", { ...agent, 'x-correlation-id': 'conv-e2e', 'x-end-user': 'analyst1' })
    assert.strictEqual(ok.status, 200)
    const res = JSON.parse((await ok.json()).value)
    assert.strictEqual(res.result, 'EXCEPTIONS'); assert.strictEqual(res.sod.exceptionPairs, 5); assert.strictEqual(res.reconciliation.status, 'MATCH')
    const je = await get("runControl(controlId='FIN-JE-01',referenceDate='2026-10-19')", agent); assert.strictEqual(je.status, 200)
    assert.strictEqual(JSON.parse((await je.json()).value).flagged.count, 8)
    const cm = await get("runControl(controlId='ITGC-CM-01',referenceDate='2026-10-19')", agent); assert.strictEqual(cm.status, 200)
    assert.strictEqual(JSON.parse((await cm.json()).value).flagged.count, 7)
    assert.strictEqual((await get("runControl(controlId='ITGC-AC-01',referenceDate='not-a-date')", agent)).status, 400)
    assert.strictEqual((await get("runControl(controlId='ITGC-AC-01',referenceDate='2026-10-19')", auditor)).status, 403)   // auditors cannot run controls
    assert.strictEqual((await get("runControl(controlId='ITGC-AC-01',referenceDate='2026-10-19')")).status, 401)
    assert.strictEqual((await get('AuditLog', agent)).status, 403)                                                           // agents cannot read the trail
    assert.strictEqual((await get('verifyAuditChain()', agent)).status, 403)
    await new Promise(r => setTimeout(r, 500))

    const rows = (await (await get('AuditLog?$orderby=timestamp', auditor)).json()).value
    console.log(rows.map(r => `${r.tool.slice(0, 40)}|${r.caller}|${r.outcome}/${r.httpStatus}`).join('\n'))
    assert.ok(rows.find(r => r.outcome === 'OK' && r.tool === 'runControl' && r.correlationID === 'conv-e2e' && r.endUser === 'analyst1'), 'run audited with correlation and end user')
    assert.ok(rows.find(r => r.outcome === 'ERROR' && r.httpStatus === 400), '400 audited')
    assert.ok(rows.find(r => r.outcome === 'DENIED' && r.httpStatus === 403 && r.caller === 'auditor'), '403 audited with caller')
    assert.ok(rows.find(r => r.outcome === 'DENIED' && r.httpStatus === 401 && r.caller === 'unauthenticated'), '401 audited')
    const chain = JSON.parse((await (await get('verifyAuditChain()', auditor)).json()).value)
    assert.ok(chain.ok && chain.rows >= 5, JSON.stringify(chain))
    const exp = await get('exportAudit(fromSeq=1,limit=50)', auditor); assert.strictEqual(exp.status, 200)
    assert.strictEqual(JSON.parse(JSON.parse(await exp.text()).value.split('\n')[0]).format, 'gov-audit-export/1')
    console.log('OK - e2e: run, 400, 403, 401 audited; chain intact; export works')
  } finally { try { process.kill(-srv.pid) } catch {} }
  process.exit(0)
})().catch(e => { console.error(e); process.exit(1) })
