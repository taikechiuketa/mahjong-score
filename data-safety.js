/* Recovery copies stay on this device, outside the legacy application keys. */
window.TakechartSafety = (() => {
  const keys = ['mahjong-sheet-v2', 'mahjong-sheet-archive-v1', 'mahjong-player-master-v1'];
  const raw = () => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)]));
  const initial = raw();
  let database;
  function open() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open('takechart-recovery-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('copies', {keyPath: 'id'});
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(Error('復旧用保存領域を開けません。別タブを閉じてください。'));
    });
    return database;
  }
  async function put(record) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('copies', 'readwrite');
      transaction.objectStore('copies').put(record);
      transaction.oncomplete = () => resolve(record);
      transaction.onerror = transaction.onabort = () => reject(transaction.error || Error('復旧コピーの保存に失敗しました。'));
    });
  }
  async function get(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const request = db.transaction('copies').objectStore('copies').get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  async function checkpoint(kind, data, revision) {
    // Repeated checkpoints never replace an earlier recovery copy.
    const encoded = new TextEncoder().encode(JSON.stringify(data));
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoded)), x => x.toString(16).padStart(2, '0')).join('');
    const id = kind + ':' + digest;
    const prior = await get(id);
    return prior || put({id, kind, revision, savedAt: new Date().toISOString(), data});
  }
  async function all() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const request = db.transaction('copies').objectStore('copies').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  const ready = checkpoint('before-redesign', initial);
  ready.catch(() => {});
  return {keys, raw, initial, ready, checkpoint, get, put, all};
})();
