import test from 'node:test'
import assert from 'node:assert/strict'

const { sanitizePath, parseWorkspaceArgsPartial, truncateWorkspaceContent, groupWorkspaceVersions, countWorkspaceFiles, buildZipEntries, zipFilename, WORKSPACE_MAX_CONTENT, WORKSPACE_MAX_FILES, migrateLegacyCanvasGroups, applyUnifiedDiff, diffLines, diffStat, changedFilesBetween, sanitizeHtmlPreview, previewKindFor, parseCsvPreview, WORKSPACE_TEMPLATES, templateById } = await import('./workspace.ts')

test('sanitizePath keeps valid relative paths and never throws', () => {
  assert.equal(sanitizePath('src/app.py'), 'src/app.py')
  assert.equal(sanitizePath('a/b/c.md'), 'a/b/c.md')
  assert.equal(sanitizePath('/leading/slash.py'), 'leading/slash.py')
  assert.equal(sanitizePath('a//b///c.js'), 'a/b/c.js')
  assert.equal(sanitizePath('./a.py'), 'a.py')
  assert.equal(sanitizePath(''), 'file.txt')
  assert.equal(sanitizePath(null), 'file.txt')
  assert.equal(sanitizePath(undefined), 'file.txt')
  assert.equal(sanitizePath(42), 'file.txt')
  assert.equal(sanitizePath('   '), 'file.txt')
})

test('sanitizePath coerces traversal and illegal input to a root basename', () => {
  assert.equal(sanitizePath('../evil.sh'), 'evil.sh')
  assert.equal(sanitizePath('a/../../evil.sh'), 'evil.sh')
  assert.equal(sanitizePath('..'), 'file.txt')
  assert.equal(sanitizePath('/etc/passwd'), 'etc/passwd')
  const weird = sanitizePath('src/my file (1).py')
  assert.match(weird, /^[\w\-./]+$/)
  assert.ok(!weird.startsWith('/'))
  assert.ok(!weird.includes('..'))
  const long = sanitizePath(`a/${'x'.repeat(300)}.py`)
  assert.ok(long.length <= 200)
  assert.match(long, /^[\w\-./]+$/)
})

test('tolerant parser reads full JSON exactly', () => {
  const args = parseWorkspaceArgsPartial(JSON.stringify({ action: 'create', path: 'src/app.py', language: 'python', content: 'print("hi")\n', label: 'App' }))
  assert.deepEqual(args, { action: 'create', path: 'src/app.py', language: 'python', content: 'print("hi")\n', label: 'App' })
})

test('tolerant parser extracts truncated streaming prefixes without crashing', () => {
  // Mid-string cut with escapes accumulated so far.
  const partial = '{"action":"create","path":"src/app.py","language":"python","content":"line1\\nline2\\npar'
  const args = parseWorkspaceArgsPartial(partial)
  assert.equal(args.action, 'create')
  assert.equal(args.path, 'src/app.py')
  assert.equal(args.language, 'python')
  assert.equal(args.content, 'line1\nline2\npar')
  // Cut right after the content opening quote.
  assert.equal(parseWorkspaceArgsPartial('{"action":"create","content":"').content, '')
  // Cut inside an escape sequence.
  assert.equal(parseWorkspaceArgsPartial('{"content":"abc\\').content, 'abc')
  // Cut inside a \u escape.
  assert.equal(parseWorkspaceArgsPartial('{"content":"ab\\u12').content, 'ab')
  // Escaped quotes inside content stay intact.
  assert.equal(parseWorkspaceArgsPartial('{"content":"she said \\"hi\\" loudly').content, 'she said "hi" loudly')
  // Garbage never throws and yields at most a partial object.
  assert.deepEqual(parseWorkspaceArgsPartial('not json at all'), {})
  assert.deepEqual(parseWorkspaceArgsPartial(''), {})
})

test('content truncation marks oversized files', () => {
  const big = 'x'.repeat(WORKSPACE_MAX_CONTENT + 10)
  const { text, truncated } = truncateWorkspaceContent(big)
  assert.equal(truncated, true)
  assert.ok(text.startsWith('x'.repeat(WORKSPACE_MAX_CONTENT)))
  assert.match(text, /truncated/)
  assert.equal(truncateWorkspaceContent('small').truncated, false)
})

