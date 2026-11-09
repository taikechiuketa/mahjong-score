function initTemplateGroups() {
  const catalogKey = 'takechart-template-groups-v1';
  const groups = JSON.parse(localStorage.getItem(catalogKey) || '{"demo":{"name":"おためし卓"}}');
  const requested = new URLSearchParams(location.search).get('group');
  const id = Object.hasOwn(groups, requested) ? requested : 'demo';
  const prefix = 'takechart-template-v1:' + id + ':';
  const settingsKey = prefix + 'settings';
  const defaults = { name: groups[id].name, theme: 'red', rules: '', logo: '', score: null };
  const settings = { ...defaults, ...JSON.parse(localStorage.getItem(settingsKey) || '{}') };
  const colors = { red: '#c60027', blue: '#254db6', green: '#197053' };
  const el = name => document.getElementById(name);

  function openGroup(groupId) {
    const url = new URL(location.href);
    url.searchParams.set('group', groupId);
    location.assign(url);
  }

  function render() {
    el('groupTitle').textContent = settings.name;
    el('groupName').value = settings.name;
    el('groupTheme').value = settings.theme;
    el('groupRules').value = settings.rules;
    el('groupRulesPreview').textContent = settings.rules || 'ルールは未設定です。';
    document.documentElement.style.setProperty('--accent', colors[settings.theme] || colors.red);

    const logo = el('groupLogo');
    logo.hidden = !settings.logo;
    if (settings.logo) logo.src = settings.logo;
    else logo.removeAttribute('src');

    const score = el('groupScoreLink');
    score.hidden = !settings.score;
    if (settings.score) {
      score.href = settings.score.url;
      score.download = settings.score.name;
    } else {
      score.removeAttribute('href');
    }

    el('groupPicker').replaceChildren(...Object.entries(groups).map(([key, group]) => {
      const saved = JSON.parse(localStorage.getItem('takechart-template-v1:' + key + ':settings') || '{}');
      return new Option(saved.name || group.name, key, false, key === id);
    }));
  }

  async function readAttachment(file, allowPdf) {
    const types = ['image/png', 'image/jpeg', 'image/webp'];
    if (allowPdf) types.push('application/pdf');
    if (!types.includes(file.type) || file.size > 512 * 1024) {
      throw new Error('ファイルの形式またはサイズを確認してください。');
    }
    const url = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('ファイルを読み込めませんでした。'));
      reader.readAsDataURL(file);
    });
    return { name: file.name, url };
  }

  el('groupPicker').onchange = event => openGroup(event.target.value);
  el('createGroup').onclick = () => {
    const name = prompt('新しいグループ名')?.trim().slice(0, 60);
    if (!name) return;
    const key = crypto.randomUUID();
    try {
      localStorage.setItem(catalogKey, JSON.stringify({ ...groups, [key]: { name } }));
    } catch {
      el('groupStatus').textContent = 'グループを保存できませんでした。';
      alert('グループを保存できませんでした。');
      return;
    }
    openGroup(key);
  };
  el('groupSettings').onsubmit = async event => {
    event.preventDefault();
    const name = el('groupName').value.trim();
    if (!name) return;
    const submit = event.submitter;
    submit.disabled = true;
    try {
      const next = { ...settings, name, theme: el('groupTheme').value, rules: el('groupRules').value };
      const logoFile = el('groupLogoFile').files[0];
      const scoreFile = el('groupScoreFile').files[0];
      if (logoFile) next.logo = (await readAttachment(logoFile, false)).url;
      else if (el('removeLogo').checked) next.logo = '';
      if (scoreFile) next.score = await readAttachment(scoreFile, true);
      else if (el('removeScore').checked) next.score = null;
      localStorage.setItem(settingsKey, JSON.stringify(next));
      Object.assign(settings, next);
      for (const field of ['groupLogoFile', 'groupScoreFile']) el(field).value = '';
      for (const field of ['removeLogo', 'removeScore']) el(field).checked = false;
      render();
      el('groupStatus').textContent = '保存しました。';
    } catch (error) {
      el('groupStatus').textContent = error.name === 'QuotaExceededError'
        ? '端末の保存容量が不足しています。'
        : error.message;
    } finally {
      submit.disabled = false;
    }
  };
  render();
  return prefix;
}
