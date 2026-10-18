import { spawn } from 'node:child_process'
import { createServer } from 'vite'

const api = spawn(process.execPath, ['server.mjs'], { stdio: 'inherit', env: process.env })
let vite = null
let stopping = false

const stop = async (code = 0) => {
  if (stopping) return
  stopping = true
  if (vite) await vite.close().catch(() => {})
  if (api.exitCode === null && api.signalCode === null) api.kill()
  process.exit(code)
}

// Register before Vite starts so an API failure during startup (for example a
// port that is already in use) shuts the dev server down instead of leaving a
// frontend whose every /api call fails.
api.on('exit', (code, signal) => {
  if (stopping) return
  console.error(`\napi server exited (${signal || code}); shutting down.`)
  void stop(code ?? 1)
})

try {
  vite = await createServer()
  await vite.listen()
  vite.printUrls()
} catch (error) {
  // Report the startup error itself rather than exiting with a generic code.
  stopping = true
  await vite?.close().catch(() => {})
  api.kill()
  throw error
}

process.on('SIGINT', () => void stop(0))
process.on('SIGTERM', () => void stop(0))
