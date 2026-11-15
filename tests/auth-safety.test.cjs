const {JSDOM,VirtualConsole}=require('jsdom');
const {IDBFactory}=require('fake-indexeddb');
const {webcrypto}=require('node:crypto');
const fs=require('node:fs');const assert=require('node:assert/strict');const vm=require('node:vm');
const owner='805a1a29-f048-4dc4-9671-93155fb13d2c';
const idle={idle:true,date:'',sequence:0,rate:100,chipRate:100,players:[],rounds:[]};
const players=[{id:'a',masterId:'m1',name:'実名甲',chips:0},{id:'b',masterId:'m2',name:'実名乙',chips:0},{id:'c',masterId:'m3',name:'実名丙',chips:0}];
const set={date:'2026/11/15',sequence:1,rate:100,chipRate:100,archiveId:'set1',players,rounds:[{id:'r1',mode:'normal',scores:{a:50,b:-20,c:-30}}]};
const fixture=()=>({current:structuredClone(idle),history:[structuredClone(set)],master:players.map(p=>({id:p.masterId,name:p.name}))});
const keys=['mahjong-sheet-v2','mahjong-sheet-archive-v1','mahjong-player-master-v1'];
const auth={user:{id:owner},access_token:'test-access',refresh_token:'test-refresh',expires_in:3600};
const tick=()=>new Promise(r=>setTimeout(r,15));
async function settle(w){for(let i=0;i<30;i++){await tick();if(!w.eval('cloudBusy'))return;}throw Error('busy timeout')}
async function app({local,server=fixture(),session=true,fail,baseline,denyBackup=false,publicFail=false}={}){
  const writes=[],calls=[],errors=[];let remote=server?{data:structuredClone(server),updated_at:'rev1'}:undefined;
  let publicRow={results:[],updated_at:'rev1'};
  const html=fs.readFileSync('index.html','utf8').replace(/<script src="\.\/[^\"]+"><\/script>/g,'');
  const dom=new JSDOM(html,{url:'https://example.test/',runScripts:'outside-only',virtualConsole:new VirtualConsole()});
  const w=dom.window;w.scrollTo=()=>{};w.alert=x=>errors.push(x);w.confirm=()=>true;w.prompt=()=>null;
  w.TextEncoder=TextEncoder;Object.defineProperty(w,'crypto',{value:webcrypto});w.indexedDB=new IDBFactory();
  w.AbortSignal=AbortSignal;w.structuredClone=structuredClone;w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{};
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};
  w.fetch=async(url,o={})=>{
    const method=o.method||'GET',path=new URL(url).pathname,body=o.body?JSON.parse(o.body):undefined;
    calls.push({url,method});if(method!=='GET')writes.push({url,method,body});
    if(fail?.(url,o))throw Error('network');
    if(path.includes('/token'))return response(auth);
    if(path.includes('/logout'))return {ok:true,status:204};
    if(path.endsWith('takechao_private_state')){
      if(method==='GET')return response(remote?[structuredClone(remote)]:[]);
      if(method==='PATCH'&&!url.includes(encodeURIComponent(remote.updated_at)))return response([]);
      remote={data:structuredClone(body.data),updated_at:body.updated_at.replace(/Z$/,'+00:00')};return response([structuredClone(remote)]);
    }
    if(path.endsWith('takechao_public_results')){
      if(method==='GET')return response([structuredClone(publicRow)]);
      if(publicFail)throw Error('public offline');
      publicRow=body;return response([body]);
    }
    throw Error('unexpected '+url);
  };
  function response(data){return {ok:true,status:200,json:async()=>structuredClone(data)}}
  if(local){for(const [i,k] of keys.entries())w.localStorage.setItem(k,JSON.stringify([local.current,local.history,local.master][i]));}
  if(session)w.localStorage.setItem('takechao-cloud-session-v1',JSON.stringify({refresh:'test-refresh',revision:'rev1'}));
  w.eval(fs.readFileSync('data-safety.js','utf8'));await w.TakechartSafety.ready;
  if(baseline)await w.TakechartSafety.put({id:'baseline:'+owner,data:baseline,revision:'rev1'});
  if(denyBackup)w.TakechartSafety.checkpoint=async()=>{throw Error('quota')};
  const inline=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  for(const code of inline)vm.runInContext(code,dom.getInternalVMContext());
  vm.runInContext(fs.readFileSync('index-auth.js','utf8'),dom.getInternalVMContext());
  vm.runInContext(fs.readFileSync('set-identity.js','utf8'),dom.getInternalVMContext());
  await settle(w);
  return {w,dom,writes,calls,errors,remote:()=>remote,public:()=>publicRow,setRemote:d=>remote=d};
}
const tests=[];function test(n,f){tests.push([n,f])}
test('新規ログインから自動読み込みし、パスワード欄を消す',async()=>{const a=await app({session:false});a.w.document.getElementById('cloudEmail').value='owner@example.test';a.w.document.getElementById('cloudPassword').value='test-only';await a.w.document.getElementById('cloudLogin').onsubmit({preventDefault(){}});assert(shown(a,'workspace'));assert.equal(a.w.document.getElementById('cloudPassword').value,'');assert.equal(databaseWrites(a).length,0);const copies=JSON.stringify(await a.w.TakechartSafety.all());assert(!copies.includes('test-refresh'));assert(!copies.includes('test-only'));a.dom.window.close()});
function databaseWrites(a){return a.writes.filter(x=>x.url.includes('/rest/v1/'))}
function shown(a,id){return !a.w.document.getElementById(id).hidden}
test('新規端末は未ログイン画面。サンプルやDB書き込みなし',async()=>{const a=await app({session:false});assert(shown(a,'authGate'));assert(!shown(a,'workspace'));assert.equal(a.w.eval('state.players.length'),0);assert.equal(databaseWrites(a).length,0);assert(keys.every(k=>a.w.localStorage.getItem(k)===null));a.dom.window.close()});
test('ログイン済み端末は実データを自動取得。起動だけではDBを更新しない',async()=>{const a=await app();assert(shown(a,'workspace'));assert.equal(a.w.eval('archives().length'),1);assert.match(a.w.document.getElementById('statsTable').textContent,/実名甲/);assert.equal(databaseWrites(a).length,0);assert((await a.w.TakechartSafety.all()).some(r=>r.kind==='cloud'));a.dom.window.close()});
test('旧端末とDBが異なれば両方保護して確認。無断置換なし',async()=>{const local=fixture();local.history.push({...structuredClone(set),archiveId:'only-local',sequence:2});const a=await app({local});assert(shown(a,'reconcileGate'));assert.equal(JSON.parse(a.w.localStorage.getItem(keys[1])).length,2);assert.equal(databaseWrites(a).length,0);a.w.document.getElementById('chooseCloud').click();await settle(a.w);assert.equal(a.w.eval('archives().length'),1);const backups=await a.w.TakechartSafety.all();assert(backups.some(r=>r.data.data?.history?.length===2));a.dom.window.close()});
test('DB接続失敗で旧端末を空データにしない',async()=>{const local=fixture();const a=await app({local,fail:url=>url.includes('private_state')});assert(shown(a,'authGate'));assert.equal(JSON.parse(a.w.localStorage.getItem(keys[1])).length,1);assert.equal(databaseWrites(a).length,0);a.dom.window.close()});
test('復旧コピー失敗時はDBを変更しない',async()=>{const a=await app({denyBackup:true});assert(!shown(a,'workspace'));assert.equal(databaseWrites(a).length,0);a.dom.window.close()});
test('保存は事前コピーを作り、既存セットとIDを保持して公開する',async()=>{const a=await app();a.w.eval("state={...fresh(),idle:false,date:'2026/11/16',sequence:1,players:[],rounds:[]};save()");await a.w.eval('syncCloud()');await settle(a.w);assert.equal(a.remote().data.history[0].archiveId,'set1');assert.equal(a.remote().data.history.length,1);assert.equal(a.public().results.find(x=>x.kind==='sets-v2').sets.length,1);assert((await a.w.TakechartSafety.all()).some(r=>r.kind==='cloud-before-write'));a.dom.window.close()});
test('別端末が先行更新したら送信を停止して競合表示',async()=>{const a=await app();a.setRemote({data:fixture(),updated_at:'rev2'});await a.w.eval('syncCloud()');assert(shown(a,'reconcileGate'));assert.equal(databaseWrites(a).length,0);a.dom.window.close()});
test('公開反映失敗でもDB保存済みを区別する',async()=>{const a=await app({publicFail:true});a.w.eval("state={...fresh(),idle:false,date:'2026/11/16',sequence:1,players:[],rounds:[]};save()");await a.w.eval('syncCloud()');assert.match(a.w.document.getElementById('globalSaveStatus').textContent,/DBに保存済み/);assert(a.w.eval('publicPending'));a.dom.window.close()});
test('一時入力を通算に含めず、保存済みセットを二重集計しない',async()=>{const local=fixture();local.current=structuredClone(set);const a=await app({local,server:local});assert.equal(a.w.document.querySelectorAll('#statsTable tbody tr').length,3);assert.match(a.w.document.getElementById('statsTable').textContent,/\+50 pt/);a.w.eval("state.rounds[0].scores.a=999;renderStats()");assert.match(a.w.document.getElementById('statsTable').textContent,/\+50 pt/);a.dom.window.close()});
test('履歴編集中の入力を端末に保護し復元できる',async()=>{const a=await app();a.w.eval("startHistoryEdit(0);state.rounds[0].scores.a=70;save()");assert.equal(JSON.parse(a.w.localStorage.getItem('takechart-history-draft-v1')).set.rounds[0].scores.a,70);a.dom.window.close()});
test('ログアウトでこの端末の認証を失効。旧形式データと復旧コピーは保持',async()=>{const a=await app();await a.w.eval('logout()');assert(shown(a,'authGate'));assert(!shown(a,'workspace'));assert.equal(a.w.localStorage.getItem('takechao-cloud-session-v1'),null);assert(a.calls.some(x=>x.url.includes('/logout?scope=local')));assert.equal(JSON.parse(a.w.localStorage.getItem(keys[1])).length,1);assert((await a.w.TakechartSafety.all()).some(r=>r.kind==='before-logout'));a.dom.window.close()});
test('端末保存失敗時はDBロードを開始前の値へ戻す',async()=>{const a=await app({session:false});const proto=a.w.Storage.prototype,original=proto.setItem;let once=true;proto.setItem=function(k,v){if(k===keys[1]&&once){once=false;throw Error('quota')}return original.call(this,k,v)};a.w.eval("acceptCloudAuth({user:{id:cloudOwner},access_token:'test',refresh_token:'test',expires_in:3600})");await a.w.eval('connect()');assert(!shown(a,'workspace'));assert(keys.every(k=>a.w.localStorage.getItem(k)===null));assert.equal(databaseWrites(a).length,0);a.dom.window.close()});

