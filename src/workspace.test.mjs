import test from 'node:test'
import assert from 'node:assert/strict'

const { sanitizePath, parseWorkspaceArgsPartial, truncateWorkspaceContent, groupWorkspaceVersions, countWorkspaceFiles, compactWorkspaceHistory, buildZipEntries, zipFilename, WORKSPACE_MAX_CONTENT, migrateLegacyCanvasGroups, applyUnifiedDiff, diffLines, diffStat, changedFilesBetween, sanitizeHtmlPreview, previewKindFor, parseCsvPreview, WORKSPACE_TEMPLATES, templateById, pendingLiveCalls, findWritingPath, readWorkspaceRange, searchWorkspaceFiles, workspaceTree, workspacePathMatches, unifiedDiffFor, isWorkspaceReadAction, WORKSPACE_READ_MAX_LINES } = await import('./workspace.ts')

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

test('grouping skips calls that have not streamed a path yet', () => {
  const calls = [
    { id: '1', name: 'workspace_upsert', arguments: '{"action":"create"' },
    { id: '2', name: 'workspace_upsert', arguments: '{}' },
    { id: '3', name: 'workspace_upsert', arguments: '' },
    { id: '4', name: '', arguments: '{"path":"ghost.py"}' },
    { id: '5', name: 'workspace_upsert', arguments: JSON.stringify({ action: 'create', path: 'real.py', content: 'x' }) },
  ]
  const groups = groupWorkspaceVersions(calls)
  assert.deepEqual(groups.map((g) => g.path), ['real.py'])
})

test('pending live calls ignore nameless tools and completed rounds', () => {
  const live = [
    { id: 'a', name: '', arguments: '{"query":"x"}' },
    { id: 'b', name: 'workspace_upsert', arguments: JSON.stringify({ path: 'done.py' }) },
    { id: 'c', name: 'workspace_upsert', arguments: JSON.stringify({ path: 'live.py' }) },
  ]
  const pending = pendingLiveCalls(live, [{ id: 'b' }])
  assert.deepEqual(pending.map((c) => c.id), ['c'])
})

test('findWritingPath reports only a real, still-pending file path', () => {
  // A nameless live call (e.g. a search whose name has not arrived) is not a write.
  assert.equal(findWritingPath([{ id: 's', name: '', arguments: '{"query":"hello"}' }], []), null)
  // A workspace call whose path has not streamed yet must not become "file.txt".
  assert.equal(findWritingPath([{ id: 'w', name: 'workspace_upsert', arguments: '{"action":"create"' }], []), null)
  // A path alone is not a write: the action decides whether it changes a file.
  assert.equal(findWritingPath([{ id: 'w', name: 'workspace_upsert', arguments: JSON.stringify({ path: 'src/app.py' }) }], []), null)
  // Once a write action and a path are present, it is reported.
  assert.equal(findWritingPath([{ id: 'w', name: 'workspace_upsert', arguments: JSON.stringify({ action: 'create', path: 'src/app.py' }) }], []), 'src/app.py')
  assert.equal(findWritingPath([{ id: 'w', name: 'workspace_upsert', arguments: JSON.stringify({ action: 'read', path: 'src/app.py' }) }], []), null)
  // A call already committed to a completed round is no longer pending.
  assert.equal(findWritingPath([{ id: 'w', name: 'workspace_upsert', arguments: JSON.stringify({ path: 'src/app.py' }) }], [{ calls: [{ id: 'w', name: 'workspace_upsert', arguments: '' }] }]), null)
})

test('grouping collects versions by path in message order and has no file cap', () => {
  const calls = [
    { id: '1', name: 'calc', arguments: '{}' },
    { id: '2', name: 'workspace_upsert', arguments: JSON.stringify({ action: 'create', path: 'src/a.py', language: 'python', content: 'v1' }) },
    { id: '3', name: 'workspace_upsert', arguments: JSON.stringify({ action: 'update', path: 'src/a.py', language: 'python', content: 'v2' }) },
    { id: '4', name: 'workspace_upsert', arguments: JSON.stringify({ action: 'create', path: '/tmp/b.txt', language: '', content: 'b' }) },
    { id: '5', name: 'workspace_upsert', arguments: JSON.stringify({ action: 'read', path: 'src/a.py' }) },
  ]
  const groups = groupWorkspaceVersions(calls)
  assert.equal(groups.length, 2, 'reads never become a file version')
  assert.equal(findWritingPath([{ id: '5', name: 'workspace_upsert', arguments: JSON.stringify({ action: 'read', path: 'src/a.py' }) }], []), null)
  assert.equal(groups[0].path, 'src/a.py')
  assert.deepEqual(groups[0].versions.map((v) => v.content), ['v1', 'v2'])
  assert.equal(countWorkspaceFiles(calls), 2)
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, name: 'workspace_upsert', arguments: JSON.stringify({ action: 'create', path: `f${i}.txt`, content: `${i}` }) }))
  assert.equal(groupWorkspaceVersions(many).length, 40)
  assert.equal(countWorkspaceFiles(many), 40)
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

