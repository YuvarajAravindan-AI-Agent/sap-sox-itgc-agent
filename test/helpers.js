// Shared by the tests: an in-memory SQLite database deployed from db/schema.cds and loaded from db/data/*.csv.
const cds = require('@sap/cds')
const path = require('node:path')
module.exports.boot = async () => {
  process.chdir(path.join(__dirname, '..'))
  cds.env.requires.db = { kind: 'sqlite', credentials: { url: ':memory:' } }
  const model = cds.model = await cds.load('*')
  await cds.deploy(model).to('sqlite::memory:')
  return cds
}
