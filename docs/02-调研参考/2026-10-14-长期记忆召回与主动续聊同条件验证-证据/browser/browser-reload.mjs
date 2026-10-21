const fs = await import('node:fs/promises');
const task = await taskSpace(53);
const page = task.page('p1');
await page.reload();
const result = await page.evaluate(async () => {
  const sessionId = 'SYNTHETIC-SESSION-A';
  const chat = await AiriAudit.chatSessionsRepo.getSession(sessionId);
  const entries = LongTerm.list();
  if (window.__syntheticRealmMarker !== undefined) throw new Error('Old JS realm survived');
  if (!chat || chat.messages[0].content !== '我喜欢美式咖啡') throw new Error('AIRI native IDB did not restore original synthetic chat');
  if (entries.length!==1 || entries[0].summary!=='用户喜欢美式咖啡') throw new Error('Ryza native localStorage did not restore fixed fact');
  return {phase:'fresh_page_realm_read',oldRealmMarkerAbsent:true,chat,ryza:entries,index:await AiriAudit.chatSessionsRepo.getIndex('SYNTHETIC-MEMORY-AB-USER'),limitations:['same browser process and same isolated origin','not Electron application restart or OS/browser process recovery','AIRI record is dialogue; Ryza entry is manually supplied fixed extraction']};
});
await fs.writeFile('/tmp/aimy-20261014-memory-ab-browser/fresh-page-read.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({phase:result.phase,oldRealmMarkerAbsent:result.oldRealmMarkerAbsent,chatMessages:result.chat.messages.length,ryzaEntries:result.ryza.length}));
