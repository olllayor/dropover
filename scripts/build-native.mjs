import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const repoRoot = resolve(import.meta.dirname, '..')
const packagePath = resolve(repoRoot, 'native/DropShelfNativeAgent')
const outputBinary = resolve(repoRoot, 'native/bin/DropShelfNativeAgent')

execFileSync(
  'swift',
  ['build', '--configuration', 'release', '--package-path', packagePath, '--product', 'DropShelfNativeAgent'],
  { cwd: repoRoot, stdio: 'inherit' }
)

const sourceBinary = resolve(packagePath, '.build/release/DropShelfNativeAgent')

if (!existsSync(sourceBinary)) {
  throw new Error(`Native helper binary was not produced at ${sourceBinary}`)
}

mkdirSync(dirname(outputBinary), { recursive: true })
cpSync(sourceBinary, outputBinary)
