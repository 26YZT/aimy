const fs = await import('node:fs/promises');
const task = await taskSpace(53);
const page = task.page('p1');
const first = await page.evaluate(async () => {
  const id = LongTerm.list()[0].id;
  const removed = LongTerm.remove(id);
  await AiriAudit.chatSessionsRepo.deleteSession('SYNTHETIC-SESSION-A');
  return {ryzaRemoved:removed,ryzaWriteOk:LongTerm.lastWriteOk(),chat:await AiriAudit.chatSessionsRepo.getSession('SYNTHETIC-SESSION-A'),ryza:LongTerm.list()};
});
await page.reload();
const restored = await page.evaluate(async () => ({chat:await AiriAudit.chatSessionsRepo.getSession('SYNTHETIC-SESSION-A'),ryza:LongTerm.list()}));
if (!first.ryzaRemoved || !first.ryzaWriteOk || restored.chat!==null || restored.ryza.length) throw new Error('Native deletion readback contract mismatch');
const result = {phase:'delete_and_fresh_realm_read',first,restored,limitations:['AIRI whole dialogue session deletion differs from per-fact forgetting','no concurrent model response or semantic delete barrier in this browser case','session index metadata intentionally not mutated by direct deleteSession helper']};
await fs.writeFile('/tmp/aimy-20261014-memory-ab-browser/delete-fresh-page-read.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({phase:result.phase,chatAbsent:restored.chat===null,ryzaEntries:restored.ryza.length}));