test('grouping collects versions by path in message order and caps files', () => {
  const calls = [
    { id: '1', name: 'calc', arguments: '{}' },
    { id: '2', name: 'workspace_upsert', arguments: JSON.stringify({ action: 'create', path: 'src/a.py', language: 'python', content: 'v1' }) },
    { id: '3', name: 'workspace_upsert', arguments: JSON.stringify({ action: 'update', path: 'src/a.py', language: 'python', content: 'v2' }) },
    { id: '4', name: 'workspace_upsert', arguments: JSON.stringify({ action: 'create', path: '/tmp/b.txt', language: '', content: 'b' }) },
  ]
  const groups = groupWorkspaceVersions(calls)
  assert.equal(groups.length, 2)
  assert.equal(groups[0].path, 'src/a.py')
  assert.deepEqual(groups[0].versions.map((v) => v.content), ['v1', 'v2'])
  assert.equal(countWorkspaceFiles(calls), 2)
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, name: 'workspace_upsert', arguments: JSON.stringify({ action: 'create', path: `f${i}.txt`, content: `${i}` }) }))
  assert.equal(groupWorkspaceVersions(many).length, 12)
  assert.equal(countWorkspaceFiles(many), 12)
  assert.equal(WORKSPACE_MAX_FILES, 16)
})

test('zip entries sanitize, dedupe with -2/-3 suffixes, and name the archive', () => {
  const entries = buildZipEntries([
    { path: 'proj/a.py', content: 'a' },
    { path: '/proj/a.py', content: 'a2' },
    { path: 'proj/a.py', content: 'a3' },
    { path: '../../evil.sh', content: 'x' },
    { path: 'notes.txt', content: 'n' },
  ])
  assert.deepEqual(entries.map((e) => e.path), ['proj/a.py', 'proj/a-2.py', 'proj/a-3.py', 'evil.sh', 'notes.txt'])
  assert.equal(zipFilename([{ path: 'proj/a.py' }]), 'proj.zip')
  assert.equal(zipFilename([{ path: 'flat.txt' }]), 'workspace-files.zip')
  assert.equal(zipFilename([]), 'workspace-files.zip')
  // Extensionless duplicates still dedupe.
  assert.deepEqual(buildZipEntries([{ path: 'a', content: '1' }, { path: 'a', content: '2' }]).map((e) => e.path), ['a', 'a-2'])
})

test('built zip extracts to the correct relative structure', async () => {
  const { zipSync, unzipSync, strToU8, strFromU8 } = await import('fflate')
  const entries = buildZipEntries([
    { path: 'proj/src/app.py', content: 'print(1)' },
    { path: 'proj/README.md', content: '# hi' },
  ])
  const obj = {}
  for (const e of entries) obj[e.path] = strToU8(e.content)
  const out = unzipSync(zipSync(obj))
  assert.deepEqual(Object.keys(out).sort(), ['proj/README.md', 'proj/src/app.py'])
  assert.equal(strFromU8(out['proj/src/app.py']), 'print(1)')
})

test('migrateLegacyCanvasGroups converts per-message canvas to workspaces', () => {  const chats = [{
    msgs: [
      { id: 'msg1', r: 'assistant', at: 1000, toolRounds: [{
        text: '', calls: [{
          id: 'call1', name: 'canvas_upsert', arguments: JSON.stringify({ action: 'create', path: 'src/a.py', language: 'python', content: 'v1', label: 'Initial' })
        }]
      }]},
      { id: 'msg2', r: 'assistant', at: 2000, toolRounds: [{
        text: '', calls: [{
          id: 'call2', name: 'canvas_upsert', arguments: JSON.stringify({ action: 'update', path: 'src/a.py', language: 'python', content: 'v2', label: 'Updated' })
        }]
      }]},
    ]
  }]
  const { workspaces, selectedRevision } = migrateLegacyCanvasGroups(chats)
  assert.ok(Object.keys(workspaces).length >= 1)
  const wsId = Object.keys(workspaces)[0]
  const ws = workspaces[wsId]
  assert.ok(ws.id.startsWith('ws-'))
  assert.equal(ws.name, 'Workspace 1')
  assert.equal(ws.revisions.length, 1)
  assert.equal(ws.revisions[0].name, 'Initial')
  assert.equal(ws.revisions[0].files[0].path, 'src/a.py')
  assert.equal(selectedRevision[wsId], ws.revisions[0].id)
})
test('applyUnifiedDiff applies exact hunks with added/removed counts', () => {
  const base = 'line1\nline2\nline3\nline4\n'
  const diff = '--- a/f\n+++ b/f\n@@ -1,4 +1,4 @@\n line1\n-line2\n+LINE2\n line3\n line4\n'
  const r = applyUnifiedDiff(base, diff)
  assert.equal(r.applied, true)
  assert.equal(r.added, 1)
  assert.equal(r.removed, 1)
  assert.equal(r.text, 'line1\nLINE2\nline3\nline4\n')
})

