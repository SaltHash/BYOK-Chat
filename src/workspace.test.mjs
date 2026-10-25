import test from 'node:test'
import assert from 'node:assert/strict'

const { sanitizePath, parseWorkspaceArgsPartial, truncateWorkspaceContent, groupWorkspaceVersions, countWorkspaceFiles, compactWorkspaceHistory, buildZipEntries, zipFilename, WORKSPACE_MAX_CONTENT, migrateLegacyCanvasGroups, applyUnifiedDiff, diffLines, diffStat, changedFilesBetween, sanitizeHtmlPreview, previewKindFor, parseCsvPreview, WORKSPACE_TEMPLATES, templateById, pendingLiveCalls, findWritingPath } = await import('./workspace.ts')

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
  // Once a path and the name are present, it is reported.
  assert.equal(findWritingPath([{ id: 'w', name: 'workspace_upsert', arguments: JSON.stringify({ path: 'src/app.py' }) }], []), 'src/app.py')
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
