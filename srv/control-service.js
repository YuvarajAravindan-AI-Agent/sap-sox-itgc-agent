const cds = require('@sap/cds')
const { appendInRequest, appendOwnTx, verify, exportRows, dataVersion } = require('./audit')
const catalogue = require('./controls/catalogue')
const ac01 = require('./controls/ac01')
const crosscheck = require('./controls/ac01-crosscheck')
const je01 = require('./controls/je01'), je01x = require('./controls/je01-crosscheck')
const cm01 = require('./controls/cm01'), cm01x = require('./controls/cm01-crosscheck')
const { today, valid, lastCompletedQuarter } = require('./controls/dates')

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
      await appendInRequest(req, row(req, 'runControl', { controlId, referenceDate, period }, result, 'OK', 200,
        { dataVersion: result.dataVersion, asOf, reconciliation: result.reconciliation.status }))
      return JSON.stringify(result)
    })

    return super.init()
  }
}
