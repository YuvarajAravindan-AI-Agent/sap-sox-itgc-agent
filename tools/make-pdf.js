#!/usr/bin/env node
// Renders an evidence pack to a PDF for people. The pack stays the source of truth: run verify-pack.js first.
//   node tools/make-pdf.js evidence-pack.jsonl out.pdf
const fs = require('node:fs')
const PDFDocument = require('pdfkit')
const [file, out] = process.argv.slice(2)
if (!file || !out) { console.error('usage: make-pdf.js <pack.jsonl> <out.pdf>'); process.exit(2) }
const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
const header = lines.find(l => l.type === 'header'), narrative = lines.find(l => l.type === 'narrative').text
const doc = new PDFDocument({ size: 'LETTER', margin: 54, info: { Title: `${header.controlId} evidence, run ${header.runSeq}`, Subject: 'SOX 404 / ITGC test evidence' } })
doc.pipe(fs.createWriteStream(out))
doc.font('Helvetica-Bold').fontSize(15).text(`${header.controlId}: evidence pack`, { align: 'left' })
doc.font('Helvetica').fontSize(9).fillColor('#444').text(`Run seq ${header.runSeq} | run hash ${header.runHash.slice(0, 16)}... | chain rows ${header.chainRows} | generated ${header.generatedAt}`).moveDown(0.8)
doc.fillColor('#000').font('Courier').fontSize(8.5).text(narrative, { lineGap: 2 })
doc.moveDown(1).font('Helvetica').fontSize(8).fillColor('#444').text(`Verify the underlying pack offline: node tools/verify-pack.js <pack.jsonl>. Narrative SHA-256 ${header.narrativeSha256}.`)
doc.end()