test('tolerant parser reads a single file and template ids', () => {
  const args = parseWorkspaceArgsPartial(JSON.stringify({
    action: 'update', path: 'a.py', revisionName: 'r', template: 'static-site',
  }))
  assert.equal(args.template, 'static-site')
  assert.equal(args.path, 'a.py')
  // A batch list is not part of the tool any more: the parser ignores it.
  const batch = parseWorkspaceArgsPartial(JSON.stringify({
    action: 'update', path: 'a.py', files: [{ path: 'b.py', content: 'x' }],
  }))
  assert.equal(batch.files, undefined)
  assert.equal(batch.path, 'a.py')
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

test('applyWorkspaceCall scaffolds templates and holds any number of files', async () => {
  const { applyWorkspaceCall } = await import('./workspace.ts')
  let n = 100
  const uid = () => `id-${++n}`
  const r = applyWorkspaceCall({}, {
    createNew: true, workspaceName: 'Site', revisionName: 'Scaffold',
    action: 'create', path: 'extra.txt', content: 'e', template: 'static-site',
  }, { msgId: 'm1', uid })
  assert.equal(r.result.scaffolded, 3)
  const files = r.workspaces[r.result.workspaceId].revisions[0].files
  // 3 template files + extra.txt
  assert.equal(files.length, 4)
  assert.deepEqual(r.result.changes, ['extra.txt created'])
  // The result lists the paths the workspace holds, so the model can see what
  // already exists before it writes the next file.
  assert.equal(r.result.files.length, 4)
  assert.ok(r.result.files.includes('extra.txt'))
  // There is no cap on how many files a workspace may hold.
  let ws = r.workspaces
  for (let i = 0; i < 40; i++) {
    ws = applyWorkspaceCall(ws, {
      workspaceId: r.result.workspaceId, revisionName: `File ${i}`,
      action: 'create', path: `f${i}.txt`, content: 'x',
    }, { msgId: 'm1', uid }).workspaces
  }
  assert.equal(ws[r.result.workspaceId].revisions[0].files.length, 44)
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

test('a write over the per-file limit is refused instead of stored truncated', async () => {
  const { applyWorkspaceCall, WORKSPACE_MAX_CONTENT, isTruncatedContent } = await import('./workspace.ts')
  let n = 0
  const uid = () => `id-${++n}`

  // Refused, not cut: a truncated file is corrupt and the model must split it.
  assert.throws(() => applyWorkspaceCall({}, {
    createNew: true, workspaceName: 'Huge', revisionName: 'Huge', action: 'create', path: 'huge.js',
    content: 'x'.repeat(WORKSPACE_MAX_CONTENT + 1),
  }, { msgId: 'm1', uid }), /per-file limit/i)

  // A file exactly at the limit is stored whole and is not marked incomplete.
  const exact = applyWorkspaceCall({}, {
    createNew: true, workspaceName: 'Exact', revisionName: 'Exact', action: 'create', path: 'exact.js',
    content: 'y'.repeat(WORKSPACE_MAX_CONTENT),
  }, { msgId: 'm2', uid })
  const exactFile = exact.workspaces[exact.result.workspaceId].revisions[0].files[0]
  assert.equal(exactFile.content.length, WORKSPACE_MAX_CONTENT)
  assert.equal(exactFile.truncated, false)
  assert.ok(!exactFile.content.includes('truncated'))

  // A file cut by an earlier version keeps its old 50,000 marker; continue
  // strips that marker and appends the missing text.
  const legacyMarker = '\n\n[truncated: content exceeded 50,000 characters]'
  assert.equal(isTruncatedContent('head\n' + legacyMarker), true)
  assert.equal(isTruncatedContent('plain text'), false)
  const legacy = {
    'ws-old': { id: 'ws-old', name: 'Old', revisions: [{ id: 'r1', name: 'Old', msgId: 'm0', createdAt: 0, files: [
      { path: 'site.js', language: 'js', content: 'head\n' + legacyMarker, truncated: true },
    ] }] },
  }
  const finished = applyWorkspaceCall(legacy, {
    workspaceId: 'ws-old', revisionName: 'Finish', action: 'continue', path: 'site.js', content: 'tail\n',
  }, { msgId: 'm3', uid })
  const done = finished.workspaces['ws-old'].revisions.at(-1).files[0]
  assert.equal(done.content, 'head\ntail\n')
  assert.equal(done.truncated, false)

  // Continuing past the limit is refused, and a patch on an incomplete file
  // points at continue/update instead of leaving the marker in the middle.
  assert.throws(() => applyWorkspaceCall(legacy, {
    workspaceId: 'ws-old', revisionName: 'Too big', action: 'continue', path: 'site.js', content: 'z'.repeat(WORKSPACE_MAX_CONTENT),
  }, { msgId: 'm4', uid }), /per-file limit/i)
  assert.throws(() => applyWorkspaceCall(legacy, {
    workspaceId: 'ws-old', revisionName: 'Patch', action: 'patch', path: 'site.js', content: '@@ -1,1 +1,1 @@\n-head\n+HEAD\n',
  }, { msgId: 'm4', uid }), /incomplete/i)
})

test('applyUnifiedDiff accepts apply_patch hunks without line numbers', () => {
  const base = 'const a = 1\nfunction stats() {\n  return 1\n}\nconst b = 2\n'
  const diff = '*** Begin Patch\n*** Update File: app.js\n@@\n-  return 1\n+  return 2\n@@\n }\n+const c = 3\n*** End Patch'
  const r = applyUnifiedDiff(base, diff)
  assert.equal(r.applied, true)
  assert.equal(r.added, 2)
  assert.equal(r.removed, 1)
  assert.equal(r.text, 'const a = 1\nfunction stats() {\n  return 2\n}\nconst c = 3\nconst b = 2\n')
})

test('applyUnifiedDiff applies the user-reported apply_patch block with bare @@ hunks', () => {
  const base = [
    'let saved = readProgress();',
    '  function readProgress() {',
    '    return {',
    '        badges: Array.isArray(parsed.badges) ? parsed.badges.filter(id => BADGES.some(b => b.id === id)) : []',
    '    };',
    '  }',
    '  function renderStats() {',
    '    const count = saved.bestDigits;',
    '  }',
    '  function updateTimer() {',
    "    if (startedAt === null) { startedAt = performance.now(); if (mode === 'trial') timer = setInterval(updateTimer, 100); }",
    '  }',
    "  els['digit-input'].addEventListener('keydown', event => { if (event.key === 'Enter') checkAnswer(); });",
  ].join('\n') + '\n'
  const diff = [
    '@@',
    '-        badges: Array.isArray(parsed.badges) ? parsed.badges.filter(id => BADGES.some(b => b.id === id)) : []',
    '+        badges: Array.isArray(parsed.badges) ? parsed.badges.filter(id => BADGES.some(b => b.id === id)) : [],',
    '+        streak: 0',
    '@@',
    '   function renderStats() {',
    '+    saved.streak = currentStreak();',
    '@@',
    '   }',
    '+  function currentStreak() {',
    '+    const days = new Set(saved.practiceDays);',
    '+    let cursor = new Date(`${today()}T12:00:00`);',
    '+    if (!days.has(today())) cursor.setDate(cursor.getDate() - 1);',
    '+    let streak = 0;',
    '+    while (true) {',
    "+      const key = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-${String(cursor.getDate()).padStart(2,'0')}`;",
    '+      if (!days.has(key)) return streak;',
    '+      streak++;',
    '+      cursor.setDate(cursor.getDate() - 1);',
    '+    }',
    '+  }',
    '@@',
    "-    if (startedAt === null) { startedAt = performance.now(); if (mode === 'trial') timer = setInterval(updateTimer, 100); }",
    '+    if (startedAt === null) startedAt = performance.now();',
    '@@',
    "   els['digit-input'].addEventListener('keydown', event => { if (event.key === 'Enter') checkAnswer(); });",
    "+  els['digit-input'].addEventListener('input', () => {",
    "+    if (mode === 'trial' && active && startedAt === null && cleanInput(els['digit-input'].value)) {",
    '+      startedAt = performance.now();',
    '+      timer = setInterval(updateTimer, 100);',
    "+      els['input-feedback'].textContent = 'Timer running: 0.0 seconds';",
    "+      els['input-feedback'].className = '';",
    '+    }',
    '+  });',
    '*** End Patch',
  ].join('\n')
  const r = applyUnifiedDiff(base, diff)
  assert.equal(r.applied, true)
  assert.match(r.text, /streak: 0/)
  assert.match(r.text, /saved\.streak = currentStreak\(\);/)
  assert.ok(r.text.indexOf('function currentStreak') > r.text.indexOf('function renderStats'))
  assert.ok(r.text.indexOf('function currentStreak') < r.text.indexOf('function updateTimer'))
  assert.match(r.text, /if \(startedAt === null\) startedAt = performance\.now\(\);/)
  assert.ok(!r.text.includes("if (startedAt === null) { startedAt = performance.now(); if (mode === 'trial')"))
  assert.match(r.text, /addEventListener\('keydown'[^\n]*\n  els\['digit-input'\]\.addEventListener\('input'/)
})

test('applyUnifiedDiff finds hunks by content even when line numbers are stale', () => {
  const base = Array.from({ length: 120 }, (_, i) => `line ${i + 1}`).join('\n')
  const diff = '@@ -1,1 +1,1 @@\n-line 80\n+LINE 80\n@@ -2,1 +2,1 @@\n-line 119\n+LINE 119\n'
  const r = applyUnifiedDiff(base, diff)
  assert.equal(r.applied, true)
  assert.equal(r.added, 2)
  assert.equal(r.removed, 2)
  assert.ok(r.text.includes('LINE 80'))
  assert.ok(r.text.includes('LINE 119'))
  assert.ok(!r.text.includes('line 80\n'))
  assert.ok(!r.text.includes('line 119'))
})

test('applyUnifiedDiff accepts bare hunks and plain -/+ bodies', () => {
  const bare = applyUnifiedDiff('a\nb\nc\nd\n', '@@\n-b\n+B\n@@\n-d\n+D\n')
  assert.equal(bare.applied, true)
  assert.equal(bare.text, 'a\nB\nc\nD\n')
  const plain = applyUnifiedDiff('hello\nworld\n', '-world\n+there\n')
  assert.equal(plain.applied, true)
  assert.equal(plain.text, 'hello\nthere\n')
})

test('applyUnifiedDiff tolerates indentation drift and CRLF files', () => {
  const spaced = applyUnifiedDiff('function x() {\n\treturn 1\n}\n', '@@\n-    return 1\n+    return 2\n')
  assert.equal(spaced.applied, true)
  assert.ok(spaced.text.includes('return 2'))
  const crlf = applyUnifiedDiff('a\r\nb\r\nc', '@@ -1,1 +1,1 @@\n-a\n+A\n')
  assert.equal(crlf.applied, true)
  assert.equal(crlf.text, 'A\r\nb\r\nc')
})

test('applyUnifiedDiff does not mistake --/+ content for file headers', () => {
  const r = applyUnifiedDiff('-- old comment\nvalue\n', '--- old comment\n+++ new comment\n')
  assert.equal(r.applied, true)
  assert.equal(r.text, '++ new comment\nvalue\n')
})

test('applyUnifiedDiff keeps a leading Markdown fence context line', () => {
  const base = '```js\nconst x = 1\n```\n'
  const diff = ' ```js\n-const x = 1\n+const x = 2\n ```'
  const r = applyUnifiedDiff(base, diff)
  assert.equal(r.applied, true)
  assert.equal(r.text, '```js\nconst x = 2\n```\n')
})

test('applyUnifiedDiff warns when a hunk is ambiguous', () => {
  const r = applyUnifiedDiff('x\ny\nx\ny\n', '@@\n-x\n+X\n')
  assert.equal(r.applied, true)
  assert.equal(r.text, 'X\ny\nx\ny\n')
  assert.ok(r.warnings?.some((w) => /2 places/.test(w)))
})

test('applyUnifiedDiff refuses a patch that changes more than one file', () => {
  const r = applyUnifiedDiff('a\n', '*** Begin Patch\n*** Update File: a.js\n@@\n-a\n+b\n*** Update File: b.js\n@@\n-c\n+d\n*** End Patch')
  assert.equal(r.applied, false)
  assert.match(r.error ?? '', /more than one file/)
})

test('applyUnifiedDiff inserts zero-old-count hunks after the stated line', () => {
  const top = applyUnifiedDiff('a\nb\nc', '@@ -0,0 +1,1 @@\n+X')
  assert.equal(top.applied, true)
  assert.equal(top.text, 'X\na\nb\nc')
  const mid = applyUnifiedDiff('a\nb\nc', '@@ -2,0 +3,1 @@\n+X')
  assert.equal(mid.applied, true)
  assert.equal(mid.text, 'a\nb\nX\nc')
  const end = applyUnifiedDiff('a\nb\nc', '@@ -3,0 +4,1 @@\n+X')
  assert.equal(end.applied, true)
  assert.equal(end.text, 'a\nb\nc\nX')
})

test('applyWorkspaceCall read returns current content without adding a revision', async () => {
  const { applyWorkspaceCall } = await import('./workspace.ts')
  let n = 0
  const uid = () => `id-${++n}`
  const first = applyWorkspaceCall({}, {
    createNew: true, workspaceName: 'W', revisionName: 'Start',
    action: 'create', path: 'a.txt', language: 'text', content: 'one\ntwo\n',
  }, { msgId: 'm1', uid })
  const read = applyWorkspaceCall(first.workspaces, {
    workspaceId: first.result.workspaceId, revisionName: 'Read', action: 'read', path: 'a.txt',
  }, { msgId: 'm2', uid })
  assert.equal(read.result.action, 'read')
  assert.equal(read.result.content, 'one\ntwo\n')
  assert.equal(read.result.lines, 3)
  assert.equal(read.workspaces[first.result.workspaceId].revisions.length, 1)
  assert.equal(read.selectedRevisionId, first.selectedRevisionId)
  assert.throws(() => applyWorkspaceCall(first.workspaces, {
    workspaceId: first.result.workspaceId, revisionName: 'Read', action: 'read', path: 'missing.txt',
  }, { msgId: 'm2', uid }), /not found for read/)
  assert.throws(() => applyWorkspaceCall({}, {
    revisionName: 'Read', action: 'read', path: 'a.txt',
  }, { msgId: 'm2', uid }), /needs an existing workspaceId/)
})

test('compactWorkspaceHistory elides obsolete file bodies from the wire copy', () => {
  const oldBody = `const x = 1\n${'// filler\n'.repeat(200)}`
  const newBody = `const x = 2\n${'// filler\n'.repeat(200)}`
  const patch = '@@\n-const x = 1\n+const x = 2'
  const rounds = [
    { text: '', calls: [
      { id: 'c1', name: 'workspace_upsert', arguments: JSON.stringify({ action: 'create', workspaceId: 'ws', revisionName: 'Create', path: 'app.js', content: oldBody }), result: JSON.stringify({ workspaceId: 'ws', path: 'app.js', action: 'ready', files: ['app.js'], fileCount: 1 }) },
      { id: 'c2', name: 'workspace_upsert', arguments: JSON.stringify({ action: 'patch', workspaceId: 'ws', revisionName: 'Patch', path: 'app.js', content: patch }), result: JSON.stringify({ workspaceId: 'ws', path: 'app.js', action: 'ready', files: ['app.js'], fileCount: 1 }) },
    ] },
    { text: '', calls: [
      { id: 'c3', name: 'workspace_upsert', arguments: JSON.stringify({ action: 'update', workspaceId: 'ws', revisionName: 'Update', path: 'app.js', content: newBody }), result: JSON.stringify({ workspaceId: 'ws', path: 'app.js', action: 'ready', files: ['app.js'], fileCount: 1 }) },
    ] },
  ]
  const msgs = [{ id: 'm', r: 'assistant', toolRounds: rounds }]
  const out = compactWorkspaceHistory(msgs)
  const first = JSON.parse(out[0].toolRounds[0].calls[0].arguments)
  assert.match(first.content, /earlier version omitted/)
  assert.equal(JSON.parse(out[0].toolRounds[0].calls[1].arguments).content, patch)
  assert.equal(JSON.parse(out[0].toolRounds[1].calls[0].arguments).content, newBody)
  const firstResult = JSON.parse(out[0].toolRounds[0].calls[0].result)
  assert.equal(firstResult.files, undefined)
  assert.match(firstResult.filesNote, /omitted/)
  assert.deepEqual(JSON.parse(out[0].toolRounds[1].calls[0].result).files, ['app.js'])
  // The stored history is untouched; only the request copy is compacted.
  assert.equal(JSON.parse(rounds[0].calls[0].arguments).content, oldBody)
  assert.deepEqual(JSON.parse(rounds[0].calls[0].result).files, ['app.js'])
})

test('compactWorkspaceHistory resolves a new workspace id and keeps same-named files in separate workspaces', () => {
  const bodyOne = '// one\n'.repeat(80)
  const bodyTwo = '// two\n'.repeat(80)
  const updated = '// one v2\n'.repeat(80)
  const call = (id, args, result) => ({ id, name: 'workspace_upsert', arguments: JSON.stringify({ revisionName: id, ...args }), result: JSON.stringify(result) })
  const msgs = [{ id: 'm', r: 'assistant', toolRounds: [{ text: '', calls: [
    call('c1', { action: 'create', createNew: true, workspaceName: 'One', path: 'app.js', content: bodyOne }, { workspaceId: 'ws1', path: 'app.js', action: 'ready', files: ['app.js'] }),
    call('c2', { action: 'create', createNew: true, workspaceName: 'Two', path: 'app.js', content: bodyTwo }, { workspaceId: 'ws2', path: 'app.js', action: 'ready', files: ['app.js'] }),
    call('c3', { action: 'update', workspaceId: 'ws1', path: 'app.js', content: updated }, { workspaceId: 'ws1', path: 'app.js', action: 'ready', files: ['app.js'] }),
  ] }] }]
  const out = compactWorkspaceHistory(msgs)
  const [first, second, third] = out[0].toolRounds[0].calls.map((c) => JSON.parse(c.arguments))
  assert.match(first.content, /earlier version omitted/, 'the create resolves to ws1 through its result')
  assert.equal(first.createNew, true, 'unparsed argument fields survive the rewrite')
  assert.equal(first.workspaceName, 'One')
  assert.equal(second.content, bodyTwo, 'ws2 has its own app.js, not superseded by ws1')
  assert.equal(third.content, updated)
  assert.equal(JSON.parse(msgs[0].toolRounds[0].calls[0].arguments).content, bodyOne)
})

test('compactWorkspaceHistory keeps only the newest read of a file', () => {
  const read = (id, result) => ({ id, name: 'workspace_upsert', arguments: JSON.stringify({ action: 'read', workspaceId: 'ws', revisionName: id, path: 'app.js' }), result: JSON.stringify({ workspaceId: 'ws', path: 'app.js', action: 'read', files: ['app.js'], content: result }) })
  const rounds = [{ text: '', calls: [read('r1', 'old body'), read('r2', 'new body')] }]
  const out = compactWorkspaceHistory([{ id: 'm', r: 'assistant', toolRounds: rounds }])
  const first = JSON.parse(out[0].toolRounds[0].calls[0].result)
  const second = JSON.parse(out[0].toolRounds[0].calls[1].result)
  assert.equal(first.content, undefined)
  assert.match(first.contentNote, /earlier read omitted/)
  assert.equal(second.content, 'new body')
  // The stored history keeps both full reads.
  assert.equal(JSON.parse(rounds[0].calls[0].result).content, 'old body')
})

test('compactWorkspaceHistory elides a read once the file is written again', () => {
  const body = '// next\n'.repeat(100)
  const call = (id, args, result) => ({ id, name: 'workspace_upsert', arguments: JSON.stringify({ revisionName: id, ...args }), result: JSON.stringify(result) })
  const rounds = [{ text: '', calls: [
    call('r1', { action: 'read', workspaceId: 'ws', path: 'app.js' }, { workspaceId: 'ws', path: 'app.js', action: 'read', files: ['app.js'], content: 'old body' }),
    call('u1', { action: 'update', workspaceId: 'ws', path: 'app.js', content: body }, { workspaceId: 'ws', path: 'app.js', action: 'ready', files: ['app.js'] }),
  ] }]
  const out = compactWorkspaceHistory([{ id: 'm', r: 'assistant', toolRounds: rounds }])
  const read = JSON.parse(out[0].toolRounds[0].calls[0].result)
  assert.equal(read.content, undefined)
  assert.match(read.contentNote, /changed after this read/)
  assert.equal(JSON.parse(out[0].toolRounds[0].calls[1].arguments).content, body)
})

test('applyUnifiedDiff refuses an unanchored insertion instead of appending it', () => {
  const r = applyUnifiedDiff('a\nb\n', '@@\n+orphan\n')
  assert.equal(r.applied, false)
  assert.match(r.error ?? '', /nothing to place them after/)
})

test('workspace update without content is rejected instead of blanking the file', async () => {
  const { applyWorkspaceCall } = await import('./workspace.ts')
  const uid = (() => { let n = 0; return () => `id${++n}` })()
  const first = applyWorkspaceCall({}, { action: 'create', path: 'a.txt', content: 'hello', revisionName: 'r1', createNew: true, workspaceName: 'W' }, { msgId: 'm1', uid })
  assert.throws(() => applyWorkspaceCall(first.workspaces, { action: 'update', path: 'a.txt', revisionName: 'r2', workspaceId: first.result.workspaceId }, { msgId: 'm2', uid }), /Missing content/)
})

test('activeWorkspaceId returns the workspace the chat last touched', async () => {
  const { activeWorkspaceId } = await import('./workspace.ts')
  assert.equal(activeWorkspaceId([]), undefined)
  assert.equal(activeWorkspaceId([{ workspaceIds: [] }, {}]), undefined)
  assert.equal(activeWorkspaceId([{ workspaceIds: ['ws1'] }, { workspaceIds: ['ws2', 'ws3'] }]), 'ws3')
  // Newest message wins, even when an older one lists more workspaces.
  assert.equal(activeWorkspaceId([{ workspaceIds: ['ws1', 'ws2'] }, { workspaceIds: ['ws3'] }]), 'ws3')
})

test('resolveWorkspaceTarget keeps the files in the workspace the user is looking at', async () => {
  const { resolveWorkspaceTarget } = await import('./workspace.ts')
  const workspaces = {
    ws1: { id: 'ws1', name: 'Habit Tracker', revisions: [] },
    ws2: { id: 'ws2', name: 'Other', revisions: [] },
  }
  // A known id wins.
  assert.deepEqual(resolveWorkspaceTarget({ workspaceId: 'ws2' }, { workspaces, activeId: 'ws1' }), { workspaceId: 'ws2' })
  // No id: the chat's active workspace is used.
  assert.deepEqual(resolveWorkspaceTarget({}, { workspaces, activeId: 'ws1' }), { workspaceId: 'ws1', fallback: 'active' })
  // A hallucinated id falls back to the active workspace instead of failing.
  assert.deepEqual(resolveWorkspaceTarget({ workspaceId: 'nope' }, { workspaces, activeId: 'ws1' }), { workspaceId: 'ws1', fallback: 'active' })
  // No workspace at all: a new one is created, with a usable name.
  const fresh = resolveWorkspaceTarget({}, { workspaces: {} })
  assert.equal(fresh.createNew, true)
  assert.ok(fresh.workspaceName)
  // createNew with a different name is a deliberate new project.
  assert.equal(resolveWorkspaceTarget({ createNew: true, workspaceName: 'Second Project' }, { workspaces, activeId: 'ws1' }).createNew, true)
  // createNew repeating the active workspace name is the same project.
  assert.deepEqual(resolveWorkspaceTarget({ createNew: true, workspaceName: 'habit tracker' }, { workspaces, activeId: 'ws1' }), { workspaceId: 'ws1', fallback: 'active' })
})

/* ---- Inspection actions: ranged reads, grep, tree, diff, move ---------- */

test('grouping ignores inspections and treats move as a write', () => {
  const call = (id, args) => ({ id, name: 'workspace_upsert', arguments: JSON.stringify(args) })
  const calls = [
    call('1', { action: 'create', path: 'a.txt', language: 'text', content: 'one' }),
    call('2', { action: 'read', path: 'a.txt' }),
    call('3', { action: 'list' }),
    call('4', { action: 'search', query: 'one' }),
    call('5', { action: 'diff', path: 'a.txt' }),
    call('6', { action: 'move', path: 'a.txt', to: 'src/a.txt' }),
  ]
  const groups = groupWorkspaceVersions(calls)
  // A move is a write to the same path, so it is a second version of it.
  assert.deepEqual(groups.map((g) => g.path), ['a.txt'])
  assert.deepEqual(groups[0].versions.map((v) => v.action), ['create', 'move'])
  for (const action of ['read', 'list', 'search', 'diff']) assert.equal(isWorkspaceReadAction(action), true)
  for (const action of ['create', 'update', 'patch', 'continue', 'move', 'delete']) assert.equal(isWorkspaceReadAction(action), false)
})

test('readWorkspaceRange pages a long file and clamps impossible ranges', () => {
  const content = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join('\n')
  const first = readWorkspaceRange(content)
  assert.equal(first.startLine, 1)
  assert.equal(first.endLine, WORKSPACE_READ_MAX_LINES)
  assert.equal(first.returnedLines, WORKSPACE_READ_MAX_LINES)
  assert.equal(first.hasMore, true)
  assert.equal(first.nextStartLine, WORKSPACE_READ_MAX_LINES + 1)
  assert.ok(first.text.startsWith('line 1\nline 2'))
  assert.ok(first.text.endsWith(`line ${WORKSPACE_READ_MAX_LINES}`))

  const page = readWorkspaceRange(content, { startLine: 90, endLine: 92 })
  assert.equal(page.text, 'line 90\nline 91\nline 92')
  assert.equal(page.totalLines, 1000)
  assert.equal(page.hasMore, true)
  assert.equal(page.nextStartLine, 93)

  const last = readWorkspaceRange(content, { startLine: 999, endLine: 5000 })
  assert.equal(last.text, 'line 999\nline 1000')
  assert.equal(last.hasMore, false)
  assert.equal(last.nextStartLine, undefined)

  // An end before the start collapses to one line instead of returning junk.
  const backward = readWorkspaceRange(content, { startLine: 10, endLine: 2 })
  assert.equal(backward.text, 'line 10')
  // A start past the end clamps to the last line.
  const past = readWorkspaceRange(content, { startLine: 5000 })
  assert.equal(past.text, 'line 1000')
  // Empty files are readable and report zero lines.
  assert.deepEqual(readWorkspaceRange(''), { text: '', startLine: 1, endLine: 0, totalLines: 0, returnedLines: 0, hasMore: false })
  // The line cap is per call, even for a large endLine.
  assert.equal(readWorkspaceRange(content, { startLine: 1, endLine: 900 }).returnedLines, WORKSPACE_READ_MAX_LINES)
})

test('searchWorkspaceFiles greps literally and by regex with path, glob and caps', () => {
  const files = [
    { path: 'src/app.ts', content: 'const a = 1\n// TODO: fix this\nfunction add(a, b) { return a + b }\n' },
    { path: 'src/lib/util.ts', content: 'export const TODO = 2\nexport function noop() {}\n' },
    { path: 'README.md', content: '# Notes\nTODO: write docs\n' },
    { path: 'src/legacy.js', content: 'var todo = 3\n' },
  ]
  // Literal, case-insensitive by default.
  const literal = searchWorkspaceFiles(files, 'TODO')
  assert.equal(literal.totalMatches, 4)
  assert.equal(literal.matchCount, 4)
  assert.equal(literal.filesMatched, 4)
  assert.deepEqual(literal.matches[0], { path: 'src/app.ts', line: 2, text: '// TODO: fix this' })
  // A literal query is not a regex.
  assert.equal(searchWorkspaceFiles(files, 'a + b').totalMatches, 1)
  // Case-sensitive and regex modes.
  assert.equal(searchWorkspaceFiles(files, 'TODO', { caseSensitive: true }).totalMatches, 3)
  const regex = searchWorkspaceFiles(files, '^export (const|function)', { regex: true })
  assert.equal(regex.totalMatches, 2)
  assert.throws(() => searchWorkspaceFiles(files, '([', { regex: true }), /Invalid regular expression/)
  assert.throws(() => searchWorkspaceFiles(files, '(a+)+$', { regex: true }), /nests a quantifier/)
  assert.throws(() => searchWorkspaceFiles(files, 'x'.repeat(501)), /too long/)
  assert.throws(() => searchWorkspaceFiles(files, ''), /needs a query/)
  // Glob and folder filters, including **.
  assert.deepEqual(searchWorkspaceFiles(files, 'TODO', { glob: '*.md' }).matches.map((m) => m.path), ['README.md'])
  assert.deepEqual(searchWorkspaceFiles(files, 'TODO', { path: 'src' }).matches.map((m) => m.path), ['src/app.ts', 'src/lib/util.ts', 'src/legacy.js'])
  assert.deepEqual(searchWorkspaceFiles(files, 'TODO', { glob: 'src/**/*.ts' }).matches.map((m) => m.path), ['src/app.ts', 'src/lib/util.ts'])
  assert.equal(workspacePathMatches('src/lib/util.ts', { path: 'src/lib' }), true)
  assert.equal(workspacePathMatches('src/libx/util.ts', { path: 'src/lib' }), false)
  // Context lines sit around the match, and results are capped while the
  // total keeps counting.
  const contextual = searchWorkspaceFiles(files, 'fix this', { contextLines: 1 })
  assert.deepEqual(contextual.matches[0].before, ['const a = 1'])
  assert.deepEqual(contextual.matches[0].after, ['function add(a, b) { return a + b }'])
  const capped = searchWorkspaceFiles(files, 'TODO', { maxResults: 2 })
  assert.equal(capped.matchCount, 2)
  assert.equal(capped.totalMatches, 4)
  assert.equal(capped.truncated, true)
})

test('workspaceTree groups folders and collapses dependency directories', () => {
  const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n')
  const files = [
    { path: 'README.md', content: '# hi' },
    { path: 'src/app.ts', content: lines(10) },
    { path: 'src/lib/util.ts', content: lines(3) },
    { path: 'node_modules/react/index.js', content: 'module.exports = 1' },
    { path: 'node_modules/react/package.json', content: '{}' },
    { path: 'packages/ui/node_modules/left-pad/index.js', content: '' },
  ]
  const tree = workspaceTree(files)
  assert.equal(tree.fileCount, 6)
  assert.equal(tree.folderCount, 4, 'src, src/lib, packages, packages/ui')
  assert.equal(tree.hiddenFiles, 3)
  assert.equal(tree.hiddenFolders, 2)
  assert.match(tree.text, /\nREADME\.md \(1 line\)$/)
  assert.match(tree.text, /src\/\n {2}lib\/\n {4}util\.ts \(3 lines\)\n {2}app\.ts \(10 lines\)/)
  assert.match(tree.text, /^node_modules\/ \(contents hidden — 2 files\)/)
  assert.match(tree.text, /node_modules\/ \(contents hidden — 2 files\)/)
  assert.match(tree.text, / {4}node_modules\/ \(contents hidden — 1 file\)/)
  assert.ok(!tree.text.includes('react'), 'hidden folder children are not listed')
  assert.ok(!tree.text.includes('index.js'))
  assert.equal(tree.truncated, false)
  // A tight budget truncates and says how many files are missing.
  const tight = workspaceTree(files, { maxEntries: 6 })
  assert.equal(tight.truncated, true)
  assert.match(tight.text, /more files? not shown/)
  assert.ok(tight.omittedFiles > 0)
})

test('unifiedDiffFor writes readable hunks and keeps full counts', () => {
  const before = ['one', 'two', 'three', 'four', 'five', 'six'].join('\n') + '\n'
  const after = ['one', 'TWO', 'three', 'four', 'five', 'six', 'seven'].join('\n') + '\n'
  const d = unifiedDiffFor('src/a.txt', before, after)
  assert.equal(d.added, 2)
  assert.equal(d.removed, 1)
  assert.match(d.diff, /^--- a\/src\/a\.txt\n\+\+\+ b\/src\/a\.txt\n@@ /)
  assert.match(d.diff, /\n-two\n\+TWO\n/)
  assert.match(d.diff, /\+seven/)
  assert.equal(unifiedDiffFor('x.txt', 'same', 'same').diff, '')
})

test('applyWorkspaceCall supports list, search, diff, move and dry-run patches', async () => {
  const { applyWorkspaceCall } = await import('./workspace.ts')
  let n = 0
  const uid = () => `id-${++n}`
  const first = applyWorkspaceCall({}, {
    createNew: true, workspaceName: 'Demo', revisionName: 'Start',
    action: 'create', path: 'a.txt', language: 'text', content: 'one\ntwo\nthree\n',
  }, { msgId: 'm1', uid })
  const wsId = first.result.workspaceId
  const withB = applyWorkspaceCall(first.workspaces, {
    workspaceId: wsId, revisionName: 'Add b', action: 'create', path: 'src/b.txt', content: 'alpha\nbeta\n',
  }, { msgId: 'm2', uid })

  // read honours the line window and reports where it stopped.
  const read = applyWorkspaceCall(withB.workspaces, { workspaceId: wsId, action: 'read', path: 'a.txt', startLine: 2, endLine: 2 }, { msgId: 'm2', uid })
  assert.equal(read.result.content, 'two')
  assert.equal(read.result.startLine, 2)
  assert.equal(read.result.endLine, 2)
  assert.equal(read.result.lines, 4, 'the trailing newline is its own (empty) line')
  assert.equal(read.result.hasMore, true)
  assert.equal(read.result.nextStartLine, 3)
  assert.match(read.result.note, /startLine 3/)
  assert.equal(read.workspaces[wsId].revisions.length, 2, 'a read never adds a revision')

  // list is a tree, optionally filtered.
  const listed = applyWorkspaceCall(withB.workspaces, { workspaceId: wsId, action: 'list', revisionName: undefined }, { msgId: 'm2', uid })
  assert.equal(listed.result.action, 'listed')
  assert.match(listed.result.tree, /src\/\n {2}b\.txt/)
  assert.equal(listed.result.matchedFiles, 2)
  const filtered = applyWorkspaceCall(withB.workspaces, { workspaceId: wsId, action: 'list', path: 'src' }, { msgId: 'm2', uid })
  assert.equal(filtered.result.matchedFiles, 1)
  assert.ok(!filtered.result.tree.includes('a.txt'))

  // search reports matches and never changes anything.
  const searched = applyWorkspaceCall(withB.workspaces, { workspaceId: wsId, action: 'search', query: 'beta' }, { msgId: 'm2', uid })
  assert.equal(searched.result.action, 'searched')
  assert.deepEqual(searched.result.matches, [{ path: 'src/b.txt', line: 2, text: 'beta' }])
  assert.equal(searched.result.filesSearched, 2)
  assert.equal(searched.workspaces[wsId].revisions.length, 2)

  // diff against the previous revision, another file and proposed content.
  const updated = applyWorkspaceCall(withB.workspaces, {
    workspaceId: wsId, revisionName: 'Change two', action: 'update', path: 'a.txt', content: 'one\nTWO\nthree\n',
  }, { msgId: 'm3', uid })
  const diff = applyWorkspaceCall(updated.workspaces, { workspaceId: wsId, action: 'diff', path: 'a.txt' }, { msgId: 'm4', uid })
  assert.equal(diff.result.action, 'diffed')
  assert.match(diff.result.diff, /-two\n\+TWO/)
  assert.equal(diff.result.added, 1)
  assert.equal(diff.result.removed, 1)
  assert.equal(diff.result.against, 'revision "Add b"')
  const vsFile = applyWorkspaceCall(updated.workspaces, { workspaceId: wsId, action: 'diff', path: 'a.txt', against: 'src/b.txt' }, { msgId: 'm4', uid })
  assert.equal(vsFile.result.against, 'src/b.txt')
  const proposed = applyWorkspaceCall(updated.workspaces, { workspaceId: wsId, action: 'diff', path: 'a.txt', content: 'one\nTWO\nthree\nfour\n' }, { msgId: 'm4', uid })
  assert.equal(proposed.result.against, 'proposed content')
  assert.equal(proposed.result.added, 1)

  // A dry-run patch proves the diff and returns it without saving.
  const dry = applyWorkspaceCall(updated.workspaces, {
    workspaceId: wsId, revisionName: 'Preview', action: 'patch', path: 'a.txt', dryRun: true,
    content: '@@ -1,1 +1,1 @@\n-one\n+ONE\n',
  }, { msgId: 'm4', uid })
  assert.equal(dry.result.action, 'diffed')
  assert.equal(dry.result.dryRun, true)
  assert.match(dry.result.diff, /-one\n\+ONE/)
  assert.equal(dry.workspaces[wsId].revisions.length, updated.workspaces[wsId].revisions.length, 'dry run stores nothing')
  assert.equal(dry.workspaces[wsId].revisions.at(-1).files.find((f) => f.path === 'a.txt').content, 'one\nTWO\nthree\n')

  // move repaths one file and keeps its body.
  const moved = applyWorkspaceCall(updated.workspaces, {
    workspaceId: wsId, revisionName: 'Move', action: 'move', path: 'a.txt', to: 'src/a.txt',
  }, { msgId: 'm5', uid })
  assert.equal(moved.result.action, 'moved')
  assert.equal(moved.result.to, 'src/a.txt')
  assert.ok(moved.result.files.includes('src/a.txt'))
  assert.ok(!moved.result.files.includes('a.txt'))
  assert.equal(moved.workspaces[wsId].revisions.at(-1).files.find((f) => f.path === 'src/a.txt').content, 'one\nTWO\nthree\n')

  assert.throws(() => applyWorkspaceCall(updated.workspaces, {
    workspaceId: wsId, revisionName: 'Move', action: 'move', path: 'a.txt', to: 'src/b.txt',
  }, { msgId: 'm5', uid }), /already exists/)
  assert.throws(() => applyWorkspaceCall(moved.workspaces, { workspaceId: wsId, action: 'read', path: 'a.txt' }, { msgId: 'm6', uid }), /not found for read/i)
})

test('compactWorkspaceHistory does not treat inspections as writes or hide full reads behind a page', () => {
  const read = (id, result) => ({ id, name: 'workspace_upsert', arguments: JSON.stringify({ action: 'read', workspaceId: 'ws', revisionName: id, path: 'app.js' }), result: JSON.stringify(result) })
  const inspection = (id, action) => ({ id, name: 'workspace_upsert', arguments: JSON.stringify({ action, workspaceId: 'ws', revisionName: id, path: 'app.js', query: 'x' }), result: JSON.stringify({ workspaceId: 'ws', action, fileCount: 1 }) })
  const full = { workspaceId: 'ws', path: 'app.js', action: 'read', files: ['app.js'], content: 'full body', startLine: 1, hasMore: false }
  const page = { workspaceId: 'ws', path: 'app.js', action: 'read', files: ['app.js'], content: 'lines 10-20', startLine: 10, endLine: 20, hasMore: true }
  const rounds = [{ text: '', calls: [
    read('r1', full),
    inspection('l1', 'list'), inspection('s1', 'search'), inspection('d1', 'diff'),
    read('r2', page),
  ] }]
  const out = compactWorkspaceHistory([{ id: 'm', r: 'assistant', toolRounds: rounds }])
  assert.equal(JSON.parse(out[0].toolRounds[0].calls[0].result).content, 'full body', 'a paged read must not elide a full read')
  assert.equal(JSON.parse(out[0].toolRounds[0].calls[1].result).content, undefined)
  assert.equal(JSON.parse(out[0].toolRounds[0].calls[4].result).content, 'lines 10-20')
  // A real write still makes every earlier read stale.
  const write = { id: 'w1', name: 'workspace_upsert', arguments: JSON.stringify({ action: 'move', workspaceId: 'ws', revisionName: 'Move', path: 'app.js', to: 'src/app.js' }), result: JSON.stringify({ workspaceId: 'ws', action: 'moved', fileCount: 1 }) }
  const after = compactWorkspaceHistory([{ id: 'm', r: 'assistant', toolRounds: [{ text: '', calls: [read('r1', full), write, read('r2', page)] }] }])
  assert.equal(JSON.parse(after[0].toolRounds[0].calls[0].result).content, undefined)
  assert.match(JSON.parse(after[0].toolRounds[0].calls[0].result).contentNote, /changed after this read/)
})

test('compactWorkspaceHistory drops duplicate inspection snapshots only', () => {
  const call = (id, args, result) => ({ id, name: 'workspace_upsert', arguments: JSON.stringify({ workspaceId: 'ws', revisionName: id, ...args }), result: JSON.stringify({ workspaceId: 'ws', fileCount: 1, ...result }) })
  const search = (id, query, match) => call(id, { action: 'search', query }, { action: 'searched', totalMatches: 1, matches: [match] })
  const list = (id, tree) => call(id, { action: 'list' }, { action: 'listed', tree })
  const diff = (id, text) => call(id, { action: 'diff', path: 'app.js' }, { action: 'diffed', diff: text })
  const rounds = [{ text: '', calls: [
    search('s1', 'todo', { path: 'a.js', line: 1, text: 'TODO' }),
    search('s2', 'todo', { path: 'b.js', line: 2, text: 'TODO' }),
    search('s3', 'fix', { path: 'c.js', line: 3, text: 'fix' }),
    list('l1', 'old tree'),
    list('l2', 'new tree'),
    diff('d1', '-a\n+b'),
    diff('d2', '-c\n+d'),
  ] }]
  const out = compactWorkspaceHistory([{ id: 'm', r: 'assistant', toolRounds: rounds }])
  const calls = out[0].toolRounds[0].calls.map((c) => JSON.parse(c.result))
  assert.equal(calls[0].matches, undefined)
  assert.match(calls[0].matchesNote, /same search omitted/)
  assert.deepEqual(calls[1].matches, [{ path: 'b.js', line: 2, text: 'TODO' }])
  assert.deepEqual(calls[2].matches, [{ path: 'c.js', line: 3, text: 'fix' }], 'a different query is not a duplicate')
  assert.equal(calls[3].tree, undefined)
  assert.match(calls[3].treeNote, /earlier file tree/)
  assert.equal(calls[4].tree, 'new tree')
  assert.equal(calls[5].diff, undefined)
  assert.match(calls[5].diffNote, /earlier diff/)
  assert.equal(calls[6].diff, '-c\n+d')
  // The stored history keeps everything.
  assert.deepEqual(JSON.parse(rounds[0].calls[0].result).matches, [{ path: 'a.js', line: 1, text: 'TODO' }])
})
