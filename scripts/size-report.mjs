import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const repoRoot = resolve(import.meta.dirname, '..')
const distDir = resolve(repoRoot, 'dist')
const appPath = resolve(distDir, `mac-${process.arch === 'arm64' ? 'arm64' : 'x64'}/Ledge.app`)
const asarPath = resolve(appPath, 'Contents/Resources/app.asar')
const dmgBudgetMiB = Number(process.env.LEDGE_DMG_BUDGET_MIB ?? '100')

if (!Number.isFinite(dmgBudgetMiB) || dmgBudgetMiB <= 0) {
  throw new Error(`Invalid LEDGE_DMG_BUDGET_MIB "${process.env.LEDGE_DMG_BUDGET_MIB}". Expected a positive number.`)
}

function size(path) {
  if (!existsSync(path)) return 'missing'
  return execFileSync('du', ['-sh', path], { cwd: repoRoot, encoding: 'utf8' }).trim().split(/\s+/)[0]
}

function bytes(path) {
  if (!existsSync(path)) return null
  return statSync(path).size
}

function formatBytes(value) {
  if (value === null) return 'missing'
  return `${(value / 1024 / 1024).toFixed(1)} MiB`
}

function findDmgs() {
  if (!existsSync(distDir)) return []
  return readdirSync(distDir)
    .filter((entry) => entry.endsWith('.dmg'))
    .map((entry) => resolve(distDir, entry))
    .sort()
}

function dmgFormat(path) {
  if (!existsSync(path)) return 'missing'

  try {
    const output = execFileSync('hdiutil', ['imageinfo', path], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    return output.match(/^Format:\s+(\S+)/m)?.[1] ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

console.log('\nLedge package size report')
console.log(`app: ${size(appPath)}`)
console.log(`electron framework: ${size(resolve(appPath, 'Contents/Frameworks/Electron Framework.framework'))}`)
console.log(`app.asar: ${size(asarPath)}`)
console.log(`native helper: ${size(resolve(appPath, 'Contents/Resources/native/DropShelfNativeAgent'))}`)
console.log(`renderer: ${size(resolve(repoRoot, 'out/renderer'))}`)
console.log(`DMG budget: ${dmgBudgetMiB} MiB`)

const dmgs = findDmgs()
if (dmgs.length === 0) {
  console.log('DMG: missing')
} else {
  console.log('DMG artifacts:')
  for (const dmg of dmgs) {
    console.log(`  ${formatBytes(bytes(dmg))}\t${dmgFormat(dmg)}\t${dmg.replace(`${repoRoot}/`, '')}`)
  }
}

console.log(`renderer JS/CSS:`)

try {
  const output = execFileSync('find', ['out/renderer', '-type', 'f', '(', '-name', '*.js', '-o', '-name', '*.css', ')', '-print'], {
    cwd: repoRoot,
    encoding: 'utf8'
  })
    .trim()
    .split('\n')
    .filter(Boolean)

  for (const file of output) {
    console.log(`  ${size(resolve(repoRoot, file))}\t${file}`)
  }
} catch {
  console.log('  missing')
}

if (existsSync(asarPath)) {
  const asar = require('@electron/asar')
  const header = asar.getRawHeader(asarPath).header
  const entries = []

  function walk(node, path = '') {
    if (node.files) {
      for (const [name, child] of Object.entries(node.files)) {
        walk(child, `${path}/${name}`)
      }
      return
    }

    entries.push({ path, size: node.size ?? 0 })
  }

  walk(header)
  console.log('top app.asar entries:')
  for (const entry of entries.sort((a, b) => b.size - a.size).slice(0, 12)) {
    console.log(`  ${(entry.size / 1024).toFixed(1)} KB\t${entry.path}`)
  }
}

const overBudgetDmgs = dmgs.filter((dmg) => {
  const dmgBytes = bytes(dmg)
  return dmgBytes !== null && dmgBytes > dmgBudgetMiB * 1024 * 1024
})

if (overBudgetDmgs.length > 0) {
  for (const dmg of overBudgetDmgs) {
    console.error(`DMG exceeds ${dmgBudgetMiB} MiB budget: ${dmg.replace(`${repoRoot}/`, '')} (${formatBytes(bytes(dmg))})`)
  }
  process.exitCode = 1
}
