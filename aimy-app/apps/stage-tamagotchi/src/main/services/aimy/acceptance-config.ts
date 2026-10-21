import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

import { AcceptanceBudgetError } from '@proj-airi/stage-ui/stores/memory/budget'

import { AcceptanceBudgetLedger } from './acceptance-budget'

/** Resolves existing parents without creating the ledger directory as a side effect. */
async function canonicalPath(path: string): Promise<string> {
  let cursor = resolve(path)
  const missing: string[] = []
  while (true) {
    try {
      return resolve(await realpath(cursor), ...missing.reverse())
    }
    catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
        throw new AcceptanceBudgetError('invalid-input')
      const parent = dirname(cursor)
      if (parent === cursor)
        throw new AcceptanceBudgetError('invalid-input')
      missing.push(basename(cursor))
      cursor = parent
    }
  }
}

/** Explicit acceptance configuration is separate from both userData and ordinary product settings. */
export async function loadAcceptanceLedger(configPath: string | undefined, userDataPath: string) {
  if (!configPath)
    return
  if (!isAbsolute(configPath) || (await stat(configPath)).size > 64 * 1024)
    throw new AcceptanceBudgetError('invalid-input')
  const parsed: unknown = JSON.parse(await readFile(configPath, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || !('ledgerPath' in parsed) || !('campaign' in parsed)
    || typeof parsed.ledgerPath !== 'string' || !isAbsolute(parsed.ledgerPath)
    || Object.keys(parsed).some(key => key !== 'ledgerPath' && key !== 'campaign')) {
    throw new AcceptanceBudgetError('invalid-input')
  }
  const ledgerPath = await canonicalPath(parsed.ledgerPath)
  const inside = relative(await canonicalPath(userDataPath), ledgerPath)
  if (!inside || (inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside)))
    throw new AcceptanceBudgetError('invalid-input')
  // The ledger's Valibot boundary validates the complete campaign before touching its file.
  return new AcceptanceBudgetLedger({ filePath: ledgerPath, campaign: parsed.campaign as ConstructorParameters<typeof AcceptanceBudgetLedger>[0]['campaign'] })
}
