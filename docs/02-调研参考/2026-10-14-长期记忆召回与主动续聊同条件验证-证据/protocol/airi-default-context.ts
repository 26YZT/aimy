import fs from 'node:fs'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { createChatOrchestratorRuntime } from '/Users/mima1234/Documents/aimy/aimy-app/packages/core-agent/src/runtime/chat-orchestrator-runtime.ts'
import { conversationToChatMessages } from '/Users/mima1234/Documents/aimy/aimy-app/packages/core-agent/src/messages/chat-completions.ts'
import { compactConversationEntries } from '/Users/mima1234/Documents/aimy/aimy-app/packages/core-agent/src/messages/compaction.ts'

const directory = '/tmp/aimy-20261014-memory-ab'
const fixture = JSON.parse(fs.readFileSync(`${directory}/fixtures.json`, 'utf8'))
const now = fixture.clock_epoch * 1000
const sessions: Record<string, any[]> = {
  A: [{id:'SYS-A',role:'system',content:'合成角色系统提示',createdAt:now},...fixture.memory_cases[0].messages.map((m:any) => ({id:m.id,role:'user',content:m.text,createdAt:now}))],
  B: [{id:'SYS-B',role:'system',content:'合成角色系统提示',createdAt:now}],
  C: [{id:'SYS-C',role:'system',content:'合成角色系统提示',createdAt:now},...fixture.recall_corpus.map((r:any) => ({id:r.source_message_ids[0],role:'user',content:r.content,createdAt:r.created_at*1000}))],
}
const captures: any[] = []
let nextId = 0
let activeSession = 'A'
const runtime = createChatOrchestratorRuntime({
  session: {
    ensureSession: id => {sessions[id] ??= []},
    getSessionMessages: id => sessions[id] ?? [],
    appendSessionMessage: (id,message) => {sessions[id].push(message)},
    commitUserMessage: async (id,message) => {sessions[id].push(message);return {status:'inserted',messageId:message.id}},
    getSessionGeneration: () => 0,
  },
  context: {ingest: () => {},snapshot: () => ({})},
  foregroundStream: {patch: () => {},reset: () => {}},
  llm: {stream: async (_model,_provider,conversation,options) => {
    const messages = conversationToChatMessages(conversation)
    captures.push({session:activeSession,conversation:structuredClone(conversation),providerMessages:messages})
    await options?.onStreamEvent?.({type:'text-delta',text:'合成固定回复'})
    await options?.onStreamEvent?.({type:'finish'})
  }},
  getActiveSessionId: () => activeSession,
  getActiveProvider: () => 'FIXED-OFFLINE',
  now: () => now,
  monotonicNow: () => 1000,
  createId: () => `SYNTHETIC-${nextId++}`,
})
const provider = {generation: () => ({protocol:'chat-completions' as const,config:{model:'FIXED-NO-NETWORK',baseURL:'http://unused.invalid/'}})}
for (const id of ['A','B','C']) {
  activeSession = id
  await runtime.ingest(id==='C'?fixture.recall_queries[5].text:'我喜欢什么饮料',{model:'FIXED-NO-NETWORK',chatProvider:provider})
}
assert(JSON.stringify(captures[0].providerMessages).includes('我喜欢美式咖啡'))
assert(!JSON.stringify(captures[1].providerMessages).includes('我喜欢美式咖啡'))
assert(fixture.recall_corpus.every((r:any) => JSON.stringify(captures[2].providerMessages).includes(r.content)))
const raw = fixture.recall_corpus.map((r:any) => ({role:'user' as const,content:r.content}))
const rawCompaction = compactConversationEntries({entries:raw,recentTurnLimit:5})
assert.deepEqual(rawCompaction,raw)
const block = [{id:'SYNTHETIC-HISTORY',role:'event' as const,segments:[{type:'history-block' as const,compacted:false,items:fixture.recall_corpus.map((r:any,i:number) => ({type:'turn' as const,turnType:'synthetic-chat',turnIndex:i+1,actor:'user',action:{kind:'text' as const,text:r.content}}))}]}]
const structuredCompaction = compactConversationEntries({entries:block,recentTurnLimit:5}) as any[]
assert.equal(structuredCompaction[0].segments[0].items.filter((x:any) => x.type==='turn').length,5)
assert.equal(structuredCompaction[0].segments[0].items[0].text,'Compacted 27 older turns with paired reactions.')
const hashes = ['packages/core-agent/src/runtime/chat-orchestrator-runtime.ts','packages/core-agent/src/messages/chat-completions.ts','packages/core-agent/src/messages/compaction.ts','packages/stage-ui/src/stores/chat.ts','packages/stage-ui/src/stores/chat/session-store.ts'].map(p => {const path=`/Users/mima1234/Documents/aimy/aimy-app/${p}`;return {path,sha256:crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex')}})
const result = {date:'2026-10-14',fixture_sha256:crypto.createHash('sha256').update(fs.readFileSync(`${directory}/fixtures.json`)).digest('hex'),captures,observations:[
  {id:'AIRI-CTX01',observation:'same session original prior user text is in actual runtime provider projection',priorFactPresent:true,contract_outcome:'pass'},
  {id:'AIRI-CTX02',observation:'new session does not import earlier session fact in this default-shaped harness',priorFactPresent:false,contract_outcome:'unsupported',limit:'no external runtime context provider or memory extraction attached; not all possible integrations/character configurations'},
  {id:'AIRI-CTX03',observation:'all32 same-session raw messages remain available for unrelated Q06; no query-ranked top5 performed',historyRecords:32,contract_outcome:'unsupported',limit:'history inclusion is not a retrieval answer or a factual error; fixed fake LLM did not interpret it'},
  {id:'AIRI-CAP01',observation:'actual compaction leaves32 raw chat entries unchanged',entries:rawCompaction.length,contract_outcome:'unsupported',limit:'function contract only compacts structured history blocks; not evidence default desktop applies it'},
  {id:'AIRI-CAP02',observation:'actual explicit synthetic history block retains5 turns with generic count summary',keptTurns:5,defaultSummary:structuredCompaction[0].segments[0].items[0].text,contract_outcome:'pass',limit:'generic count summary is not persistent factual summary; no domain summary formatter supplied'},
],compaction:{rawInput:raw,rawOutput:rawCompaction,structuredInput:block,structuredOutput:structuredCompaction},sourceHashes:hashes,true_boundaries:['actual original chat orchestrator and chat-completion projection','actual original compaction function'],fake_boundaries:['session IO is synthetic in-memory port','context snapshot empty, standard role prompt only','LLM fixed delta/finish, no real provider','foreground UI sink recorder/noop'],model_calls:0,product_code_changed:false,full_electron_restart_tested:false}
fs.writeFileSync(`${directory}/airi-default-context-results.json`,JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify({runtimeRequests:captures.length,observations:result.observations.length,sameSessionHasPriorFact:true,newSessionHasPriorFact:false,rawCompactionEntries:rawCompaction.length,structuredRecentTurns:5}))
