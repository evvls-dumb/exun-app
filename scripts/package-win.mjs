import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { build, Platform, Arch } from 'electron-builder'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const bundleKey = process.argv.includes('--bundle-ai-key')
const stagingDirectory = join(root, 'out', 'tester-env')
const stagedEnv = join(stagingDirectory, '.env.local')

try {
  if (bundleKey) {
    let localEnv = {}
    try {
      localEnv = parseEnv(await readFile(join(root, '.env.local'), 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    const key = (process.env.GROQ_API_KEY || localEnv.GROQ_API_KEY || '').trim()
    if (!/^[A-Za-z0-9_-]{20,}$/.test(key)) {
      throw new Error('Set a valid GROQ_API_KEY in .env.local or the environment before building for testers.')
    }
    await mkdir(stagingDirectory, { recursive: true })
    await writeFile(stagedEnv, `GROQ_API_KEY=${key}\n`, { mode: 0o600 })
    console.log('Bundling the Groq API key for trusted testers. The key is recoverable from this executable.')
  }

  const artifacts = await build({
    projectDir: root,
    targets: Platform.WINDOWS.createTarget('portable', Arch.x64),
    publish: 'never',
    config: {
      appId: 'com.janus.app',
      productName: 'Janus',
      directories: { output: 'dist' },
      files: ['out/main/**/*', 'out/preload/**/*', 'out/renderer/**/*', 'package.json'],
      extraResources: bundleKey ? [{ from: stagedEnv, to: '.env.local' }] : [],
      asar: true,
      npmRebuild: false,
      electronDist: join(root, 'node_modules', 'electron', 'dist'),
      artifactName: bundleKey
        ? 'Janus-${version}-win-${arch}-testers.${ext}'
        : 'Janus-${version}-win-${arch}.${ext}',
      win: { icon: 'src/assets/logo.png' },
      portable: { requestExecutionLevel: 'user' }
    }
  })
  for (const artifact of artifacts) console.log(`Built: ${artifact}`)
} finally {
  await rm(stagedEnv, { force: true })
}