test('復旧コピーから端末に戻してもDBへ自動送信しない',async()=>{const a=await app();const old=fixture();old.history.push({...structuredClone(set),archiveId:'recover',sequence:2});await a.w.TakechartSafety.checkpoint('test-recovery',old);a.w.document.getElementById('listRecovery').click();await tick();await tick();const select=a.w.document.getElementById('recoverySelection');select.value=[...select.options].find(o=>o.value.startsWith('test-recovery:')).value;a.w.document.getElementById('restoreRecovery').click();await settle(a.w);assert.equal(a.w.eval('archives().length'),2);assert.equal(databaseWrites(a).length,0);a.dom.window.close()});
test('ログアウト時に復旧コピーが作れなければログアウトを止める',async()=>{const a=await app();a.w.TakechartSafety.checkpoint=async()=>{throw Error('quota')};await a.w.eval('logout()');assert(shown(a,'workspace'));assert(a.w.localStorage.getItem('takechao-cloud-session-v1'));assert(!a.calls.some(x=>x.url.includes('/logout')));a.dom.window.close()});
test('4つのメニューを切り替えても必要な機能へ到達する',async()=>{const a=await app();for(const [id,panel] of [['tabSheet','sheetPage'],['tabStats','statsPage'],['tabHistory','historyPage'],['tabSettings','settingsPage']]){a.w.document.getElementById(id).click();assert(shown(a,panel))}assert(a.w.document.getElementById('settingsPage').contains(a.w.document.getElementById('manageMaster')));assert(a.w.document.getElementById('historyPage').contains(a.w.document.getElementById('historyList')));a.dom.window.close()});

