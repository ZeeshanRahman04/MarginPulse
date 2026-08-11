import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const children = []

function start(command, args, label, cwd = root) {
  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  })
  child.on('exit', (code, signal) => {
    if (signal) return
    if (code && code !== 0) {
      console.error(`[${label}] exited with code ${code}`)
      shutdown(code)
    }
  })
  children.push(child)
  return child
}

function shutdown(code = 0) {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

console.log('Starting API on :4000 and Vite on :5173…')
start('npm', ['run', 'start', '-w', '@margin-pulse/backend'], 'api')
start('npm', ['run', 'dev', '-w', '@margin-pulse/frontend'], 'vite')
