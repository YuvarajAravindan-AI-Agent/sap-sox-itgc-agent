// Date handling for the controls: ISO yyyy-mm-dd strings, UTC, no time zones. Empty or missing becomes null.
const norm = v => (v === undefined || v === null || v === '' ? null : String(v).slice(0, 10))
const day = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))
const daysBetween = (from, to) => Math.round((day(to) - day(from)) / 86400000)
const today = () => new Date().toISOString().slice(0, 10)
const valid = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(day(s)) && new Date(day(s)).toISOString().slice(0, 10) === s
module.exports = { norm, day, daysBetween, today, valid }
