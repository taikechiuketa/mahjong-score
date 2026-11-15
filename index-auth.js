/* Preserve the v1 database and legacy storage formats for rollback. */
const safety = window.TakechartSafety;
const cloudSessionKey = 'takechao-cloud-session-v1';
const baselineId = 'baseline:' + cloudOwner;
let cloudToken, cloudRefresh, cloudExpiry = 0, cloudRevision;
let cloudReady = false, cloudBusy = false, cloudPending = false, publicPending = false;
let latestSnapshot, baselineData;
let editorLockHeld=false,releaseEditorLock;
async function ensureEditorLock(){
  if(editorLockHeld||!navigator.locks)return;
  await new Promise((resolve,reject)=>{
    navigator.locks.request('takechart-recording',{ifAvailable:true},async lock=>{
      if(!lock){reject(Error('別のタブで記録画面が開いています。先にそのタブを閉じてください。'));return;}
      editorLockHeld=true;resolve();
      await new Promise(release=>{releaseEditorLock=release;});
      editorLockHeld=false;
    }).catch(reject);
  });
}
const copy = data => JSON.parse(JSON.stringify(data));
const stable = data => JSON.stringify(data, function(key, value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value;
});
const equalData = (a,b) => stable(a) === stable(b);
const liveData = () => copy({current: editing?.current || state, history: archives(), master});
function localData() {
  const parse = (key, fallback) => {
    const text = localStorage.getItem(key);
    return text === null ? fallback : JSON.parse(text);
  };
  return {current: parse(KEY, fresh()), history: parse(ARCHIVE_KEY, []), master: parse(MASTER_KEY, [])};
}
function checkData(data) {
  validateBackup({format:'takechao-backup',version:1,...data});
  if(data.history.some(set => new Set(set.players.map(p=>p.id)).size!==set.players.length))throw Error('対局データを確認できません。');
  return data;
}
function hasInput(data) {
  return data.history.length > 0 || data.current.players.some(p=>Number(p.chips)) ||
    data.current.rounds.some(r=>Object.values(r.scores||{}).some(s=>s!==null&&s!==''&&s!=='skip')) ||
    data.master.some(p=>!['たけち','Aさん','Bさん'].includes(p.name));
}
function rememberCloud() {
  localStorage.setItem(cloudSessionKey,JSON.stringify({refresh:cloudRefresh,revision:cloudRevision,ready:cloudReady}));
}
function acceptCloudAuth(auth) {
  if(auth.user?.id!==cloudOwner)throw Error('このアカウントには記録権限がありません。');
  cloudToken=auth.access_token;cloudRefresh=auth.refresh_token;
  cloudExpiry=Date.now()+auth.expires_in*1000;
}
async function renewCloud() {
  const renew=async()=>{
    const latest=JSON.parse(localStorage.getItem(cloudSessionKey)||'null');
    const auth=await cloudRequest('/auth/v1/token?grant_type=refresh_token',{
      method:'POST',data:{refresh_token:latest?.refresh||cloudRefresh}});
    acceptCloudAuth(auth);rememberCloud();
  };
  if(navigator.locks)await navigator.locks.request('takechart-auth-refresh',renew);else await renew();
}
async function cloudSnapshot() {
  const rows=await cloudRequest(privatePath+'?select=data,updated_at&owner_id=eq.'+cloudOwner,{token:cloudToken});
  if(rows.length>1)throw Error('保存データの確認が必要です。');
  if(rows[0])checkData(rows[0].data);
  return rows[0];
}
function cloudStatus(message) {
  $('cloudStatus').textContent=message;
  $('globalSaveStatus').textContent=message;
}
function setBusy(busy) {
  cloudBusy=busy;
  $('workspace').inert=busy;
  $('accountLogout').disabled=busy;
  $('cloudLogin').querySelector('button').disabled=busy;
  $('chooseCloud').disabled=$('chooseLocal').disabled=busy;
}
function showLogin(message) {
  cloudReady=false;
  $('workspace').hidden=true;$('reconcileGate').hidden=true;$('authGate').hidden=false;
  $('cloudLogin').hidden=false;$('accountLogout').hidden=!cloudToken;
  $('accountState').textContent=cloudToken?'再ログインが必要です':'未ログイン';
  $('authMessage').textContent=message;
  $('globalSaveStatus').textContent=cloudToken?'接続の確認が必要です':'未ログイン';
}
function openWorkspace(message) {
  cloudReady=true;
  $('authGate').hidden=$('reconcileGate').hidden=true;$('workspace').hidden=false;
  $('accountState').textContent='記録用アカウントでログイン中';
  $('accountLogout').hidden=false;$('cloudSave').hidden=false;
  rememberCloud();render();renderStats();cloudStatus(message);
  $('recoveryInfo').textContent=localStorage.getItem('takechart-history-draft-v1')?'編集中だった履歴の入力が保護されています。':'復旧コピーはこの端末に保護されています。';
}
async function rememberBaseline(data, revision, pending=false) {
  await safety.put({id:baselineId,data:copy(data),revision,publicPending:pending});
  baselineData=copy(data);cloudRevision=revision;publicPending=pending;
  rememberCloud();
}
async function applyCloud(saved) {
  const data=checkData(copy(saved.data));
  await safety.checkpoint('before-cloud-load',{raw:safety.raw(),draft:localStorage.getItem('takechart-history-draft-v1')});
  await safety.checkpoint('cloud',data,saved.updated_at);
  storeBackup(data); // This function restores earlier values if a partial write fails.
  state=data.current;master=data.master;editing=null;
  await rememberBaseline(data,saved.updated_at);
  openWorkspace('保存済みデータを読み込みました。');
}
function showConflict(saved, local) {
  cloudReady=false;latestSnapshot=saved;
  $('workspace').hidden=$('authGate').hidden=true;$('reconcileGate').hidden=false;
  $('accountState').textContent='ログイン済み・データを確認してください';$('accountLogout').hidden=false;
  $('reconcileMessage').textContent=`DB：${saved?.data.history.length||0}セット ／ この端末：${local.history.length}セット。端末の未送信入力、または別の端末の更新を確認しました。DBを選んでも端末のコピーは残ります。`;
  cloudStatus('データの選択待ち・自動送信は停止中');
}
async function loadCloud() {
  await safety.ready;
  await ensureEditorLock();
  if(Date.now()+60000>=cloudExpiry)await renewCloud();
  const local=checkData(localData());
  const saved=await cloudSnapshot();
  latestSnapshot=saved;
  if(!saved){
    const published=await cloudRequest('/rest/v1/takechao_public_results?id=eq.1&select=results,updated_at');
    if(published.some(row=>row.results?.some(result=>result.kind==='sets-v2'?result.sets?.length:!result.kind&&result.rounds>0)))
      throw Error('公開成績があるため、管理データを取得できない状態では初期化しません。');
  }
  await safety.checkpoint('device-before-login',{data:local,draft:localStorage.getItem('takechart-history-draft-v1')});
  if(saved)await safety.checkpoint('cloud',saved.data,saved.updated_at);
  const baseline=await safety.get(baselineId);
  const pending=baseline ? !equalData(local,baseline.data) : hasInput(local);
  if(saved && equalData(local,saved.data)) {
    state=copy(saved.data.current);master=copy(saved.data.master);
    await rememberBaseline(saved.data,saved.updated_at,Boolean(baseline?.publicPending && baseline.revision===saved.updated_at));
    openWorkspace(publicPending?'保存済み・成績ページへの反映待ち。「保存を再試行」を押してください。':'最新の保存済みデータを確認しました。');
  } else if(saved && !pending) {
    await applyCloud(saved);
  } else if(saved || hasInput(local)) {
    showConflict(saved,local);
  } else {
    state=fresh();master=[];
    await rememberBaseline({current:state,history:[],master:[]},undefined);
    openWorkspace('保存データはまだありません。「新しいセット」から始めてください。');
  }
}
async function connect() {
  setBusy(true);$('authRetry').hidden=true;
  try {await loadCloud();}
  catch(error) {showLogin('データを安全に読み込めませんでした。別の記録タブがあれば閉じて、再試行してください。端末とDBのデータは保護されています。');$('authRetry').hidden=false;cloudStatus('読み込み未完了・送信は停止中');}
  finally {setBusy(false);}
}
$('cloudLogin').onsubmit=async event=>{
  event.preventDefault();if(cloudBusy)return;
  setBusy(true);$('authMessage').textContent='ログインしています…';
  try {
    await safety.ready;
    const auth=await cloudRequest('/auth/v1/token?grant_type=password',{method:'POST',data:{email:$('cloudEmail').value,password:$('cloudPassword').value}});
    acceptCloudAuth(auth);rememberCloud();
    await loadCloud();
  }catch(error){showLogin('ログインまたはデータの読み込みに失敗しました。メール・パスワード・通信状態を確認してください。');$('authRetry').hidden=!cloudToken;}
  finally{$('cloudPassword').value='';setBusy(false);}
};
$('authRetry').onclick=()=>cloudToken?connect():resumeCloud();
$('chooseCloud').onclick=async()=>{
  if(cloudBusy)return;setBusy(true);
  try {
    const saved=await cloudSnapshot();
    if(!saved)throw Error('保存データがありません。端末のデータで再開してください。');
    await applyCloud(saved);
  }catch(error){$('reconcileMessage').textContent='読み込めませんでした。保護したデータは残っています。'+error.message;}
  finally{setBusy(false);}
};
$('chooseLocal').onclick=async()=>{
  if(cloudBusy)return;
  if(!confirm('端末のデータを編集用に開きます。DBへの置き換えはまだ行いません。保存前にも件数の減少を確認します。よろしいですか？'))return;
  setBusy(true);
  try {
    const data=checkData(localData());
    const saved=await cloudSnapshot();
    await safety.checkpoint('local-selected',data);
    if(saved)await safety.checkpoint('cloud',saved.data,saved.updated_at);
    state=data.current;master=data.master;baselineData=copy(saved?.data);cloudRevision=saved?.updated_at;
    openWorkspace('端末のデータで再開しました・DBには未送信です。「入力を保存」で反映します。');
  }catch(error){$('reconcileMessage').textContent='再開できませんでした。'+error.message;}
  finally{setBusy(false);}
};
async function protectRemote(saved) {
  if(saved)await safety.checkpoint('cloud-before-write',saved.data,saved.updated_at);
  const publicRows=await cloudRequest('/rest/v1/takechao_public_results?id=eq.1&select=results,updated_at');
  if(publicRows[0])await safety.checkpoint('public-before-write',publicRows[0]);
  return publicRows[0];
}
async function publishResults(data, revision, prior) {
  const current=await cloudSnapshot();
  if(current?.updated_at!==revision)throw Error('conflict');
  const results=publicResults(data.history);
  const path='/rest/v1/takechao_public_results';
  const payload={id:1,results,updated_at:revision};
  const rows=await cloudRequest(prior?path+'?id=eq.1&updated_at=eq.'+encodeURIComponent(prior.updated_at):path,{
    token:cloudToken,method:prior?'PATCH':'POST',data:payload});
  if(rows.length!==1)throw Error('conflict');
}
async function syncCloud() {
  if(!cloudToken||!cloudReady)return;
  cloudPending=true;if(cloudBusy)return;
  setBusy(true);
  try {
    while(cloudPending) {
      cloudPending=false;
      if(Date.now()+60000>=cloudExpiry)await renewCloud();
      const saved=await cloudSnapshot();
      if(saved?.updated_at!==cloudRevision)throw Error('conflict');
      const data=checkData(liveData());
      await safety.checkpoint('device-before-write',{data,draft:localStorage.getItem('takechart-history-draft-v1')});
      const prior=await protectRemote(saved);
      if(saved && (data.history.length<saved.data.history.length || data.history.reduce((n,s)=>n+s.rounds.length,0)<saved.data.history.reduce((n,s)=>n+s.rounds.length,0))) {
        if(!confirm(`DBの対局件数が減少します（${saved.data.history.length} → ${data.history.length}セット）。復旧コピーは保護済みです。この変更を保存しますか？`)) {
          cloudStatus('送信を取り消しました。端末の変更とDBの復旧コピーは残っています。');break;
        }
      }
      let updated_at=cloudRevision;
      if(!saved || !equalData(data,saved.data)) {
        updated_at=new Date().toISOString();
        if(Date.parse(updated_at)===Date.parse(cloudRevision))updated_at=new Date(Date.parse(updated_at)+1).toISOString();
        cloudStatus('保存中…');
        const path=cloudRevision?privatePath+'?owner_id=eq.'+cloudOwner+'&updated_at=eq.'+encodeURIComponent(cloudRevision):privatePath;
        const rows=await cloudRequest(path,{token:cloudToken,method:cloudRevision?'PATCH':'POST',data:{owner_id:cloudOwner,data,updated_at}});
        if(rows.length!==1)throw Error('conflict');
        updated_at=rows[0].updated_at;
      }
      await rememberBaseline(data,updated_at,true);
      try {
        await publishResults(data,updated_at,prior);
        await rememberBaseline(data,updated_at,false);
      }catch(error){cloudStatus('DBに保存済み・成績ページへの反映待ち。「保存を再試行」を押してください。');break;}
      cloudStatus(equalData(data,liveData())?'保存済み・公開成績にも反映しました。':'保存済み・端末に追加の未送信入力があります。');
    }
  }catch(error) {
    cloudPending=false;cloudReady=false;
    cloudStatus('保存未完了・端末の入力は残っています。');
    if(error.message==='conflict') {
      try {const saved=await cloudSnapshot();if(saved)await safety.checkpoint('cloud-conflict',saved.data,saved.updated_at);await safety.checkpoint('device-conflict',liveData());showConflict(saved,liveData());}
      catch{showLogin('別端末の更新を確認できません。入力を保護して再ログインしてください。');}
    }else {$('authRetry').hidden=false;$('authGate').hidden=false;$('cloudLogin').hidden=true;$('authMessage').textContent='保存できませんでした。端末の入力は残っています。「再試行」で接続とデータを確認します。';$('workspace').inert=true;}
  }finally {setBusy(false);if(!cloudReady)$('workspace').inert=true;}
}
$('cloudSave').onclick=()=>syncCloud();
$('cloudSave').textContent='入力を保存・保存を再試行';
$('cloudRestore').hidden=true;$('cloudLogout').hidden=true;
async function logout() {
  if(cloudBusy)return;
  const pending=editing || !equalData(liveData(),baselineData);
  if(pending && !confirm('未送信の入力をこの端末に保護してログアウトします。DBには送信しません。よろしいですか？'))return;
  setBusy(true);
  try {
    await safety.checkpoint('before-logout',{data:liveData(),draft:localStorage.getItem('takechart-history-draft-v1')});
    if(editing)localStorage.setItem('takechart-history-draft-v1',JSON.stringify({index:editing.index,original:editing.original,set:state}));
    let revoked=true;
    try{if(Date.now()+60000>=cloudExpiry)await renewCloud();await cloudRequest('/auth/v1/logout?scope=local',{token:cloudToken,method:'POST'});}catch{revoked=false;}
    localStorage.removeItem(cloudSessionKey);
    releaseEditorLock?.();releaseEditorLock=undefined;
    cloudToken=cloudRefresh=undefined;cloudReady=false;cloudPending=false;
    for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
    if(editing){state=editing.current;editing=null;}
    showLogin(revoked?'ログアウトしました。未送信データと復旧コピーはこの端末に保持しています。':'この端末ではログアウトしました。通信できずサーバー側の失効確認は未完了です。');
    cloudStatus('未ログイン');$('authRetry').hidden=true;
  }catch{cloudStatus('入力を保護できないためログアウトを中止しました。全データをバックアップしてください。');}
  finally{setBusy(false);}
}
$('accountLogout').onclick=logout;
async function downloadRecovery() {
  try {
    await safety.ready;
    await safety.checkpoint('manual-export',{raw:safety.raw(),draft:localStorage.getItem('takechart-history-draft-v1')});
    const snapshots=(await safety.all()).filter(record=>record.kind);
    const url=URL.createObjectURL(new Blob([JSON.stringify({format:'takechart-recovery',version:1,savedAt:new Date().toISOString(),snapshots})],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='takechart-recovery-'+new Date().toISOString().replaceAll(':','-')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch{alert('復旧コピーを書き出せませんでした。端末の空き容量を確認してください。');}
}
$('downloadRecovery').onclick=$('downloadRecoveryGate').onclick=downloadRecovery;
function recoveryData(record) {
  const container=record.data;
  if(container?.current && container?.history && container?.master)return container;
  if(container?.data?.current)return container.data;
  const raw=container?.raw || container;
  if(raw && Object.hasOwn(raw,KEY))return {
    current:JSON.parse(raw[KEY]||'null')||fresh(),
    history:JSON.parse(raw[ARCHIVE_KEY]||'null')||[],
    master:JSON.parse(raw[MASTER_KEY]||'null')||[]
  };
}
const recoveryControls=document.createElement('details');
recoveryControls.innerHTML='<summary>復旧コピーから端末に戻す</summary><p class="hint">選んだコピーを端末に戻します。DBには自動送信しません。</p><button type="button" class="secondary" id="listRecovery">コピーの一覧を表示</button><label>復旧するコピー<select id="recoverySelection"></select></label><button type="button" class="secondary" id="restoreRecovery">選んだコピーを端末に戻す</button>';
$('recoveryInfo').after(recoveryControls);
let recoveryCandidates=[];
$('listRecovery').onclick=async()=>{
  try {
    const labels={'before-redesign':'改修前の端末データ','before-cloud-load':'読み込み前の端末データ','cloud':'DBの保存データ','device-before-login':'ログイン前の端末データ','local-selected':'選択した端末データ','cloud-before-write':'送信前のDBデータ','device-before-write':'送信前の端末データ','device-conflict':'競合時の端末データ','cloud-conflict':'競合時のDBデータ','before-logout':'ログアウト前','manual-export':'書き出し時','before-device-recovery':'復元前の端末データ','before-backup-restore':'バックアップ復元前','before-set-identity-edit':'日付・番号の変更前'};
    recoveryCandidates=(await safety.all()).filter(record=>{try{return Boolean(record.kind&&checkData(recoveryData(record)))}catch{return false}}).sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt)));
    $('recoverySelection').replaceChildren(...recoveryCandidates.map(record=>new Option(`${new Date(record.savedAt).toLocaleString('ja-JP')} ／ ${recoveryData(record).history.length}セット ／ ${labels[record.kind]||'保護したデータ'}`,record.id)));
    if(!recoveryCandidates.length)$('recoveryInfo').textContent='復元できるコピーはまだありません。';
  }catch{$('recoveryInfo').textContent='復旧コピーを確認できませんでした。';}
};
$('restoreRecovery').onclick=async()=>{
  if(cloudBusy||editing)return;
  const record=recoveryCandidates.find(record=>record.id===$('recoverySelection').value);
  if(!record)return;
  const data=checkData(copy(recoveryData(record)));
  if(!confirm(`${data.history.length}セットを端末に復元します。現在の端末データも先に保護します。DBには送信しません。よろしいですか？`))return;
  setBusy(true);
  try {
    await safety.checkpoint('before-device-recovery',{data:liveData(),draft:localStorage.getItem('takechart-history-draft-v1')});
    storeBackup(data);state=data.current;master=data.master;
    render();renderStats();cloudStatus('端末に復元しました・DBには未送信です。');
  }catch{$('recoveryInfo').textContent='復元できませんでした。保護したデータは残っています。';}
  finally{setBusy(false);}
};
$('resumeRecovery').onclick=async()=>{
  const draft=JSON.parse(localStorage.getItem('takechart-history-draft-v1')||'null');
  if(!draft){$('recoveryInfo').textContent='編集中だった履歴の入力はありません。過去のコピーは「復旧コピーを書き出す」で取得できます。';return;}
  if(editing){alert('現在の履歴編集を先に終了してください。');return;}
  if(JSON.stringify(archives()[draft.index])!==draft.original){alert('元の履歴が更新されています。自動で戻さず、復旧コピーで内容を確認してください。');return;}
  startHistoryEdit(draft.index);state=draft.set;render();cloudStatus('保護していた履歴の入力を復元しました・未送信');
};
async function resumeCloud() {
  showLogin('ログインすると、保存済みの対局データを自動で読み込みます。');
  setBusy(true);
  try {
    await safety.ready;
    const session=JSON.parse(localStorage.getItem(cloudSessionKey)||'null');
    if(!session?.refresh)return;
    cloudRefresh=session.refresh;cloudRevision=session.revision;
    await renewCloud();await loadCloud();
  }catch{showLogin('ログイン情報を確認できませんでした。端末のデータは保護されています。ログインしてください。');}
  finally{setBusy(false);}
}
// Move existing controls rather than keeping duplicate forms or tables.
$('loginMount').append($('cloudLogin'));
$('settingsPage').append($('masterSection'),$('dataSection'));
const connection=document.createElement('section');connection.className='card';connection.append($('connectionSection'));$('settingsPage').append(connection);
$('historyPage').append($('historySection'));
// Block input while initial authentication, loading, or reconciliation is pending.
document.addEventListener('click',event=>{
  if(event.target.closest('#workspace') && (!cloudReady||cloudBusy)){event.preventDefault();event.stopImmediatePropagation();}
},true);
window.addEventListener('beforeunload',event=>{
  if(cloudToken&&(editing||!equalData(liveData(),baselineData)||cloudBusy)){event.preventDefault();event.returnValue='';}
});
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'&&cloudReady&&!cloudBusy&&!editing)connect();
});
window.addEventListener('pagehide',()=>{releaseEditorLock?.();releaseEditorLock=undefined;});
resumeCloud();
function publicResults(history){
      const savedSets=history.filter(set=>set&&Array.isArray(set.players)&&Array.isArray(set.rounds));
      const results=aggregateStats(savedSets).filter(r=>r.rankingVisible)
        .sort((a,b)=>b.pt-a.pt).map(({name,sets,rounds,pt,ranks})=>({name,sets,rounds,pt,ranks}));
      results.push({kind:'details-v1',
        history:[...savedSets].sort((a,b)=>(b.date||'').localeCompare(a.date||'')||Number(b.sequence||0)-Number(a.sequence||0)).map(set=>({
          date:set.date,sequence:set.sequence,
          names:set.players.map(p=>master.find(m=>m.id===p.masterId)?.name||p.name),
          rounds:set.rounds.map(r=>({mode:r.mode,scores:set.players.map(p=>r.scores?.[p.id]??null)}))
        })),
        ratings:Object.fromEntries(['normal','north','yonma'].map(mode=>[mode,calculateRatings(savedSets,mode).filter(p=>p.rankingVisible).map(p=>({
          name:p.name,rating:Math.round(p.rating),rounds:p.history.length,change:p.change
        }))]))
      });
      const ids=new Map();
      results.push({kind:'sets-v2',sets:savedSets.map(set=>{
        const identities=setResults(set);
        const players=set.players.map((p,i)=>{
          const {id,name,rankingVisible}=identities[i];
          if(!ids.has(id))ids.set(id,'p'+(ids.size+1));
          return {id:'seat'+i,masterId:ids.get(id),name,rankingVisible,chips:value(p.chips)};
        });
        return {date:set.date,sequence:set.sequence,rate:Number(set.rate||0),chipRate:Number(set.chipRate||0),players,
          rounds:set.rounds.map(r=>({mode:r.mode,scores:Object.fromEntries(players.map((p,i)=>[p.id,r.scores?.[set.players[i].id]??null]))}))};
      })});

return results;
}
