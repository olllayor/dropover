import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { arch as processArch } from 'node:process'

const repoRoot = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'))
const productName = packageJson.build?.productName ?? packageJson.name
const version = packageJson.version
const arch = processArch === 'arm64' ? 'arm64' : 'x64'
const supportedDmgFormats = new Set(['UDZO', 'UDBZ', 'ULFO'])
const dmgFormat = (process.env.LEDGE_DMG_FORMAT ?? 'ULFO').toUpperCase()

const distDir = resolve(repoRoot, 'dist')
const appPath = join(distDir, `mac-${arch}`, `${productName}.app`)
const stagingDir = join(distDir, 'dmg-staging')
const dmgPath = join(distDir, `${productName}-${version}-${arch}.dmg`)

if (!supportedDmgFormats.has(dmgFormat)) {
  throw new Error(
    `Unsupported LEDGE_DMG_FORMAT "${dmgFormat}". Expected one of: ${[...supportedDmgFormats].join(', ')}`
  )
}

if (!existsSync(appPath)) {
  throw new Error(`Unable to find packaged app at ${appPath}`)
}

rmSync(stagingDir, { recursive: true, force: true })
rmSync(dmgPath, { force: true })
mkdirSync(stagingDir, { recursive: true })

cpSync(appPath, join(stagingDir, `${productName}.app`), { recursive: true })
symlinkSync('/Applications', join(stagingDir, 'Applications'))

execFileSync(
  'hdiutil',
  [
    'create',
    '-volname',
    `${productName} ${version}`,
    '-srcfolder',
    stagingDir,
    '-ov',
    '-format',
    // ULFO is the default because it keeps modern macOS installs fast while still shrinking
    // the GitHub asset. UDBZ is smaller but slower to decompress; UDZO is the fallback.
    dmgFormat,
    dmgPath
  ],
  {
    cwd: repoRoot,
    stdio: 'inherit'
  }
)

rmSync(stagingDir, { recursive: true, force: true })