async function changeIdentity(a,date,sequence){
 a.w.document.getElementById('editSetIdentity').click();
 a.w.document.getElementById('setDate').value=date;
 a.w.document.getElementById('setSequence').value=sequence;
 await a.w.document.getElementById('setIdentityForm').onsubmit({preventDefault(){}});
}
test('対局日と連番を編集しても内部ID・点数・チップ・参加者が変わらない',async()=>{
 const data=fixture();data.current=structuredClone(set);const a=await app({server:data});
 await changeIdentity(a,'2026-11-01','3');const current=a.w.eval('JSON.stringify(state)');const result=JSON.parse(current);
 assert.equal(result.date,'2026/11/01');assert.equal(result.sequence,3);assert.equal(result.archiveId,set.archiveId);
 assert.deepEqual(result.players,set.players);assert.deepEqual(result.rounds,set.rounds);
 assert.equal(a.w.eval('archives()[0].date'),'2026/11/15');assert.equal(databaseWrites(a).length,0);
 assert((await a.w.TakechartSafety.all()).some(r=>r.kind==='before-set-identity-edit'));
 a.w.document.getElementById('saveSet').click();await settle(a.w);
 assert.equal(a.remote().data.history.length,1);assert.equal(a.remote().data.history[0].date,'2026/11/01');assert.equal(a.remote().data.history[0].sequence,3);
 a.dom.window.close();
});
test('履歴の対局日・連番も編集し元のセット1件を更新する',async()=>{
 const a=await app();a.w.eval('startHistoryEdit(0)');await changeIdentity(a,'2026-10-31','2');
 assert.equal(JSON.parse(a.w.localStorage.getItem('takechart-history-draft-v1')).set.date,'2026/10/31');
 a.w.document.getElementById('saveSet').click();await settle(a.w);
 assert.equal(a.remote().data.history.length,1);assert.equal(a.remote().data.history[0].archiveId,'set1');assert.equal(a.remote().data.history[0].date,'2026/10/31');
 assert.deepEqual(a.remote().data.history[0].rounds,set.rounds);a.dom.window.close();
});
test('同日同番号への変更を拒否し、別日同番号は許可する',async()=>{
 const data=fixture();data.current=structuredClone(set);data.history.push({...structuredClone(set),archiveId:'other',sequence:2});
 const a=await app({server:data});await changeIdentity(a,'2026-11-15','2');assert.match(a.w.document.getElementById('identityError').textContent,/同じ日付/);assert.equal(a.w.eval('state.sequence'),1);
 await changeIdentity(a,'2026-11-14','2');assert.equal(a.w.eval('state.sequence'),2);assert.equal(databaseWrites(a).length,0);a.dom.window.close();
});
test('無効な日付・0・小数・指数表記を拒否しキャンセルで変更しない',async()=>{
 const data=fixture();data.current=structuredClone(set);const a=await app({server:data});
 for(const [day,n]of [['2026-02-30','2'],['2026-11-15','0'],['2026-11-15','1.5'],['2026-11-15','1e2']]){await changeIdentity(a,day,n);assert(a.w.document.getElementById('identityError').textContent);assert.equal(a.w.eval('state.sequence'),1);assert.equal(a.w.eval('state.date'),'2026/11/15');}
 a.w.document.getElementById('cancelSetIdentity').click();assert(!a.w.document.getElementById('setIdentityDialog').open);assert.equal(databaseWrites(a).length,0);a.dom.window.close();
});
test('変更前コピーが保存できなければ日付・連番を変えない',async()=>{
 const data=fixture();data.current=structuredClone(set);const a=await app({server:data});a.w.TakechartSafety.checkpoint=async()=>{throw Error('quota')};
 await changeIdentity(a,'2026-11-14','2');assert.equal(a.w.eval('state.date'),'2026/11/15');assert.equal(a.w.eval('state.sequence'),1);assert.match(a.w.document.getElementById('identityError').textContent,/変更していません/);a.dom.window.close();
});
test('履歴編集で未保存の進行中セットと同じ日付・番号を選べない',async()=>{
 const data=fixture();delete data.history[0].archiveId;data.current={...structuredClone(set),date:'2026/11/16',sequence:3};delete data.current.archiveId;
 const a=await app({server:data});a.w.eval('startHistoryEdit(0)');await changeIdentity(a,'2026-11-16','3');assert.match(a.w.document.getElementById('identityError').textContent,/同じ日付/);a.dom.window.close();
});

