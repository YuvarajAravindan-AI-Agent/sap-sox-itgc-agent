// Date handling for the controls: ISO yyyy-mm-dd strings, UTC, no time zones. Empty or missing becomes null.
const norm = v => (v === undefined || v === null || v === '' ? null : String(v).slice(0, 10))
const day = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))
const daysBetween = (from, to) => Math.round((day(to) - day(from)) / 86400000)
const today = () => new Date().toISOString().slice(0, 10)
const valid = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(day(s)) && new Date(day(s)).toISOString().slice(0, 10) === s
module.exports = { norm, day, daysBetween, today, valid }

// ---- calendar helpers shared by the period controls ----
const iso = ms => new Date(ms).toISOString().slice(0, 10)
const addDays = (s, n) => iso(day(s) + n * 86400000)
// The last calendar quarter that has fully ended before the reference date (a quarter ending on the reference date is not yet complete).
function lastCompletedQuarter(ref) {
  const y = +ref.slice(0, 4), q = Math.floor((+ref.slice(5, 7) - 1) / 3)          // current quarter 0..3
  const [py, pq] = q === 0 ? [y - 1, 3] : [y, q - 1]
  const startMonth = pq * 3 + 1
  const from = `${py}-${String(startMonth).padStart(2, '0')}-01`
  const to = addDays(`${py + (startMonth + 3 > 12 ? 1 : 0)}-${String(((startMonth + 2) % 12) + 1).padStart(2, '0')}-01`, -1)
  return { from, to }
}
// US federal holidays (observed): a Saturday holiday is observed on the Friday before, a Sunday holiday on the Monday after.
function usHolidays(year) {
  const nth = (m, wd, n) => { let d = `${year}-${String(m).padStart(2, '0')}-01`; while (new Date(day(d)).getUTCDay() !== wd) d = addDays(d, 1); return addDays(d, 7 * (n - 1)) }
  const last = (m, wd) => { let d = addDays(`${year + (m === 12 ? 1 : 0)}-${String((m % 12) + 1).padStart(2, '0')}-01`, -1); while (new Date(day(d)).getUTCDay() !== wd) d = addDays(d, -1); return d }
  const fixed = [`${year}-01-01`, `${year}-06-19`, `${year}-07-04`, `${year}-11-11`, `${year}-12-25`]
  const observed = fixed.map(d => { const w = new Date(day(d)).getUTCDay(); return w === 6 ? addDays(d, -1) : w === 0 ? addDays(d, 1) : d })
  return [...observed, nth(1, 1, 3), nth(2, 1, 3), last(5, 1), nth(9, 1, 1), nth(10, 1, 2), nth(11, 4, 4)].sort()
}
const holidaySet = (from, to) => { const s = new Set(); for (let y = +from.slice(0, 4) - 1; y <= +to.slice(0, 4) + 1; y++) usHolidays(y).forEach(h => s.add(h)); return s }
Object.assign(module.exports, { addDays, lastCompletedQuarter, usHolidays, holidaySet })