test('applyUnifiedDiff tolerates shifted context and rejects bad hunks', () => {
  const base = 'head\nline1\nline2\ntail\n'
  // Hunk claims old start 1 but matches at line 2 (fuzz).
  const shifted = '@@ -1,2 +1,2 @@\n line1\n-line2\n+LINE2\n'
  const r = applyUnifiedDiff(base, shifted)
  assert.equal(r.applied, true)
  assert.match(r.text, /LINE2/)
  assert.equal(applyUnifiedDiff(base, 'no hunks here').applied, false)
  assert.match(applyUnifiedDiff(base, 'no hunks here').error ?? '', /No hunks/)
  const mismatch = '@@ -1,2 +1,2 @@\n nope\n-still nope\n+new\n'
  assert.equal(applyUnifiedDiff(base, mismatch).applied, false)
  assert.match(applyUnifiedDiff(base, mismatch).error ?? '', /does not match/)
})

test('diffLines marks adds, dels and sames with stats', () => {
  const lines = diffLines('a\nb\nc', 'a\nB\nc\nd')
  assert.deepEqual(lines.map((l) => l.type), ['same', 'del', 'add', 'same', 'add'])
  assert.deepEqual(diffStat(lines), { added: 2, removed: 1 })
  assert.deepEqual(diffStat(diffLines('same', 'same')), { added: 0, removed: 0 })
})

test('changedFilesBetween classifies added, removed, modified and same', () => {
  const changes = changedFilesBetween(
    [{ path: 'keep.py', content: 'x' }, { path: 'edit.py', content: 'v1' }, { path: 'gone.py', content: 'g' }],
    [{ path: 'keep.py', content: 'x' }, { path: 'edit.py', content: 'v2' }, { path: 'new.py', content: 'n' }],
  )
  assert.deepEqual(changes, [
    { path: 'edit.py', status: 'modified' },
    { path: 'gone.py', status: 'removed' },
    { path: 'keep.py', status: 'same' },
    { path: 'new.py', status: 'added' },
  ])
})

test('sanitizeHtmlPreview strips scripts, handlers and javascript urls', () => {
  const out = sanitizeHtmlPreview('<p onclick="evil()">Hi</p><script>alert(1)</script><a href="javascript:alert(2)">x</a><iframe src="e"></iframe>')
  assert.doesNotMatch(out, /script|onclick|javascript|iframe/)
  assert.match(out, /Hi/)
})

test('previewKindFor routes html, svg, markdown and csv', () => {
  assert.equal(previewKindFor('index.html', ''), 'html')
  assert.equal(previewKindFor('pic.svg', ''), 'svg')
  assert.equal(previewKindFor('notes.md', ''), 'markdown')
  assert.equal(previewKindFor('data.csv', ''), 'csv')
  assert.equal(previewKindFor('app.py', 'python'), 'code')
})

test('parseCsvPreview handles quotes and caps dimensions', () => {
  const rows = parseCsvPreview('a,b\n"1,2",3\n4,5')
  assert.deepEqual(rows, [['a', 'b'], ['1,2', '3'], ['4', '5']])
  assert.equal(parseCsvPreview('').length, 0)
})

test('templates are valid, sanitized and addressable', () => {
  assert.ok(WORKSPACE_TEMPLATES.length >= 3)
  for (const t of WORKSPACE_TEMPLATES) {
    assert.ok(t.id && t.name && t.files.length)
    for (const f of t.files) {
      assert.ok(f.content.length)
      assert.equal(sanitizePath(f.path), f.path)
    }
    assert.equal(templateById(t.id)?.id, t.id)
  }
  assert.equal(templateById('nope'), null)
})

