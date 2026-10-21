import { createPinia, setActivePinia } from 'pinia'
import { afterAll, afterEach, expect, it } from 'vitest'
import { commands } from 'vitest/browser'
declare module 'vitest/browser' { interface BrowserCommands { saveObservations: (rows: unknown[]) => Promise<void> } }
import { useCharacterNotebookStore } from './baseline/notebook'
import { FollowupCoordinator, FollowupRepository } from '/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/services/companion/followup'
import { ReviewRepository } from '/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/services/companion/review'
import { storage } from '/Users/mima1234/Documents/aimy/aimy-app/packages/stage-ui/src/database/storage'
import fixture from './proactive-fixtures.json'
import airi from './airi-results.json'
const BASE=fixture.clock_epoch*1000
const owned:string[]=[]
function scope(){const principalId='ab-'+crypto.randomUUID();owned.push(principalId);return {principalId,characterId:'test-character',sessionId:'conv-A'}}
const context=()=>({enabled:true,visible:true,busy:false,maxPerDay:4,quietStartHour:22,quietEndHour:8,isSourceCurrent:()=>true})
const observations:unknown[]=[]
const observe=(value:unknown)=>observations.push(value)
afterAll(async()=>{await commands.saveObservations(observations)})
afterEach(async()=>{for(const id of owned.splice(0)){await storage.removeItem(`local:companion/followup/v1/${id}/test-character`);await storage.removeItem(`local:companion/review/v1/${id}/test-character`)}})
it('compares the same two-minute followup goal against original scheduler observations',async()=>{
 const s=scope(),delivered:number[]=[],generated:number[]=[];let now=BASE
 const c=new FollowupCoordinator(new FollowupRepository(),{generate:async()=>{generated.push(now-BASE);return airi.model_output},deliver:()=>{delivered.push(now-BASE);return true}})
 await c.schedule(s,'same-source',2,BASE)
 for(let ms=2000;ms<=130000;ms+=2000){now=BASE+ms;await c.tick(s,context(),now)}
 const old=airi.cases.find(c=>c.id==='PR02')!
 const baselineTimes=old.observation.stages.filter(s=>s.stage==='generate_start').map(s=>s.time-BASE)
 expect(baselineTimes).toEqual([70000,100000,130000]);expect(generated).toEqual([120000]);expect(delivered).toEqual([120000]);c.dispose()
 observe({id:'PRO-SINGLE',baseline:baselineTimes,aimy:delivered,sameFixedModelOutput:airi.model_output,interpretation:'Stronger fit for strict single followup; original scheduler intentionally supports reminder windows/repetition, not an upstream bug',limits:'Original full factory chain uses explicit fake bindings; current real IndexedDB coordinator uses synthetic generation/delivery, not complete native presentation'})
})
it('retains a pending plan across new repository and browser-store instances',async()=>{
 setActivePinia(createPinia());const notebook=useCharacterNotebookStore();notebook.scheduleTask({title:'稍后继续',details:'同一合成后续话题',dueAt:BASE+120000});expect(notebook.tasks).toHaveLength(1);notebook.$dispose();setActivePinia(createPinia());const restored=useCharacterNotebookStore()
 const s=scope();await new FollowupRepository().schedule(s,'same-source',2,BASE);const reloaded=await new FollowupRepository().read(s)
 expect(restored.tasks).toHaveLength(0);expect(reloaded).toHaveLength(1);expect(reloaded[0].state).toBe('scheduled')
 observe({id:'PRO-PERSIST',baselineFreshStoreTasks:restored.tasks.length,aimyDatabasePlans:reloaded.length,interpretation:'Real IndexedDB plan versus in-memory notebook',limits:'Fresh store/repository, not an OS restart; normal Aimy quit cancels pending plans, so this is not a promise of restart alarms'})
})
it('rejects the same late fixed response after user-return cancellation',async()=>{
 const s=scope(),ready=Promise.withResolvers<string>();let started=false,delivered=0
 const c=new FollowupCoordinator(new FollowupRepository(),{generate:async()=>{started=true;return ready.promise},deliver:()=>{delivered++;return true}})
 await c.schedule(s,'same-source',2,BASE);const pending=c.tick(s,context(),BASE+120000);await expect.poll(()=>started).toBe(true)
 const cancellation=c.cancel(s,'new-message');ready.resolve(airi.model_output);await Promise.all([pending,cancellation]);expect(delivered).toBe(0)
 const old=airi.cases.find(c=>c.id==='PR07')!;expect(old.observation.reactions).toHaveLength(1);c.dispose()
 observe({id:'PRO-CANCEL-LATE',baseline:old.observation.reactions.length,aimy:delivered,interpretation:'Additional cancel-before-delivery guard for new-message followup contract',limits:'Original lacks corresponding user-return cancellation API; no fabricated call to a missing baseline API; fixed generation, synthetic speech sinks'})
})
it('prevents two repository claimers and does not resend an uncertain claim',async()=>{
 const s=scope(),a=new FollowupRepository(),b=new FollowupRepository();await a.schedule(s,'same-source',2,BASE)
 const claims=await Promise.all([a.claim(s,context(),BASE+120000),b.claim(s,context(),BASE+120000)]);expect(claims.filter(Boolean)).toHaveLength(1);await b.recover(s);expect((await a.read(s))[0].state).toBe('unknown');expect(await a.claim(s,context(),BASE+130000)).toBeUndefined()
 observe({id:'PRO-CLAIM',claims:claims.filter(Boolean).length,stateAfterUncertainRecovery:'unknown',resent:false,interpretation:'Additional atomic admission and no blind retry; counterpart not present in baseline notebook API',limits:'Real IndexedDB, two module instances in one browser; process death not injected'})
})
it('cancels invalid scope/source and respects quiet hours without paid calls',async()=>{
 const s=scope(),r=new FollowupRepository();await r.schedule(s,'same-source',2,BASE);expect(await r.claim({...s,sessionId:'conv-B'},context(),BASE+120000)).toBeUndefined()
 await r.schedule(s,'same-source',2,BASE);expect(await r.claim(s,{...context(),isSourceCurrent:()=>false},BASE+120000)).toBeUndefined()
 const late=new Date(2026,9,18,23).getTime();await r.schedule(s,'same-source',2,late);expect(await r.claim(s,context(),late+120000)).toBeUndefined()
 observe({id:'PRO-GUARDS',wrongSessionClaimed:false,removedSourceClaimed:false,quietHoursClaimed:false,interpretation:'Additional scope/source/quiet policy; original globally-scoped task does not promise this contract'})
})
it('invalidates a review after its source changes while retaining the source facts',async()=>{
 const s=scope(),r=new ReviewRepository(),facts=[{factId:'f',factKey:'f',revision:1,category:'plan' as const,subject:'user',label:'围巾',text:'考虑买围巾，还没有买。',keywords:[],status:'current' as const,kind:'direct' as const,sourceVersions:[{sourceId:'s',sourceRevision:1,contentHash:'one'}],dependsOnFactIds:[],confirmationAt:BASE,committedAt:BASE}]
 const before=JSON.stringify(facts);await r.create(s,facts,'week',8,BASE);expect((await r.read(s,facts,BASE))[0].status).toBe('current');facts[0].sourceVersions[0].sourceRevision=2
 expect((await r.read(s,facts,BASE))[0].status).toBe('invalidated');expect(facts[0].text).toBe('考虑买围巾，还没有买。')
 observe({id:'REVIEW-SOURCE',beforeSourceMutation:JSON.parse(before),afterSourceMutation:facts,review:'invalidated',interpretation:'Derived display follows source revisions; no new facts and no proof of stronger recall',limits:'New mechanism only; baseline notebook diary/focus has no same source-bound period-review API'})
})
