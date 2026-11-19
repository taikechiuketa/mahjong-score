const {JSDOM}=require('jsdom'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('community.html','utf8'),code=fs.readFileSync('community.js','utf8');
const delay=()=>new Promise(r=>setTimeout(r,35));
async function setup({enabled=true,sub=true,server='registered',offline=false,identity=false}={}){
 const dom=new JSDOM(html,{url:'https://taikechiuketa.github.io/mahjong-score/community.html',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,state={server,offline,identity,unsubscribed:0,subscribed:0,checks:0,posts:0,deletes:0,testExpired:false},calls=[];
 w.scrollTo=()=>{};w.AbortSignal.timeout=()=>new w.AbortController().signal;
 Object.defineProperty(w,'Notification',{value:{permission:'granted',requestPermission:()=>{throw Error('unexpected permission request')}}});w.PushManager=function(){};
 function subscription(id){return {endpoint:'https://fcm.googleapis.com/'+id,toJSON(){return {endpoint:this.endpoint,keys:{p256dh:'A'.repeat(87),auth:'A'.repeat(22)}}},async unsubscribe(){state.unsubscribed++;state.sub=null;return true;}};}
 state.sub=sub?subscription('old'):null;
 const reg={pushManager:{getSubscription:async()=>state.sub,subscribe:async()=>{state.subscribed++;state.sub=subscription('new');return state.sub;}}};
 const workerListeners={};Object.defineProperty(w.navigator,'serviceWorker',{value:{register:async()=>reg,ready:Promise.resolve(reg),addEventListener:(name,fn)=>workerListeners[name]=fn}});
 if(enabled)w.localStorage.setItem('takechart-community-push-v1','on');
 w.fetch=async(url,options)=>{const path=new URL(url).pathname.replace('/api/community','');calls.push(path);if(state.offline&&path.startsWith('/subscription'))throw Error('offline');let status=200,data={};
  if(path==='/events')data={events:[]};
  if(path==='/subscription/status'){state.checks++;if(state.identity){status=409;data={code:'PUSH_IDENTITY_MISMATCH',error:'端末情報が一致しません。'};}else data={state:state.server};}
  if(path==='/config')data={publicKey:'A'.repeat(87),push:{ready:true}};
  if(path==='/subscription'&&options.method==='POST'){state.posts++;state.server='registered';state.identity=false;}
  if(path==='/subscription'&&options.method==='DELETE'){state.deletes++;state.server='missing';}
  if(path==='/test'&&state.testExpired){state.server='missing';status=410;data={code:'PUSH_EXPIRED',error:'登録が無効です。',retryAfter:30};}
  return {ok:status<400,status,json:async()=>data};
 };
 w.eval(code);await delay();return {w,state,calls,workerListeners,close:()=>dom.window.close()};
}
(async()=>{
 let f=await setup({server:'missing'});try{assert.equal(f.state.unsubscribed,1);assert.equal(f.state.subscribed,1);assert.equal(f.state.posts,1);assert.match(f.w.document.getElementById('pushStatus').textContent,/サーバー登録確認済み/);}finally{f.close();}
 f=await setup({sub:false,server:'missing'});try{assert.equal(f.state.subscribed,1);assert.match(f.w.document.getElementById('pushStatus').textContent,/ON/);}finally{f.close();}
 f=await setup({offline:true});try{assert.equal(f.state.subscribed,0);assert.equal(f.state.unsubscribed,0);assert.equal(f.w.document.getElementById('testPush').disabled,true);assert.doesNotMatch(f.w.document.getElementById('pushStatus').textContent,/：ON/);assert.match(f.w.document.getElementById('pushStatus').textContent,/確認・復旧できません/);}finally{f.close();}
 f=await setup({enabled:false});try{assert.equal(f.state.posts,0);assert.equal(f.state.subscribed,0);f.w.document.getElementById('openNotifications').click();await delay();assert.match(f.w.document.getElementById('pushStatus').textContent,/OFF/);assert.equal(f.state.checks,0);}finally{f.close();}
 f=await setup({identity:true});try{assert.equal(f.state.unsubscribed,0);assert.equal(f.w.document.getElementById('testPush').disabled,true);f.w.document.getElementById('enablePush').click();await delay();assert.equal(f.state.unsubscribed,1);assert.equal(f.state.subscribed,1);assert.equal(f.state.deletes,0);assert.match(f.w.document.getElementById('pushStatus').textContent,/サーバー登録確認済み/);}finally{f.close();}
 f=await setup();try{f.state.server='missing';f.workerListeners.message({data:{type:'push-registration-changed'}});await delay();assert.equal(f.state.subscribed,1);f.w.document.getElementById('disablePush').click();await delay();const before=f.state.posts;f.workerListeners.message({data:{type:'push-registration-changed'}});await delay();assert.equal(f.state.posts,before);assert.equal(f.w.localStorage.getItem('takechart-community-push-v1'),'off');}finally{f.close();}
 f=await setup();try{f.state.testExpired=true;f.w.document.getElementById('testPush').click();await delay();assert.equal(f.w.document.getElementById('testPush').disabled,true);f.w.document.getElementById('enablePush').click();await delay();assert.equal(f.state.subscribed,1);assert.match(f.w.document.getElementById('pushStatus').textContent,/サーバー登録確認済み/);}finally{f.close();}
 const handlers={},sent=[];const self={location:{href:'https://example.com/mahjong-score/community-sw.js'},addEventListener:(type,fn)=>handlers[type]=fn,clients:{matchAll:async()=>[{url:'https://example.com/mahjong-score/community.html',postMessage:m=>sent.push(m)},{url:'https://example.com/other/',postMessage:()=>{throw Error('wrong scope')}}]}};
 vm.runInNewContext(fs.readFileSync('community-sw.js','utf8'),{self,URL});let pending;handlers.pushsubscriptionchange({waitUntil:p=>pending=p});await pending;assert.deepEqual(JSON.parse(JSON.stringify(sent)),[{type:'push-registration-changed'}]);
 console.log('Push recovery: missing/expired registration, offline, OFF intent, identity mismatch, worker refresh and safe renewal passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
