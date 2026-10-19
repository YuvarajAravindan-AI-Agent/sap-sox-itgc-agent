// The agent layer's logic, with the model and the control service injected so it can be tested without a network.
// What the language model may do: choose which control to run, and phrase the answer. What it may not do, enforced here in
// code and not by asking nicely: compute or invent figures, conclude that a control is effective, or hide a cross-check problem.
const MAX_STEPS = 6

const TOOLS = {
  list_controls: { desc: 'List the controls in the library: id, name, pass rule, population, and whether each can be run.', params: {} },
  run_control: {
    desc: 'Run one control over its full population and return the result and the exceptions. The result is test evidence only; it never says a control is effective.',
    params: { control_id: { type: 'string', description: 'ITGC-AC-01, FIN-JE-01 or ITGC-CM-01' }, reference_date: { type: 'string', description: 'yyyy-mm-dd, optional, default today' },
      period_start: { type: 'string', description: 'yyyy-mm-dd, optional, period controls only' }, period_end: { type: 'string', description: 'yyyy-mm-dd, optional, with period_start' } },
    required: ['control_id']
  }
}
const toolSpecs = Object.entries(TOOLS).map(([name, t]) => ({ type: 'function', function: { name, description: t.desc, parameters: { type: 'object', properties: t.params, required: t.required || [] } } }))

const SYSTEM = `You are an assistant for SOX 404 / IT general control testing on SAP, for a US company. You help a control owner or auditor run controls and understand the exceptions.
Rules you must follow:
- Every count, user id, document number, transport number and date you state MUST come from a tool result in this conversation. Never estimate, round, add up or compute anything yourself.
- To answer a question about a control, call run_control. Use list_controls to say what exists.
- You cannot and must not conclude that a control is effective, ineffective, compliant or passed. A run returns a TEST RESULT (PASS, EXCEPTIONS or NOT_CONCLUSIVE). Report it as that. Only a named human control owner can conclude, using the sign-off function, which you do not have.
- If the user asks you to mark, sign off, certify or conclude on a control, refuse and say who can.
- If reconciliation.status is MISMATCH, UNAVAILABLE, or the result is NOT_CONCLUSIVE, say so first and plainly. Never describe such a run as clean.
- If a tool returns an error, say so and do not guess.
- Plain text only, no Markdown. Be concise. Use the exact ids from the tool result.`

