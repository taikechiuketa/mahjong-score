const {JSDOM,VirtualConsole}=require('jsdom');
const {IDBFactory}=require('fake-indexeddb');const {webcrypto}=require('node:crypto');
const fs=require('node:fs');const vm=require('node:vm');const assert=require('node:assert/strict');
async function check(session){
 const dom=new JSDOM(fs.readFileSync('rules.html','utf8'),{url:'https://example.test/rules.html',runScripts:'outside-only',virtualConsole:new VirtualConsole()});
 const w=dom.window,calls=[];Object.defineProperty(w,'crypto',{value:webcrypto});w.TextEncoder=TextEncoder;w.indexedDB=new IDBFactory();w.AbortSignal=AbortSignal;w.confirm=()=>true;
 const oldBody={game:'対局ルール',chips:'チップ条件',penalties:'ペナルティ',manners:'マナー'};
 w.fetch=async(url,o={})=>{calls.push({url,...o});let data;
  if(url.includes('/token'))data={user:{id:'805a1a29-f048-4dc4-9671-93155fb13d2c'},access_token:'test-token',refresh_token:'new-refresh',expires_in:3600};
  else if(o.method==='PATCH')data=[JSON.parse(o.body)];
  else data=[{body:oldBody,revision:'old-revision'}];
  return {ok:true,status:200,json:async()=>data};
 };
 if(session)w.localStorage.setItem('takechao-cloud-session-v1',JSON.stringify({refresh:'old-refresh',revision:'saved-revision',ready:true}));
 w.eval(fs.readFileSync('data-safety.js','utf8'));await w.TakechartSafety.ready;
 const code=[...fs.readFileSync('rules.html','utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];vm.runInContext(code,dom.getInternalVMContext());
 for(let i=0;i<10;i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(w.document.getElementById('ruleSave').disabled,!session);
 if(session){await w.document.getElementById('ruleEditor').onsubmit({preventDefault(){}});assert(calls.some(c=>c.method==='PATCH'));assert((await w.TakechartSafety.all()).some(r=>r.kind==='rulebook-before-write'));const s=JSON.parse(w.localStorage.getItem('takechao-cloud-session-v1'));assert.equal(s.revision,'saved-revision');assert.equal(s.refresh,'new-refresh');}
 else assert(!calls.some(c=>c.method==='PATCH'));
 assert.equal(w.document.getElementById('rulePassword'),null);dom.window.close();
 console.log('PASS ルール編集 '+(session?'共通ログインと本文の事前保護':'未ログインでは編集保存不可'));
}
(async()=>{await check(false);await check(true)})().catch(e=>{console.error(e);process.exitCode=1});
