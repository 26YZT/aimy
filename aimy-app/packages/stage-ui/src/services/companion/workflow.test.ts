import type { DesktopEvent, WorkflowRule } from './workflow'

import { describe, expect, it } from 'vitest'

import { compileRule, evaluateRules, executeGraph, parseRules, validateGraph } from './workflow'

const event: DesktopEvent = { source: 'chat-complete', text: '明天面试', now: 100, speaking: false }
const rule: WorkflowRule = { id: 'interview', name: 'Interview', enabled: true, priority: 1, mode: 'all', conditions: [{ field: 'text', operator: 'contains', value: '面试' }, { field: 'speaking', operator: 'equals', value: false }], action: { type: 'followup', delayMinutes: 30 } }

describe('local workflow rules', () => {
  it('selects a local action from the actual compiled graph', () => {
    expect(evaluateRules([rule], event)).toEqual({ ruleId: rule.id, action: rule.action })
    expect(executeGraph(compileRule(rule), event)).toEqual({ ruleId: rule.id, action: rule.action })
  })
  it('rejects an all group when one condition does not match', () => {
    expect(evaluateRules([rule], { ...event, speaking: true })).toBeNull()
  })
  it('supports an any group and exact source comparison', () => {
    const input = parseRules([{ ...rule, mode: 'any', conditions: [{ field: 'source', operator: 'equals', value: 'manual' }, { field: 'text', operator: 'equals', value: '面试' }] }])
    expect(evaluateRules(input, event)).toBeNull()
    expect(evaluateRules(input, { ...event, source: 'manual' })?.ruleId).toBe(rule.id)
  })
  it('keeps the original path when disabled, empty, or unmatched', () => {
    expect(evaluateRules([], event)).toBeNull()
    expect(evaluateRules([{ ...rule, enabled: false }], event)).toBeNull()
    expect(evaluateRules([rule], { ...event, text: '散步' })).toBeNull()
  })
  it('uses stable priority and returns the none action explicitly', () => {
    const quiet: WorkflowRule = { ...rule, id: 'quiet', priority: 10, action: { type: 'none' } }
    expect(evaluateRules([rule, quiet], event)).toEqual({ ruleId: 'quiet', action: { type: 'none' } })
    expect(evaluateRules([rule, { ...quiet, priority: rule.priority }], event)?.ruleId).toBe(rule.id)
  })
  it.each([
    [{ ...rule, conditions: [] }],
    [{ ...rule, conditions: [{ field: 'unknown', operator: 'equals', value: true }] }],
    [{ ...rule, conditions: [{ field: 'speaking', operator: 'contains', value: 'false' }] }],
    [{ ...rule, conditions: [{ field: 'text', operator: 'contains', value: '' }] }],
    [{ ...rule, action: { type: 'shell', command: 'echo unsafe' } }],
    [{ ...rule, action: { type: 'followup', delayMinutes: 0 } }],
    [rule, rule],
  ])('rejects malformed saved rules %#', (...input) => {
    expect(() => parseRules(input)).toThrow()
  })
  it('rejects invalid runtime events', () => {
    expect(evaluateRules([rule], { ...event, now: Number.NaN })).toBeNull()
  })
})

describe('typed local graph', () => {
  it('rejects duplicate nodes and missing input', () => {
    const graph = compileRule(rule)
    expect(() => validateGraph({ ...graph, nodes: [...graph.nodes, graph.nodes[0]] })).toThrow()
    expect(() => validateGraph({ ...graph, nodes: graph.nodes.filter(node => node.id !== 'event') })).toThrow()
  })
  it('rejects wrong port types', () => {
    const graph = compileRule(rule)
    expect(() => validateGraph({ ...graph, nodes: graph.nodes.map(node => node.type === 'decision' ? { ...node, input: 'event' } : node) })).toThrow('INVALID_GRAPH_PORT')
  })
  it('rejects cycles', () => {
    const graph = compileRule(rule)
    expect(() => validateGraph({ ...graph, nodes: graph.nodes.map(node => node.type === 'group' ? { ...node, inputs: ['group'] } : node) })).toThrow('CYCLIC_GRAPH')
  })
  it('rejects disconnected nodes and arbitrary evaluator fields', () => {
    const graph = compileRule(rule)
    expect(() => validateGraph({ ...graph, nodes: [...graph.nodes, { id: 'unreachable', type: 'group', mode: 'all', inputs: ['condition-0'] }] })).toThrow('UNREACHABLE_GRAPH_NODE')
    expect(() => validateGraph({ ...graph, nodes: graph.nodes.map(node => ({ ...node, execute: 'alert(1)' })) })).toThrow()
  })
  it('returns no result after cancellation', () => {
    const controller = new AbortController()
    controller.abort()
    expect(executeGraph(compileRule(rule), event, { signal: controller.signal })).toBeNull()
  })
})