// ---- deterministic parts -------------------------------------------------------------------------------------------------
const SIGNOFF_ASK = /\b(mark|sign|sign[- ]?off|certify|attest|declare|conclude|approve|confirm)\b[^.?!]{0,60}\b(effective|compliant|compliance|passed|pass|ok|good|clean)\b/i
const EFFECTIVE_CLAIM = [
  /\b(control|controls|it)\b[^.?!]{0,50}\b(is|are|was|were|appears?|seems?|looks?)\b[^.?!]{0,25}\b(effective|compliant|adequate|clean|passed|operating effectively)\b/i,
  /\bsox[- ]?compliant\b/i, /\ball clear\b/i, /\b(i|we)\b[^.?!]{0,15}\b(have|'ve)?\s*(signed|certified|concluded|marked)\b/i, /\byou can (safely )?(sign|conclude|certify)\b/i
]
const NO_ISSUES = /\bno (issues|exceptions|findings|problems|conflicts)\b/i

const REFUSAL = 'I cannot mark, sign off, certify or conclude on a control. I only produce test results from deterministic code. A named control owner concludes using the sign-off function, on a specific audited run.'

function factLine(r) {
  const head = `${r.controlId}${r.runSeq ? ` (audit run ${r.runSeq})` : ''}, reference date ${r.referenceDate}${r.period ? `, period ${r.period.from} to ${r.period.to}` : ''}`
  let body
  if (r.controlId === 'ITGC-AC-01') body = `${r.sod.exceptionPairs} SoD exception pair(s) of ${r.sod.conflictPairs} conflict pair(s), ${r.dormantPrivileged.count} dormant privileged user(s), ${r.population.activeDialogUsers} users in population`
  else if (r.controlId === 'FIN-JE-01') body = `${r.flagged.count} flagged of ${r.population.manualDocuments} manual journal document(s)`
  else if (r.controlId === 'ITGC-CM-01') body = `${r.flagged.count} exception(s) of ${r.population.productionTransports} production transport(s)`
  else body = ''
  return `${head}: test result ${r.result}; ${body}; cross-check ${r.reconciliation.status}.`
}

// Everything the answer needs to be trustworthy, built from tool output only.
function guard(userText, text, trace) {
  const runs = trace.filter(t => t.tool === 'run_control' && t.status === 200 && t.result?.controlId).map(t => t.result)
  const facts = runs.map(factLine)
  const banners = []
  for (const r of runs) {
    if (r.reconciliation.status !== 'MATCH') banners.push(`${r.controlId}: the cross-check is ${r.reconciliation.status}; treat this run as unconfirmed.`)
    if (r.result === 'NOT_CONCLUSIVE') banners.push(`${r.controlId}: the run is NOT_CONCLUSIVE and must be repeated before anyone relies on it.`)
  }
  let reply = String(text || '').trim(), withheld = null
  const exceptional = runs.some(r => r.result !== 'PASS')
  if (EFFECTIVE_CLAIM.some(rx => rx.test(reply))) withheld = 'the wording claimed a control was effective or compliant'
  else if (exceptional && NO_ISSUES.test(reply)) withheld = 'the wording said there were no issues although a run has exceptions or is not conclusive'
  const allowed = new Set((JSON.stringify(trace.map(t => t.result)) + ' ' + userText).match(/\d[\d,]*(?:\.\d+)?/g)?.map(n => n.replace(/,/g, '')) || [])
  const stray = !withheld && (reply.match(/\d[\d,]*(?:\.\d+)?/g) || []).map(n => n.replace(/,/g, '')).filter(n => n.replace('.', '').length >= 2 && !allowed.has(n))
  if (withheld) reply = `I withheld my wording because ${withheld}. I cannot conclude on a control; a named control owner does that. The facts below come straight from the test run.`
  else if (stray.length) banners.push(`Some figures in the wording (${[...new Set(stray)].join(', ')}) could not be matched to the tool output; rely on the facts below.`)
  return { reply, facts, banners, withheld, strayFigures: stray || [] }
}

// ---- the loop -------------------------------------------------------------------------------------------------------------
async function runTool(controls, name, args, cid) {
  if (name === 'list_controls') return controls('listControls', {}, cid)
  if (name === 'run_control') {
    const q = { controlId: args.control_id }
    if (args.reference_date) q.referenceDate = args.reference_date
    if (args.period_start) q.periodStart = args.period_start
    if (args.period_end) q.periodEnd = args.period_end
    return controls('runControl', q, cid)
  }
  return { status: 400, result: { error: `unknown tool ${name}` } }
}

async function chat({ messages, cid, llm, controls }) {
  const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content || ''
  // A request to conclude is refused before the model is involved at all.
  if (SIGNOFF_ASK.test(lastUser)) return { reply: REFUSAL, facts: [], banners: [], withheld: null, refusedBeforeModel: true, trace: [] }

  const trace = [], convo = [{ role: 'system', content: SYSTEM }, ...messages]
  for (let step = 0; step < MAX_STEPS; step++) {
    const msg = await llm(convo, toolSpecs)
    convo.push(msg)
    if (!msg.tool_calls?.length) return { ...guard(lastUser, msg.content, trace), trace }
    for (const tc of msg.tool_calls) {
      let args = {}; try { args = JSON.parse(tc.function.arguments || '{}') } catch {}
      let out; try { out = await runTool(controls, tc.function.name, args, cid) } catch (e) { out = { status: 502, result: { error: e.message } } }
      trace.push({ tool: tc.function.name, args, status: out.status, result: out.result })
      convo.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(out.result) })
    }
  }
  return { ...guard(lastUser, 'I could not finish within the allowed number of tool steps.', trace), trace }
}

module.exports = { chat, guard, SYSTEM, TOOLS, toolSpecs, REFUSAL, factLine, SIGNOFF_ASK }
