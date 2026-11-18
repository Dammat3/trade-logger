const $ = (id) => document.getElementById(id);
let accounts = [];

function showPick(email, list, link) {
  accounts = list || [];
  $('login').hidden = true; $('pick').hidden = false;
  $('who').textContent = email;
  $('account').innerHTML = accounts.map((a) => `<option value="${a.id}">${a.name.replace(/[<>&"]/g, '')}${a.kind === 'backtest' ? ' (backtest)' : ''}</option>`).join('');
  if (link.accountId) $('account').value = link.accountId;
  $('siteUrl2').value = link.siteUrl || $('siteUrl').value || '';
}

$('doLogin').onclick = async () => {
  $('err').textContent = ''; $('doLogin').disabled = true;
  try {
    const list = await api.linkLogin({ siteUrl: $('siteUrl').value, url: $('url').value, key: $('key').value, email: $('email').value, password: $('password').value });
    showPick($('email').value, list, { siteUrl: $('siteUrl').value });
  } catch (e) {
    $('err').textContent = String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  } finally { $('doLogin').disabled = false; }
};

$('save').onclick = async () => {
  const id = $('account').value, a = accounts.find((x) => x.id === id);
  if (!a) { $('err2').textContent = 'Scegli un conto.'; return; }
  await api.linkSave({ accountId: a.id, accountName: a.name, accountKind: a.kind, siteUrl: $('siteUrl2').value });
  $('saved').hidden = false;
};

$('local').onclick = () => api.openLocal();
$('logout').onclick = async () => { await api.linkLogout(); location.reload(); };

api.linkGet().then((r) => {
  $('siteUrl').value = r.link.siteUrl; $('url').value = r.link.url; $('key').value = r.link.key;
  if (r.email && r.accounts) showPick(r.email, r.accounts, r.link);
  else if (r.error) $('err').textContent = r.error;
});
