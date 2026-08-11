import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

async function loadEnvModule(env) {
  const script = `
    const mod = await import(${JSON.stringify(path.join(backendRoot, 'src/config/env.js'))});
    const payload = {
      allowLocalOrigins: mod.config.allowLocalOrigins,
      allowed: {
        localhost5173: mod.isOriginAllowed('http://localhost:5173'),
        loopback5173: mod.isOriginAllowed('http://127.0.0.1:5173'),
        preview4173: mod.isOriginAllowed('http://localhost:4173'),
        loopback4173: mod.isOriginAllowed('http://127.0.0.1:4173'),
        docker8080: mod.isOriginAllowed('http://localhost:8080'),
        randomPort: mod.isOriginAllowed('http://localhost:9999'),
        production: mod.isOriginAllowed('https://app.example.com'),
        evil: mod.isOriginAllowed('https://evil.example'),
        missing: mod.isOriginAllowed(undefined),
      },
      isLocal: {
        localhost: mod.isLocalDemoOrigin('http://localhost:5173'),
        loopback: mod.isLocalDemoOrigin('http://127.0.0.1:3000'),
        remote: mod.isLocalDemoOrigin('https://app.example.com'),
      },
    };
    process.stdout.write(JSON.stringify(payload));
  `
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      cwd: backendRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`env module exited ${code}: ${stderr || stdout}`))
        return
      }
      try {
        resolve(JSON.parse(stdout))
      } catch (error) {
        reject(new Error(`invalid JSON from env module: ${stdout}\n${stderr}\n${error}`))
      }
    })
  })
}

const productionOnly = await loadEnvModule({
  ALLOWED_ORIGINS: 'https://app.example.com',
  ALLOW_LOCAL_ORIGINS: '1',
  NODE_ENV: 'development',
  JWT_SECRET: 'test-secret-for-cors-origins-check-32chars',
})

assert.equal(productionOnly.allowLocalOrigins, true)
assert.equal(productionOnly.allowed.localhost5173, true)
assert.equal(productionOnly.allowed.loopback5173, true)
assert.equal(productionOnly.allowed.preview4173, true)
assert.equal(productionOnly.allowed.loopback4173, true)
assert.equal(productionOnly.allowed.docker8080, true)
assert.equal(productionOnly.allowed.randomPort, true)
assert.equal(productionOnly.allowed.production, true)
assert.equal(productionOnly.allowed.evil, false)
assert.equal(productionOnly.allowed.missing, true)
assert.equal(productionOnly.isLocal.localhost, true)
assert.equal(productionOnly.isLocal.loopback, true)
assert.equal(productionOnly.isLocal.remote, false)

const locked = await loadEnvModule({
  ALLOWED_ORIGINS: 'https://app.example.com',
  ALLOW_LOCAL_ORIGINS: '0',
  NODE_ENV: 'development',
  JWT_SECRET: 'test-secret-for-cors-origins-check-32chars',
})

assert.equal(locked.allowLocalOrigins, false)
// Vite loopback origins stay allowed even when ALLOW_LOCAL_ORIGINS=0.
assert.equal(locked.allowed.localhost5173, true)
assert.equal(locked.allowed.loopback5173, true)
assert.equal(locked.allowed.preview4173, true)
assert.equal(locked.allowed.loopback4173, true)
assert.equal(locked.allowed.production, true)
assert.equal(locked.allowed.evil, false)
// Non-Vite loopback is denied when ALLOW_LOCAL_ORIGINS=0 and not in ALLOWED_ORIGINS.
assert.equal(locked.allowed.docker8080, false)
assert.equal(locked.allowed.randomPort, false)

console.log('cors-origins.test.js: ok')
