import { spawn } from 'node:child_process'
import { createServer } from 'vite'

const api = spawn(process.execPath, ['server.mjs'], { stdio: 'inherit', env: process.env })
let vite
try {
  vite = await createServer()
  await vite.listen()
  vite.printUrls()
} catch (error) {
  api.kill()
  throw error
}
const stop = async () => { await vite.close(); api.kill(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
api.on('exit', (code) => { if (code && code !== 0) process.exitCode = code })
