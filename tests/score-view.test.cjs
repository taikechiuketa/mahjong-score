const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');
const {JSDOM,VirtualConsole}=require('jsdom');
const view=require('../set-analysis.js');
const players=['a','b','c','d'].map(id=>({id,masterId:id,name:id.toUpperCase(),chips:0}));
const sets=[{date:'2026/10/01',sequence:1,rate:100,chipRate:100,players:players.slice(0,3),rounds:[{mode:'normal',scores:{a:10,b:0,c:-10}}]},
 {date:'2026/11/01',sequence:1,rate:100,chipRate:100,players:players.slice(0,3),rounds:[{mode:'normal',scores:{a:-10,b:0,c:10}}]}];
const mixed={players,rounds:[
 {mode:'normal',scores:{a:10,b:0,c:-10,d:'skip'}},
 {mode:'normal',scores:{a:10,b:10,c:-20,d:'skip'}},
 {mode:'yonma',scores:{a:-30,b:10,c:5,d:15}},
 {mode:'normal',scores:{a:1,b:'',c:'',d:'skip'}},
 {mode:'normal',scores:{a:'skip',b:'skip',c:'skip',d:'skip'}}]};
const rows=view.rankRows(mixed);
assert.deepEqual(rows.map(r=>r.rounds),[3,3,3,1]);
assert.deepEqual(rows.map(r=>r.ranks),[[2,0,0,1],[1,2,0,0],[0,0,3,0],[1,0,0,0]]);
assert.match(view.analysis(mixed),/66\.7%/);
assert(!view.rankRows(mixed).some(r=>r.rounds===4));
console.log('PASS セット着順分析：同点・混在・抜け・未入力・参加者別の母数');
const tri=view.analysis(sets[0]);assert.equal((tri.match(/<td>—<\/td>/g)||[]).length,3);assert.match(tri,/1回/);
const escaped=view.render({...sets[0],players:[{id:'a',name:'<img src=x onerror=1>'},...players.slice(1,3)]});assert(!escaped.includes('<img'));assert(escaped.includes('&lt;img'));
const score=view.scoreTable(mixed);assert.match(score,/class="score-scroll"/);assert.match(score,/<thead>/);assert.match(score,/<th scope="row">/);assert.match(score,/抜け/);
console.log('PASS 三麻の4着表示・プレイヤー名の安全な表示・名前と半荘の固定用構造');
async function publicPage(search=''){
 const html=fs.readFileSync('results.html','utf8');
 const dom=new JSDOM(html,{url:'https://example.test/results.html'+search,runScripts:'outside-only',virtualConsole:new VirtualConsole()});
 const w=dom.window;w.scrollTo=()=>{};w.alert=()=>{};w.confirm=()=>true;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};
 w.HTMLDialogElement.prototype.close=function(){this.open=false};
 w.fetch=async()=>({ok:true,json:async()=>[{results:[{kind:'sets-v2',sets}],updated_at:'2026-11-15T00:00:00Z'}]});
 w.eval(fs.readFileSync('set-analysis.js','utf8'));
 for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))vm.runInContext(m[1],dom.getInternalVMContext());
 for(let i=0;i<10;i++)await new Promise(r=>setTimeout(r,5));
 return {dom,w,el:id=>w.document.getElementById(id)};
}
(async()=>{
 const p=await publicPage();
 assert(p.el('totalsPanel').contains(p.el('statsPeriod')));
 assert(p.el('ratingPanel').contains(p.el('ratingTrendPeriod')));
 p.el('statsPeriod').value='range';p.el('statsFrom').value='2026-10-01';p.el('statsTo').value='2026-10-31';p.w.eval('renderStats()');
 assert.equal(p.el('statsTable').querySelector('tbody tr').cells[1].textContent,'+10 pt');
 p.el('showRating').click();const before=p.el('ratingTable').textContent;
 assert.match(p.el('ratingPanelContext').textContent,/現在R：全期間/);
 assert.equal(p.el('statsPeriod').closest('#totalsPanel').hidden,true);
 p.el('ratingTable').querySelector('[data-rating-player]').click();
 assert.match(p.el('playerStatsPeriod').textContent,/全期間/);
 assert.equal(p.el('ratingTrendPeriod').value,'all');
 p.el('ratingTrendPeriod').value='range';p.el('ratingTrendFrom').value='2026-11-01';p.el('ratingTrendTo').value='2026-11-30';p.w.eval('renderStats()');
 assert.equal(p.el('ratingTable').textContent,before);
 assert.match(p.el('ratingTrend').textContent,/2026\/11\/01/);
 assert(!p.el('ratingTrend').textContent.includes('2026/10/01'));
 assert.equal(p.el('statsFrom').value,'2026-10-01');
 assert(p.el('historyList').querySelector('.set-rank-analysis'));
 assert(p.el('historyList').querySelector('.set-round-details .score-scroll thead'));
 console.log('PASS 通算期間とR推移期間の独立・現在R固定・レーティングからの個人成績は全期間');
 p.dom.window.close();
 const q=await publicPage('?date=2026%2F10%2F01&set=1');assert(!q.el('sharedSet').hidden);assert(q.el('sharedResult').querySelector('.set-rank-analysis'));assert(q.el('sharedResult').querySelector('.score-scroll thead'));
 console.log('PASS 既存共有URLでもセット分析と名前固定の半荘別スコアを表示');q.dom.window.close();
})().catch(e=>{console.error(e);process.exitCode=1});
