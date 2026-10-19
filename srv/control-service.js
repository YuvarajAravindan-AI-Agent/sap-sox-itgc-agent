const cds = require('@sap/cds')
const { appendInRequest, appendOwnTx, verify, exportRows, dataVersion, RULE_VERSION } = require('./audit')
const catalogue = require('./controls/catalogue')
const ac01 = require('./controls/ac01')
const crosscheck = require('./controls/ac01-crosscheck')
const je01 = require('./controls/je01'), je01x = require('./controls/je01-crosscheck')
const cm01 = require('./controls/cm01'), cm01x = require('./controls/cm01-crosscheck')
const { today, valid, lastCompletedQuarter } = require('./controls/dates')
const { buildNarrative } = require('./narrative')
const { sha } = require('./chain')

// Controls that can run now. Each: how to load its data, run it, and cross-check it.
const CONTROLS = {
  'ITGC-AC-01': {
    async load() {
      const { Users, RoleAssignments, RoleAuthorizations, Capabilities, SodRules, MitigatingControls } = cds.entities('sox')
      const sorted = (q, ...cols) => q.orderBy(...cols)
      return {
        users: await sorted(SELECT.from(Users), 'userId'),
        assignments: await sorted(SELECT.from(RoleAssignments), 'userId', 'role'),
        roleAuths: await sorted(SELECT.from(RoleAuthorizations), 'role', 'authObject', 'activity'),
        capabilities: await sorted(SELECT.from(Capabilities), 'capability'),
        sodRules: await sorted(SELECT.from(SodRules), 'ruleId'),
        mitigations: await sorted(SELECT.from(MitigatingControls), 'ID')
      }
    },
    run: (data, ref) => ac01.run(data, ref),
    reconcile: (result, data) => crosscheck.reconcile(result, data)
  },
  'FIN-JE-01': {
    async load(period) {
      const { JournalLines, PostingPeriods, Users } = cds.entities('sox')
      return {
        lines: await SELECT.from(JournalLines).where({ postingDate: { between: period.from, and: period.to } }).orderBy('docNumber', 'lineItem'),
        periods: await SELECT.from(PostingPeriods).orderBy('fiscalYear', 'period'),
        users: await SELECT.from(Users).orderBy('userId')
      }
    },
    run: (data, ref, period) => je01.run(data, ref, period),
    reconcile: (result, data) => je01x.reconcile(result, data)
  },
  'ITGC-CM-01': {
    async load() {
      const { Transports, ChangeTickets } = cds.entities('sox')
      return { transports: await SELECT.from(Transports).orderBy('trkorr'), tickets: await SELECT.from(ChangeTickets).orderBy('ticketId') }
    },
    run: (data, ref, period) => cm01.run(data, ref, period),
    reconcile: (result, data) => cm01x.reconcile(result, data)
  }
}

