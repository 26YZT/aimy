import type { InferOutput } from 'valibot'

import { array, boolean, check, finite, integer, literal, maxLength, maxValue, minLength, minValue, number, object, optional, parse, picklist, pipe, strictObject, string, union, variant } from 'valibot'

const identifier = pipe(string(), minLength(1), maxLength(100))
const text = pipe(string(), minLength(1), maxLength(500))
const conditionSchema = union([
  strictObject({ field: literal('text'), operator: picklist(['contains', 'equals']), value: text }),
  strictObject({ field: literal('source'), operator: literal('equals'), value: picklist(['chat-complete', 'idle', 'manual']) }),
  strictObject({ field: literal('speaking'), operator: literal('equals'), value: boolean() }),
])
const actionSchema = strictObject({
  type: picklist(['followup', 'review', 'none']),
  delayMinutes: optional(pipe(numberValue(), integer(), minValue(1), maxValue(60))),
})

function numberValue() {
  return pipe(number(), finite())
}

const ruleSchema = strictObject({
  id: identifier,
  name: text,
  enabled: boolean(),
  priority: pipe(numberValue(), integer(), minValue(-1000), maxValue(1000)),
  mode: picklist(['all', 'any']),
  conditions: pipe(array(conditionSchema), minLength(1), maxLength(32)),
  action: actionSchema,
})
const eventSchema = object({
  source: picklist(['chat-complete', 'idle', 'manual']),
  text: pipe(string(), maxLength(100_000)),
  now: numberValue(),
  speaking: boolean(),
})

/** A local event owned by the existing AIRI chat or companion controller. */
export type DesktopEvent = InferOutput<typeof eventSchema>
/** Persisted rules select a local action. They never execute code or send messages. */
export type WorkflowRule = InferOutput<typeof ruleSchema>
/** The existing companion owner applies this decision after its own lifecycle checks. */
export interface WorkflowDecision {
  ruleId: string
  action: WorkflowRule['action']
}

const nodeSchema = variant('type', [
  strictObject({ id: identifier, type: literal('event') }),
  strictObject({ id: identifier, type: literal('condition'), input: identifier, condition: conditionSchema }),
  strictObject({ id: identifier, type: literal('group'), inputs: pipe(array(identifier), minLength(1), maxLength(32)), mode: picklist(['all', 'any']) }),
  strictObject({ id: identifier, type: literal('decision'), input: identifier, ruleId: identifier, action: actionSchema }),
])
const graphSchema = strictObject({
  version: literal(1),
  nodes: pipe(array(nodeSchema), minLength(3), maxLength(35)),
  output: identifier,
})

/** A finite, side-effect-free graph compiled from one rule. No user-defined evaluators run here. */
export type WorkflowGraph = InferOutput<typeof graphSchema>
type WorkflowNode = WorkflowGraph['nodes'][number]
type PortType = 'event' | 'boolean' | 'decision'
type PortValue = DesktopEvent | boolean | WorkflowDecision | null

/** Reject the complete configuration when a rule is malformed or IDs repeat. */
export function parseRules(input: unknown): WorkflowRule[] {
  return parse(pipe(array(ruleSchema), maxLength(64), check(rules => new Set(rules.map(rule => rule.id)).size === rules.length, 'Duplicate rule ID')), input)
}

function outputType(node: WorkflowNode): PortType {
  if (node.type === 'event')
    return 'event'
  return node.type === 'decision' ? 'decision' : 'boolean'
}

function inputs(node: WorkflowNode): string[] {
  if (node.type === 'event')
    return []
  return node.type === 'group' ? node.inputs : [node.input]
}

