// Date and sequence are display/share keys. archiveId remains the storage identity.
let identityTarget, identityEditing;
function setIdentityIssue(candidate){
  const day=String(candidate.date||'').replaceAll('/','-');
  const parsed=new Date(day+'T00:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||day.startsWith('0000')||Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==day)
    return '有効な対局日を入力してください。';
  if(!Number.isSafeInteger(candidate.sequence)||candidate.sequence<1)return '連番は1以上の整数で入力してください。';
  const sameKey=set=>set&&!set.idle&&set.date===candidate.date&&Number(set.sequence)===candidate.sequence;
  const duplicate=archives().some((set,index)=>{
    if(editing?index===editing.index:state.archiveId&&set.archiveId===state.archiveId)return false;
    return sameKey(set);
  }) || Boolean(editing && !editing.current.idle && !(editing.current.archiveId&&editing.current.archiveId===state.archiveId) && sameKey(editing.current));
  return duplicate?'同じ日付・番号のセットがあります。別の連番を入力してください。':'';
}
function validateSetIdentityForSave(){
  const original=editing?JSON.parse(editing.original):archives().find(set=>state.archiveId&&set.archiveId===state.archiveId);
  // Do not block unrelated edits to pre-existing legacy duplicates.
  if(original&&original.date===state.date&&Number(original.sequence)===Number(state.sequence))return '';
  return setIdentityIssue(state);
}
$('editSetIdentity').onclick=()=>{
  if(state.idle||cloudBusy||!cloudReady)return;
  identityTarget=state;identityEditing=editing;
  $('setDate').value=state.date.replaceAll('/','-');
  $('setSequence').value=state.sequence;
  $('identityError').textContent='';
  $('identityShareNote').hidden=!editing&&!state.archiveId;
  $('setIdentityDialog').showModal();
};
$('cancelSetIdentity').onclick=()=>$('setIdentityDialog').close();
$('setIdentityForm').onsubmit=async event=>{
  event.preventDefault();
  if(cloudBusy||!cloudReady)return;
  if(state!==identityTarget||editing!==identityEditing){$('identityError').textContent='データが更新されました。閉じてから編集し直してください。';return;}
  const raw=$('setSequence').value.trim();
  const candidate={...copy(state),date:$('setDate').value.replaceAll('-','/'),sequence:Number(raw)};
  const issue=/^\d+$/.test(raw)?setIdentityIssue(candidate):'連番は1以上の整数で入力してください。';
  if(issue){$('identityError').textContent=issue;return;}
  if(candidate.date===state.date&&candidate.sequence===Number(state.sequence)){$('setIdentityDialog').close();return;}
  setBusy(true);$('applySetIdentity').disabled=true;$('cancelSetIdentity').disabled=true;
  try{
    await safety.checkpoint('before-set-identity-edit',{data:liveData(),draft:localStorage.getItem('takechart-history-draft-v1')});
    if(state!==identityTarget||editing!==identityEditing)throw Error('changed');
    if(editing)localStorage.setItem('takechart-history-draft-v1',JSON.stringify({index:editing.index,original:editing.original,set:candidate}));
    else localStorage.setItem(KEY,JSON.stringify(candidate));
    state=candidate;
    render();
    updateSetSaveIndicator('日付・番号を端末に保護済み・未送信');
    $('saveStatus').textContent='日付・番号を変更しました。「セットを保存」で反映します。';
    $('setIdentityDialog').close();
  }catch{
    $('identityError').textContent='変更を安全に保存できませんでした。元の対局データは変更していません。';
  }finally{
    $('applySetIdentity').disabled=false;$('cancelSetIdentity').disabled=false;setBusy(false);
  }
};