test('tolerant parser reads files batches and template ids', () => {
  const args = parseWorkspaceArgsPartial(JSON.stringify({
    action: 'update', path: 'a.py', revisionName: 'r',
    files: [{ path: 'b.py', content: 'x' }, { path: 'c.py', action: 'delete' }],
    template: 'static-site',
  }))
  assert.equal(args.template, 'static-site')
  assert.equal(args.files?.length, 2)
  assert.equal(args.files?.[1].action, 'delete')
})

test('applyWorkspaceCall creates, folds same-message edits, and patches', async () => {
  const { applyWorkspaceCall } = await import('./workspace.ts')
  let n = 0
  const uid = () => `id-${++n}`
  const first = applyWorkspaceCall({}, {
    createNew: true, workspaceName: 'Demo', revisionName: 'Start',
    action: 'create', path: 'a.py', language: 'python', content: 'v1',
  }, { msgId: 'm1', uid })
  assert.equal(first.result.workspaceId, 'id-1')
  assert.deepEqual(first.result.changes, ['a.py created'])
  assert.equal(Object.values(first.workspaces)[0].revisions.length, 1)
  const wsId = first.result.workspaceId
  const second = applyWorkspaceCall(first.workspaces, {
    workspaceId: wsId, revisionName: 'Fix', action: 'patch', path: 'a.py',
    content: '@@ -1,1 +1,1 @@\n-v1\n+v2\n',
  }, { msgId: 'm1', uid })
  // Same message folds into one revision.
  assert.equal(second.workspaces[wsId].revisions.length, 1)
  assert.match(second.result.changes.join(' '), /patched \(\+1\/-1\)/)
  assert.equal(second.workspaces[wsId].revisions[0].files[0].content, 'v2')
  const third = applyWorkspaceCall(second.workspaces, {
    workspaceId: wsId, revisionName: 'More', action: 'create', path: 'b.py', content: 'x',
  }, { msgId: 'm2', uid })
  assert.equal(third.workspaces[wsId].revisions.length, 2)
  assert.equal(third.selectedRevisionId, third.workspaces[wsId].revisions[1].id)
})

test('applyWorkspaceCall batches files atomically and scaffolds templates', async () => {
  const { applyWorkspaceCall } = await import('./workspace.ts')
  let n = 100
  const uid = () => `id-${++n}`
  const r = applyWorkspaceCall({}, {
    createNew: true, workspaceName: 'Site', revisionName: 'Scaffold',
    action: 'create', path: 'extra.txt', content: 'e', template: 'static-site',
    files: [{ path: 'extra2.txt', content: 'e2' }, { path: 'index.html', action: 'delete' }],
  }, { msgId: 'm1', uid })
  assert.equal(r.result.scaffolded, 3)
  const files = r.workspaces[r.result.workspaceId].revisions[0].files
  // 3 template files + extra.txt + extra2.txt − deleted index.html = 4
  assert.equal(files.length, 4)
  assert.deepEqual(r.result.changes.slice(0, 2), ['extra.txt created', 'extra2.txt created'])
  assert.throws(() => applyWorkspaceCall({}, {
    createNew: true, workspaceName: 'X', revisionName: 'R', action: 'create', path: 'a.txt', template: 'nope',
  }, { msgId: 'm1', uid }), /Unknown template/)
  assert.throws(() => applyWorkspaceCall(r.workspaces, {
    workspaceId: r.result.workspaceId, revisionName: 'R', action: 'create', path: 'z.txt', template: 'static-site',
  }, { msgId: 'm2', uid }), /only used with createNew/)
  assert.throws(() => applyWorkspaceCall(r.workspaces, {
    workspaceId: 'missing', revisionName: 'R', action: 'create', path: 'z.txt',
  }, { msgId: 'm2', uid }), /Workspace not found/)
  assert.throws(() => applyWorkspaceCall(r.workspaces, {
    workspaceId: r.result.workspaceId, revisionName: 'R', action: 'patch', path: 'ghost.txt', content: '@@ -1,1 +1,1 @@\n-a\n+b\n',
  }, { msgId: 'm2', uid }), /File not found for patch/)
})
