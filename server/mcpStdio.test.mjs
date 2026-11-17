import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { childEnv, safeCwd, stdioServerSpec } = await import('./mcpStdio.mjs')

test('a local server never inherits the host secrets', () => {
  const env = childEnv({ MY_KEY: 'typed' }, { PATH: '/usr/bin', HOME: '/home/u', DATABASE_URL: 'postgres://secret', OPENAI_API_KEY: 'sk-1' })
  assert.equal(env.PATH, '/usr/bin')
  assert.equal(env.HOME, '/home/u')
  assert.equal(env.MY_KEY, 'typed')
  assert.equal(env.DATABASE_URL, undefined)
  assert.equal(env.OPENAI_API_KEY, undefined)
})

test('a relative working directory is refused', () => {
  assert.match(safeCwd('project').error, /absolute/)
})

test('traversal is refused before it is resolved', () => {
  assert.match(safeCwd('/home/you/project/../../etc').error, /\.\./)
})

test('a missing folder is refused', () => {
  assert.match(safeCwd(join(tmpdir(), 'byok-does-not-exist-xyz')).error, /does not exist/)
})

test('a filesystem root is refused', () => {
  assert.match(safeCwd('/').error, /filesystem root/)
})

test('a real project folder is accepted and resolved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'byok-mcp-'))
  const ok = safeCwd(dir)
  assert.equal(ok.error, undefined)
  assert.equal(ok.cwd, dir)
})

test('a file is not a working directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'byok-mcp-file-'))
  const file = join(dir, 'server.mjs')
  writeFileSync(file, '//')
  assert.match(safeCwd(file).error, /not a folder/)
})

test('the server spec carries the resolved folder and its own environment', () => {
  const dir = mkdtempSync(join(tmpdir(), 'byok-mcp-spec-'))
  const spec = stdioServerSpec({ command: 'node', args: ['server.js'], env: { TOKEN: 'x' }, cwd: dir })
  assert.equal(spec.error, undefined)
  assert.equal(spec.server.cwd, dir)
  assert.deepEqual(spec.server.env, { TOKEN: 'x' })
})

test('the server spec refuses a bad folder instead of spawning anyway', () => {
  const spec = stdioServerSpec({ command: 'node', cwd: '/etc/../..' })
  assert.match(spec.error, /\.\./)
})
