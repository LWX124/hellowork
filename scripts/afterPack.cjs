// scripts/afterPack.cjs
// Re-sign all binaries with ad-hoc signature in strict inside-out order
// to ensure consistent Team ID across the entire .app bundle.
// IMPORTANT: Do NOT use --deep — it recursively re-signs nested content
// and causes Team ID mismatches between Helper apps and Electron Framework.
const { execSync } = require('child_process')
const { join } = require('path')
const { readdirSync, existsSync } = require('fs')

exports.default = async function afterPack(context) {
  if (process.platform !== 'darwin') return

  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const frameworksDir = join(appPath, 'Contents/Frameworks')

  console.log('  • re-signing app bundle (ad-hoc, inside-out)...')

  const sign = (target) => {
    execSync(`codesign --force --sign - "${target}"`, { stdio: 'inherit' })
  }

  // 1. Sign all dylibs (deepest binaries first)
  try {
    const out = execSync(`find "${appPath}" -name "*.dylib"`).toString().trim()
    if (out) out.split('\n').forEach(sign)
  } catch {}

  // 2. Sign Electron Framework inner binary, then the .framework bundle
  const efBinary = join(frameworksDir, 'Electron Framework.framework/Versions/A/Electron Framework')
  const efFramework = join(frameworksDir, 'Electron Framework.framework')
  try { sign(efBinary) } catch {}
  try { sign(efFramework) } catch {}

  // 3. Sign other frameworks
  try {
    readdirSync(frameworksDir)
      .filter(f => f.endsWith('.framework') && f !== 'Electron Framework.framework')
      .forEach(f => { try { sign(join(frameworksDir, f)) } catch {} })
  } catch {}

  // 4. Sign helper apps (they reference Electron Framework via @rpath,
  //    so Framework must already be signed before this step)
  try {
    const out = execSync(`find "${frameworksDir}" -name "*.app" -maxdepth 2`).toString().trim()
    if (out) out.split('\n').forEach(sign)
  } catch {}

  // 5. Sign the main app last
  sign(appPath)
  console.log('  • re-signing complete')
}
