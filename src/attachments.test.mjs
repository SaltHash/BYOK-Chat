import test from 'node:test'
import assert from 'node:assert/strict'

const a = await import('../src/attachments.ts')

test('the model is shown neutral names while the real name is kept for the UI', () => {
  const files = a.anonymizeAttachmentNames([
    { name: 'Acme merger plan.png', kind: 'img' },
    { name: 'Jane Doe passport.jpg', kind: 'img' },
    { name: 'Q3 payroll.pdf', kind: 'pdf' },
    { name: 'notes.txt', kind: 'txt' },
  ])
  assert.deepEqual(files.map((f) => f.modelName), ['image-1.png', 'image-2.jpg', 'file-1.pdf', 'file-2.txt'])
  assert.deepEqual(files.map((f) => f.name), ['Acme merger plan.png', 'Jane Doe passport.jpg', 'Q3 payroll.pdf', 'notes.txt'])
  assert.equal(a.promptNameOf(files[0]), 'image-1.png')
})

test('an image without a usable extension still gets one, and the input is untouched', () => {
  const input = [{ name: 'Screenshot 2026-10-28 at 09.14.22', kind: 'img' }]
  const out = a.anonymizeAttachmentNames(input)
  assert.equal(out[0].modelName, 'image-1.png')
  assert.equal(input[0].modelName, undefined)
})

test('the attachment manifest uses the neutral names only', () => {
  const files = a.anonymizeAttachmentNames([{ name: 'secret.pdf', kind: 'pdf' }])
  const manifest = a.attachmentManifest(files)
  assert.match(manifest, /file-1\.pdf/)
  assert.doesNotMatch(manifest, /secret/)
})
