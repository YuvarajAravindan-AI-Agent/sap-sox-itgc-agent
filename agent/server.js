const express = require('express')
const crypto = require('node:crypto')
const { chat } = require('./lib')

const PORT = process.env.PORT || 8080
const LLM_BASE = process.env.LLM_BASE_URL || 'https://vertex-gateway-714593281128.us-central1.run.app/v1beta/openai'
const LLM_MODEL = process.env.LLM_MODEL || 'gemini-3.8-flash'
const LLM_KEY = process.env.LLM_API_KEY
const DEST = process.env.CONTROLS_DEST || 'SoxControlService'

// Access control for the chat page itself (the control service has its own XSUAA).
const USER = process.env.ACCESS_USER, PASS = process.env.ACCESS_PASSWORD
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y) }
function gate(req, res, next) {
  if (!USER || !PASS) return res.status(503).send('ACCESS_USER / ACCESS_PASSWORD not configured')
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '')
  const [u = '', p = ''] = m ? Buffer.from(m[1], 'base64').toString().split(/:(.*)/s) : []
  if (m && safeEq(u, USER) && safeEq(p, PASS)) return next()
  res.set('WWW-Authenticate', 'Basic realm="SOX control agent"').status(401).send('Authentication required')
}

// Where the control service lives: a BTP destination on Cloud Foundry, or a direct URL for local testing.
let destCache
async function target() {
  if (process.env.CONTROLS_BASE && process.env.CONTROLS_BEARER_FILE) {   // demo/local use against the deployed service: a client-credentials token kept in a 0600 file
    const t = JSON.parse(require('node:fs').readFileSync(process.env.CONTROLS_BEARER_FILE, 'utf8')).access_token
    return { base: process.env.CONTROLS_BASE, headers: { Authorization: 'Bearer ' + t } }
  }
  if (process.env.CONTROLS_BASE) {
    const h = process.env.CONTROLS_BASIC ? { Authorization: 'Basic ' + Buffer.from(process.env.CONTROLS_BASIC).toString('base64') } : {}
    return { base: process.env.CONTROLS_BASE, headers: h }
  }
  if (destCache && destCache.exp > Date.now()) return destCache.v
  const c = JSON.parse(process.env.VCAP_SERVICES).destination[0].credentials
  const t = await fetch(c.url + '/oauth/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${c.clientid}:${c.clientsecret}`).toString('base64') }, body: 'grant_type=client_credentials' })
  const token = (await t.json()).access_token
  const r = await fetch(`${c.uri}/destination-configuration/v1/destinations/${DEST}`, { headers: { Authorization: 'Bearer ' + token } })
  if (!r.ok) throw new Error(`destination ${DEST} lookup failed (${r.status})`)
  const d = await r.json(), auth = (d.authTokens || [])[0]
  if (!auth || auth.error) throw new Error(`destination ${DEST}: no usable token (${auth && auth.error})`)
  const v = { base: d.destinationConfiguration.URL, headers: { Authorization: auth.http_header.value } }
  destCache = { v, exp: Date.now() + 4 * 60 * 1000 }
  return v
}

// The control service client. Only listControls and runControl are ever called from here: the agent has no path to sign-off or evidence export.
const q = v => `'${String(v).replace(/'/g, "''")}'`
async function controls(fn, params, cid) {
  const { base, headers } = await target()
  const args = Object.entries(params).map(([k, v]) => `${k}=${q(v)}`).join(',')
  const r = await fetch(`${base.replace(/\/$/, '')}/${fn}(${args})`, { headers: { ...headers, 'x-correlation-id': cid, 'x-end-user': USER || 'anonymous' }, signal: AbortSignal.timeout(30000) })
  const body = await r.json().catch(() => ({}))
  if (!r.ok) return { status: r.status, result: { error: body.error?.message || `HTTP ${r.status}` } }
  return { status: r.status, result: typeof body.value === 'string' ? JSON.parse(body.value) : body }
}

async function llm(messages, tools) {
  const r = await fetch(LLM_BASE.replace(/\/$/, '') + '/chat/completions', { method: 'POST', signal: AbortSignal.timeout(120000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + LLM_KEY },
    body: JSON.stringify({ model: LLM_MODEL, messages, tools, temperature: 0 }) })
  if (!r.ok) throw new Error(`LLM HTTP ${r.status}`)
  return (await r.json()).choices[0].message
}

if (require.main === module) {
  const app = express()
  app.use(express.json({ limit: '100kb' }))
  const localDemo = process.env.LOCAL_DEMO_NO_GATE === '1'   // demo captures only: no login page, and the server binds to 127.0.0.1 so nothing else can reach it
  if (!localDemo) app.use(gate)
  app.use(express.static(__dirname + '/public'))
  app.post('/api/chat', async (req, res) => {
    try {
      if (!LLM_KEY) throw new Error('LLM_API_KEY not configured')
      const raw = String(req.body.conversationId || crypto.randomUUID()).replace(/[^\w-]/g, '')
      const cid = 'conv-' + raw.replace(/^(conv-)+/, '').slice(0, 40)
      const messages = (req.body.messages || []).filter(m => ['user', 'assistant'].includes(m.role)).map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) })).slice(-20)
      res.json({ conversationId: cid, ...(await chat({ messages, cid, llm, controls })) })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
  if (localDemo) app.listen(PORT, '127.0.0.1', () => console.log('sox agent (local demo, no gate) on 127.0.0.1:' + PORT))
  else app.listen(PORT, () => console.log('sox agent listening on', PORT))
}
module.exports = { controls, llm }
