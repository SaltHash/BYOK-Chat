import test from 'node:test'
import assert from 'node:assert/strict'

const { sanitizePath, parseWorkspaceArgsPartial, truncateWorkspaceContent, groupWorkspaceVersions, countWorkspaceFiles, buildZipEntries, zipFilename, WORKSPACE_MAX_CONTENT, migrateLegacyCanvasGroups } = await import('./workspace.ts')

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
  assert.equal(groupWorkspaceVersions(many).length, 8)
  assert.equal(countWorkspaceFiles(many), 12)
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

test('migrateLegacyCanvasGroups converts per-message canvas to workspaces', () => {
  const chats = [{
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