/** Validate identifiers, port types, reachability, and cycles before any evaluation. */
export function validateGraph(input: unknown): WorkflowGraph {
  const graph = parse(graphSchema, input)
  const nodes = new Map(graph.nodes.map(node => [node.id, node]))
  if (nodes.size !== graph.nodes.length || nodes.get(graph.output)?.type !== 'decision')
    throw new Error('INVALID_GRAPH_OUTPUT_OR_ID')
  if (graph.nodes.filter(node => node.type === 'event').length !== 1 || graph.nodes.filter(node => node.type === 'decision').length !== 1)
    throw new Error('INVALID_GRAPH_ENDPOINTS')
  const visited = new Set<string>()
  const visiting = new Set<string>()
  function visit(id: string) {
    if (visiting.has(id))
      throw new Error('CYCLIC_GRAPH')
    if (visited.has(id))
      return
    const node = nodes.get(id)
    if (!node)
      throw new Error('MISSING_GRAPH_NODE')
    visiting.add(id)
    for (const sourceId of inputs(node)) {
      const source = nodes.get(sourceId)
      const expected = node.type === 'condition' ? 'event' : 'boolean'
      if (!source || outputType(source) !== expected)
        throw new Error('INVALID_GRAPH_PORT')
      visit(sourceId)
    }
    visiting.delete(id)
    visited.add(id)
  }
  visit(graph.output)
  if (visited.size !== nodes.size)
    throw new Error('UNREACHABLE_GRAPH_NODE')
  return graph
}

/** Compile conditions into typed nodes without importing the Kirara implementation or schema. */
export function compileRule(input: WorkflowRule): WorkflowGraph {
  const rule = parse(ruleSchema, input)
  return validateGraph({
    version: 1,
    output: 'decision',
    nodes: [
      { id: 'event', type: 'event' },
      ...rule.conditions.map((condition, index) => ({ id: `condition-${index}`, type: 'condition', input: 'event', condition })),
      { id: 'group', type: 'group', mode: rule.mode, inputs: rule.conditions.map((_, index) => `condition-${index}`) },
      { id: 'decision', type: 'decision', input: 'group', ruleId: rule.id, action: rule.action },
    ],
  })
}

function matches(condition: WorkflowRule['conditions'][number], event: DesktopEvent) {
  if (condition.field === 'speaking')
    return event.speaking === condition.value
  if (condition.field === 'source')
    return event.source === condition.value
  return condition.operator === 'contains' ? event.text.includes(condition.value) : event.text === condition.value
}

function validOutput(type: PortType, value: PortValue) {
  if (type === 'boolean')
    return typeof value === 'boolean'
  if (type === 'decision')
    return value === null || (typeof value === 'object' && 'ruleId' in value && 'action' in value)
  return typeof value === 'object' && value !== null && 'source' in value && 'text' in value
}

/**
 * Evaluate a validated finite graph. Malformed data and cancellation return no decision.
 * The graph owns no timers, model calls, storage, or output side effects.
 */
export function executeGraph(input: WorkflowGraph, eventInput: DesktopEvent, options: { signal?: AbortSignal } = {}): WorkflowDecision | null {
  try {
    const graph = validateGraph(input)
    const event = parse(eventSchema, eventInput)
    const nodes = new Map(graph.nodes.map(node => [node.id, node]))
    const values = new Map<string, PortValue>()
    function evaluate(id: string): PortValue {
      if (options.signal?.aborted)
        throw new Error('GRAPH_CANCELLED')
      if (values.has(id))
        return values.get(id)!
      const node = nodes.get(id)!
      let value: PortValue
      if (node.type === 'event') {
        value = event
      }
      else if (node.type === 'condition') {
        const upstream = parse(eventSchema, evaluate(node.input))
        value = matches(node.condition, upstream)
      }
      else if (node.type === 'group') {
        const flags = node.inputs.map(inputId => parse(boolean(), evaluate(inputId)))
        value = node.mode === 'all' ? flags.every(Boolean) : flags.some(Boolean)
      }
      else {
        value = parse(boolean(), evaluate(node.input)) ? { ruleId: node.ruleId, action: parse(actionSchema, node.action) } : null
      }
      if (!validOutput(outputType(node), value))
        throw new Error('INVALID_GRAPH_RESULT')
      values.set(id, value)
      return value
    }
    const result = evaluate(graph.output)
    return result && typeof result === 'object' && 'ruleId' in result ? result : null
  }
  catch {
    return null
  }
}

/** Stable priority order selects at most one local action. Invalid input leaves the original path unchanged. */
export function evaluateRules(input: readonly WorkflowRule[], event: DesktopEvent): WorkflowDecision | null {
  try {
    const rules = parseRules(input)
    parse(eventSchema, event)
    for (const rule of rules.filter(rule => rule.enabled).sort((a, b) => b.priority - a.priority)) {
      const result = executeGraph(compileRule(rule), event)
      if (result)
        return result
    }
  }
  catch {
    // Invalid saved data never creates a companion action.
  }
  return null
}