if(process.env.TEST_PUBLIC_SNAPSHOT){
 test('既存181セットの集計・種目別Rが旧版と完全一致しデータを保持',async()=>{
  const {execFileSync}=require('node:child_process');
  const rows=JSON.parse(fs.readFileSync(process.env.TEST_PUBLIC_SNAPSHOT));
  const sets=rows[0].results.find(r=>r.kind==='sets-v2').sets;
  const masters=new Map();for(const set of sets)for(const p of set.players)masters.set(p.masterId,{id:p.masterId,name:p.name,rankingVisible:p.rankingVisible});
  const data={current:structuredClone(idle),history:sets,master:[...masters.values()]};
  const a=await app({server:data});assert.equal(a.w.eval('archives().length'),sets.length);
  const old=execFileSync('git',['show','4fe4b495010abad7448eb6396b822540d2d4a47c:index.html'],{encoding:'utf8'});
  const d=new JSDOM(old,{url:'https://old.example.test/',runScripts:'outside-only'});const w=d.window;w.scrollTo=()=>{};w.alert=()=>{};
  for(const [i,k]of keys.entries())w.localStorage.setItem(k,JSON.stringify([data.current,data.history,data.master][i]));
  for(const match of old.matchAll(/<script>([\s\S]*?)<\/script>/g))vm.runInContext(match[1],d.getInternalVMContext());
  for(const mode of ['all','normal','north','yonma']){
   assert.equal(a.w.eval(`JSON.stringify(aggregateStats(archives(),'${mode}'))`),w.eval(`JSON.stringify(aggregateStats(archives(),'${mode}'))`));
   assert.equal(a.w.eval(`JSON.stringify(calculateRatings(archives(),'${mode}'))`),w.eval(`JSON.stringify(calculateRatings(archives(),'${mode}'))`));
  }
  assert.equal(databaseWrites(a).length,0);assert.deepEqual(JSON.parse(a.w.localStorage.getItem(keys[1])),sets);a.dom.window.close();d.window.close();
 });
}

(async()=>{for(const [n,f]of tests){try{await f();console.log('PASS '+n)}catch(e){console.error('FAIL '+n);console.error(e);process.exitCode=1}}})();
