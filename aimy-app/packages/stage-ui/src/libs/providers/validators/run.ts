import type { ProviderValidationCallbacks, ProviderValidationPlan } from '@proj-airi/provider-inference'

import { validateProvider as validateProviderWithRuntime } from '@proj-airi/provider-inference'

import { AcceptanceBudgetError, getAcceptanceBudget } from '../../../stores/memory/budget'

export * from '@proj-airi/provider-inference'

/** Paid acceptance uses the request gate. Provider UI probes cannot bypass its shared ledger. */
export async function validateProvider(
  plan: ProviderValidationPlan,
  contextOptions: Parameters<typeof validateProviderWithRuntime>[1],
  callbacks: ProviderValidationCallbacks = {},
) {
  const freeProbes = new Set(['openai-compatible:check-connectivity', 'openai-compatible:check-model-list'])
  if (getAcceptanceBudget()) {
    if (plan.providerValidators.some(validator => !freeProbes.has(validator.id)))
      throw new AcceptanceBudgetError('paid-validation-disabled')
  }
  return validateProviderWithRuntime({
    ...plan,
    providerValidators: plan.providerValidators.map(validator => ({
      ...validator,
      validator: (...args) => {
        if (getAcceptanceBudget() && !freeProbes.has(validator.id))
          throw new AcceptanceBudgetError('paid-validation-disabled')
        return validator.validator(...args)
      },
    })),
  }, contextOptions, callbacks)
}