module.exports = class ControlService extends cds.ApplicationService {
  init() {
    const headersOf = req => ({ ...(cds.context?.headers || {}), ...(req.headers || {}) })
    const correlation = req => { const h = headersOf(req); return h['x-correlation-id'] || h['x-vcap-request-id'] || cds.context?.id || req.id || '' }
    const row = (req, tool, input, output, outcome, httpStatus, extra = {}) => ({
      timestamp: new Date().toISOString(), correlationID: String(correlation(req)).slice(0, 80), caller: req.user?.id || 'anonymous',
      endUser: (headersOf(req)['x-end-user'] || '').slice(0, 120) || null,
      tool, input: JSON.stringify(input), output: JSON.stringify(output), outcome, httpStatus, ...extra
    })

    // Failed requests roll their transaction back, so record them afterwards in their own transaction (401/403 are recorded by server.js).
    this.prepend(() => this.before('*', req => {
      req.on('failed', async err => {
        const status = Number(err.statusCode || err.status || err.code) || 500
        if (status === 401 || status === 403) return
        req._auditRelease?.()
        const tool = req.target?.name ? `${req.event} ${req.target.name}` : req.event
        try { await appendOwnTx(row(req, tool, { path: req.path, data: req.data }, { error: { code: err.code, message: err.message } }, 'ERROR', status)) }
        catch (e) { cds.log('audit').error('could not record failed request', e.message) }
      })
    }))

    this.on('verifyAuditChain', async () => JSON.stringify(await verify()))

    this.on('exportAudit', async req => {
      const { fromSeq, limit } = req.data
      const text = await exportRows(fromSeq, limit)
      const header = JSON.parse(text.slice(0, text.indexOf('\n')))
      await appendInRequest(req, row(req, 'exportAudit', { fromSeq, limit }, { rows: header.rows, headSeq: header.headSeq }, 'OK', 200,
        { dataVersion: dataVersion(header.headHash), asOf: new Date().toISOString() }))
      return text
    })


    // ---- human sign-off -------------------------------------------------------------------------------------------------
    // Rules: the signer is the authenticated user; a run is signed off once; an inconclusive run cannot be concluded effective;
    // a run with exceptions can be concluded effective only if the owner states they reviewed the exceptions and says why (20+ characters);
    // the signer cannot be the person on whose behalf the run was made.
    this.on('signOffControl', async req => {
      const { runSeq, conclusion, exceptionsReviewed, comment } = req.data
      const { Signoffs, AuditLog } = cds.entities('sox')
      if (!['EFFECTIVE', 'NOT_EFFECTIVE'].includes(conclusion)) return req.reject(400, 'conclusion must be EFFECTIVE or NOT_EFFECTIVE')
      const runRow = await SELECT.one.from(AuditLog).where({ seq: runSeq })
      if (!runRow) return req.reject(404, `No audit row with seq ${runSeq}`)
      if (runRow.tool !== 'runControl' || runRow.outcome !== 'OK') return req.reject(422, `Audit row ${runSeq} is not a successful control run`)
      const result = JSON.parse(runRow.output)
      const signer = req.user?.id
      if (!signer || signer === 'anonymous') return req.reject(401, 'A named user is required')
      if (runRow.endUser && runRow.endUser === signer) return req.reject(409, 'The signer cannot be the person the run was made for: sign-off must be independent')
      if (await SELECT.one.from(Signoffs).where({ runSeq })) return req.reject(409, `Run ${runSeq} already has a sign-off`)
      if (conclusion === 'EFFECTIVE') {
        if (result.result === 'NOT_CONCLUSIVE') return req.reject(422, 'This run was NOT_CONCLUSIVE (its cross-check did not agree or was unavailable); it cannot be concluded effective. Run it again.')
        if (result.result === 'EXCEPTIONS' && (!exceptionsReviewed || String(comment || '').trim().length < 20)) {
          return req.reject(422, 'This run has exceptions. To conclude EFFECTIVE, set exceptionsReviewed and explain the disposition in the comment (20+ characters).')
        }
      }
      const rec = { controlId: result.controlId, runSeq, runHash: runRow.hash, signedBy: signer, signedAt: new Date().toISOString(), conclusion, exceptionsReviewed: !!exceptionsReviewed, comment: String(comment || '').slice(0, 1000) }
      const audited = await appendInRequest(req, row(req, 'signOffControl', { runSeq, conclusion, exceptionsReviewed: !!exceptionsReviewed, comment: rec.comment }, rec, 'OK', 200,
        { dataVersion: runRow.dataVersion, asOf: rec.signedAt, endUser: signer }))
      await INSERT.into(Signoffs).entries({ ...rec, auditSeq: audited.seq })
      return JSON.stringify({ ...rec, auditSeq: audited.seq })
    })

    // ---- evidence pack --------------------------------------------------------------------------------------------------
    this.on('exportEvidence', async req => {
      const { runSeq } = req.data
      const { Signoffs, AuditLog } = cds.entities('sox')
      const runRow = await SELECT.one.from(AuditLog).where({ seq: runSeq })
      if (!runRow) return req.reject(404, `No audit row with seq ${runSeq}`)
      if (runRow.tool !== 'runControl' || runRow.outcome !== 'OK') return req.reject(422, `Audit row ${runSeq} is not a successful control run`)
      const result = JSON.parse(runRow.output)
      const so = await SELECT.one.from(Signoffs).where({ runSeq })
      let signoff = null, signRow = null
      if (so) {
        signRow = await SELECT.one.from(AuditLog).where({ seq: so.auditSeq })
        if (!signRow || signRow.tool !== 'signOffControl') return req.reject(409, 'Sign-off record has no matching audit row')
        signoff = JSON.parse(signRow.output)
        for (const k of ['controlId', 'runSeq', 'runHash', 'signedBy', 'conclusion', 'comment']) {
          if (String(so[k]) !== String(signoff[k])) return req.reject(409, `Sign-off table disagrees with its audit row on ${k}; refusing to export`)
        }
      }
      const upTo = Math.max(runSeq, signRow?.seq || 0)
      const chain = await SELECT.from(AuditLog).where({ seq: { '<=': upTo } }).orderBy('seq')
      const narrative = buildNarrative(result, signoff)
      const header = {
        type: 'header', format: 'sox-evidence-pack/1', generatedAt: new Date().toISOString(), service: RULE_VERSION,
        controlId: result.controlId, controlVersion: result.controlVersion, referenceDate: result.referenceDate, period: result.period || null,
        runSeq, runHash: runRow.hash, signoffSeq: signRow?.seq ?? null, chainRows: chain.length, anchoredAtGenesis: true, narrativeSha256: sha(narrative),
        howToVerify: 'node tools/verify-pack.js <file>: recomputes the audit hash chain from genesis, checks the run row, the result, the sign-off link and the narrative.'
      }
      const iso = v => (v == null ? null : new Date(v).toISOString())
      const lines = [header, ...chain.map(r => ({ type: 'row', ...r, timestamp: iso(r.timestamp), asOf: iso(r.asOf) })), { type: 'result', result }, { type: 'signoff', signoff }, { type: 'narrative', text: narrative }]
      await appendInRequest(req, row(req, 'exportEvidence', { runSeq }, { controlId: result.controlId, chainRows: chain.length, signoff: !!signoff }, 'OK', 200, { dataVersion: runRow.dataVersion, asOf: new Date().toISOString() }))
      return lines.map(l => JSON.stringify(l)).join('\n') + '\n'
    })

    this.on('listControls', async req => {
      const out = { controls: catalogue }
      await appendInRequest(req, row(req, 'listControls', {}, { controls: catalogue.map(c => c.controlId) }, 'OK', 200, { dataVersion: dataVersion(catalogue), asOf: new Date().toISOString() }))
      return JSON.stringify(out)
    })

    this.on('runControl', async req => {
      const { controlId } = req.data
      const entry = catalogue.find(c => c.controlId === controlId)
      if (!entry) return req.reject(404, `Unknown control ${controlId}`)
      const impl = CONTROLS[controlId]
      if (!entry.available || !impl) return req.reject(501, `Control ${controlId} is in the library but not available in this release`)
      const referenceDate = req.data.referenceDate || today()
      if (!valid(referenceDate)) return req.reject(400, `referenceDate must be a real date in yyyy-mm-dd form, got "${req.data.referenceDate}"`)

      // Period controls test one period; default is the last calendar quarter that has fully ended before the reference date.
      const { periodStart, periodEnd } = req.data
      for (const [n, v] of [['periodStart', periodStart], ['periodEnd', periodEnd]]) if (v && !valid(v)) return req.reject(400, `${n} must be a real date in yyyy-mm-dd form, got "${v}"`)
      if (!!periodStart !== !!periodEnd) return req.reject(400, 'give both periodStart and periodEnd, or neither')
      const period = periodStart ? { from: periodStart, to: periodEnd } : lastCompletedQuarter(referenceDate)
      if (period.from > period.to) return req.reject(400, 'periodStart is after periodEnd')

      const asOf = new Date().toISOString()
      const data = await impl.load(period)
      const result = impl.run(data, referenceDate, period)
      result.reconciliation = impl.reconcile(result, data)
      result.dataVersion = dataVersion(data)
      // A cross-check that disagrees or is unavailable can never leave the control looking clean.
      if (result.reconciliation.status !== 'MATCH' && result.result === 'PASS') result.result = 'NOT_CONCLUSIVE'
      result.notice = 'This is test evidence. It is not an assessment that the control is effective; only a named control owner can sign off.'
      const audited = await appendInRequest(req, row(req, 'runControl', { controlId, referenceDate, period }, result, 'OK', 200,
        { dataVersion: result.dataVersion, asOf, reconciliation: result.reconciliation.status }))
      // runSeq and runHash identify this run in the audit chain (a row cannot contain its own seq, so they are not in the audited output).
      return JSON.stringify({ ...result, runSeq: audited.seq, runHash: audited.hash })
    })

    return super.init()
  }
}
