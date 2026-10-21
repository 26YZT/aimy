import process from 'node:process'

import { open } from 'node:fs/promises'
import { resolve } from 'node:path'

import { formatVrmInspectionReport, inspectVrm } from '../packages/stage-ui/src/models/vrm-inspection'

/**
 * Print a local VRM handoff report. This command never loads textures or runs the model.
 *
 * Call stack:
 * inspect-vrm <local-file.vrm>
 *   -> inspectVrm
 *   -> formatVrmInspectionReport
 */
async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 1 || !args[0].toLowerCase().endsWith('.vrm'))
    throw new Error('USAGE: inspect-vrm <local-file.vrm>')
  const file = await open(resolve(args[0]), 'r')
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > 256 * 1024 * 1024)
      throw new Error('INVALID_FILE_SIZE_OR_TYPE')
    const report = inspectVrm(await file.readFile())
    process.stdout.write(`${formatVrmInspectionReport(report)}\n`)
    process.exitCode = report.status === 'invalid' ? 1 : 0
  }
  finally {
    await file.close()
  }
}

main().catch(() => {
  process.stderr.write('Cannot inspect this file. Use one local .vrm file below 256 MiB.\n')
  process.exitCode = 1
})
