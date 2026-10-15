import test from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, strToU8, deflateSync } from 'fflate'

const d = await import('./docs.ts')

const pdfDoc = (streamBody, dict = '<< /Length 0 >>', pages = 1) => {
  const text = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count ${pages} >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
4 0 obj ${dict} stream\n${streamBody}\nendstream endobj
`
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
  return out
}

test('pdfContentText reads Tj, TJ kerning and hex strings', () => {
  assert.equal(d.pdfContentText('BT (Hello) Tj ET'), 'Hello')
  assert.equal(d.pdfContentText('BT [(He) -200 (llo)] TJ ET'), 'He llo')
  assert.equal(d.pdfContentText('BT <48656C6C6F> Tj ET'), 'Hello')
  assert.equal(d.pdfContentText('BT (a\\(b\\)) Tj ET'), 'a(b)')
  assert.equal(d.pdfContentText('BT (caf\\351) Tj ET'), 'café')
})

test('extractPdfText handles plain and flated streams and counts pages', () => {
  const plain = d.extractPdfText(pdfDoc('BT (Hello PDF) Tj ET'))
  assert.equal(plain.pages, 1)
  assert.match(plain.text, /Hello PDF/)
  const comp = deflateSync(strToU8('BT (Flated text) Tj ET'))
  let bin = ''
  for (const b of comp) bin += String.fromCharCode(b)
  const flated = d.extractPdfText(pdfDoc(bin, '<< /Length 0 /Filter /FlateDecode >>'))
  assert.match(flated.text, /Flated text/)
  assert.deepEqual(d.extractPdfText(new Uint8Array([1, 2, 3])), { text: '', pages: 0 })
})

test('extractDocx reads paragraphs across runs', () => {
  const zip = zipSync({ 'word/document.xml': strToU8('<w:document><w:body><w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:t>docx</w:t></w:r></w:p><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:body></w:document>') })
  const { text, paragraphs } = d.extractDocx(zip)
  assert.equal(paragraphs, 2)
  assert.match(text, /Hello docx/)
  assert.match(text, /Second/)
  assert.throws(() => d.extractDocx(zipSync({ 'other.txt': strToU8('x') })), /Word document/)
})

test('extractOdt, extractRtf, extractXlsx and extractPptx read text', () => {
  const odt = zipSync({ 'content.xml': strToU8('<office:body><office:text><text:p>Hello <text:s text:c="2"/>odt</text:p></office:text></office:body>') })
  assert.match(d.extractOdt(odt).text, /Hello\s+odt/)
  assert.match(d.extractRtf('{\\rtf1\\ansi Hello\\par World}').replace(/\s+/g, ' ').trim(), /^Hello World$/)
  assert.match(d.extractRtf('plain \\b bold'), /plain bold/)
  const xlsx = zipSync({
    'xl/sharedStrings.xml': strToU8('<sst><si><t>Name</t></si><si><t>Ann</t></si></sst>'),
    'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row><c><v>42</v></c></row></sheetData></worksheet>'),
  })
  const sheet = d.extractXlsx(xlsx)
  assert.equal(sheet.sheets, 1)
  assert.match(sheet.text, /Name, Ann/)
  assert.match(sheet.text, /42/)
  const pptx = zipSync({ 'ppt/slides/slide1.xml': strToU8('<p:sld><p:cSld><p:spTree><a:t>Slide one</a:t></p:spTree></p:cSld></p:sld>') })
  const deck = d.extractPptx(pptx)
  assert.equal(deck.slides, 1)
  assert.match(deck.text, /Slide one/)
})

test('unpackZip filters junk and caps entries', () => {
  const zip = zipSync({ 'a.txt': strToU8('a'), '__MACOSX/x': strToU8('j'), 'sub/b.md': strToU8('b') })
  const { entries, skipped } = d.unpackZip(zip)
  assert.equal(entries.length, 2)
  assert.equal(skipped, 1)
  assert.throws(() => d.unpackZip(zipSync({ '__MACOSX/x': strToU8('j') })), /No readable files/)
})

test('expandArchives turns zips into files with notices', async () => {
  const zip = zipSync({ 'a.txt': strToU8('a'.repeat(10)) })
  const zf = new File([zip], 'bundle.zip', { type: 'application/zip' })
  const { files, notices } = await d.expandArchives([zf], { archives: true })
  assert.equal(files.length, 1)
  assert.equal(files[0].name, 'a.txt')
  assert.ok(notices.some((n) => /unpacked 1 files/))
  const plain = new File(['x'], 'x.txt', { type: 'text/plain' })
  assert.deepEqual((await d.expandArchives([plain], { archives: false })).files, [plain])
})

test('fitDoc prefers line boundaries and always marks truncation', () => {
  assert.deepEqual(d.fitDoc('short', 100), { text: 'short', truncated: false })
  const md = `# Title\n${'x'.repeat(90)}\n## Next\n${'y'.repeat(90)}`
  const fit = d.fitDoc(md, 100)
  assert.equal(fit.truncated, true)
  assert.match(fit.text, /^# Title/)
  assert.doesNotMatch(fit.text, /## Next/)
  assert.match(fit.text, /truncated: kept/)
})

test('pairTranscripts merges matching transcripts into media', () => {
  const { atts, notices } = d.pairTranscripts([
    { name: 'talk.mp3', kind: 'media' },
    { name: 'talk.vtt', kind: 'txt', text: 'WEBVTT caps' },
    { name: 'notes.txt', kind: 'txt', text: 'standalone' },
  ])
  assert.equal(atts.length, 2)
  assert.match(atts[0].text ?? '', /transcript of talk\.mp3/)
  assert.ok(notices.some((n) => /Paired transcript/.test(n)))
  const solo = d.pairTranscripts([{ name: 'clip.mp4', kind: 'media' }])
  assert.equal(solo.atts.length, 1)
  assert.equal(solo.atts[0].text, undefined)
})

test('normDocs fills safe defaults and clamps budgets', () => {
  assert.deepEqual(d.normDocs(null), d.BLANK_DOCS)
  assert.equal(d.normDocs({ ocr: 'always', perFileChars: 999999 }).perFileChars, 200000)
  assert.equal(d.normDocs({ ocr: 'bogus' }).ocr, 'auto')
  assert.equal(d.normDocs({ pdfText: false }).pdfText, false)
})
