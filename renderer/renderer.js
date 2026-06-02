'use strict';

const $ = (sel) => document.querySelector(sel);

const els = {
  toggle: $('#toggle'),
  statusDot: $('#statusDot'),
  statusText: $('#statusText'),
  cardState: $('#cardState'),
  cardUptime: $('#cardUptime'),
  cardAttempts: $('#cardAttempts'),
  cardPing: $('#cardPing'),
  log: $('#log'),
  clearLog: $('#clearLog'),
  form: $('#settingsForm'),
  saveHint: $('#saveHint'),
  certBanner: $('#certBanner'),
  certText: $('#certText'),
  certApply: $('#certApply'),
  sudoModal: $('#sudoModal'),
  sudoInput: $('#sudoInput'),
  sudoRemember: $('#sudoRemember'),
  sudoOk: $('#sudoOk'),
  sudoCancel: $('#sudoCancel'),
};

const STATE_LABELS = {
  disconnected: '未接続',
  connecting: '接続中…',
  connected: '接続済み',
  reconnecting: '再接続中…',
  error: 'エラー',
};

let connectedSince = null;
let uptimeTimer = null;
let suggestedCert = null;
let lastDesiredOn = false;

// ---- tabs ----
document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.tabpane').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    $('#tab-' + t.dataset.tab).classList.add('active');
  });
});

// ---- 設定の読み込み / 保存 ----
const BOOL_FIELDS = ['verbose', 'keepaliveEnabled', 'reconnectEnabled'];

async function loadSettings() {
  const s = await window.api.getSettings();
  for (const [k, v] of Object.entries(s)) {
    const el = els.form.elements[k];
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
  }
}

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {};
  for (const el of els.form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') data[el.name] = el.checked;
    else if (el.type === 'number') data[el.name] = Number(el.value);
    else data[el.name] = el.value;
  }
  await window.api.saveSettings(data);
  els.saveHint.textContent = '保存しました ✓';
  setTimeout(() => (els.saveHint.textContent = ''), 2500);
});

// ---- ログ ----
function appendLog(line) {
  const atBottom = els.log.scrollTop + els.log.clientHeight >= els.log.scrollHeight - 30;
  els.log.textContent += line + '\n';
  // 上限制御（行が増えすぎないように末尾優先で間引き）
  if (els.log.textContent.length > 200000) {
    els.log.textContent = els.log.textContent.slice(-150000);
  }
  if (atBottom) els.log.scrollTop = els.log.scrollHeight;
}
els.clearLog.addEventListener('click', () => (els.log.textContent = ''));

// ---- 状態表示 ----
function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function renderStatus(st) {
  const label = STATE_LABELS[st.state] || st.state;
  els.statusText.textContent = st.lastError ? `${label} — ${st.lastError}` : label;
  els.cardState.textContent = label;
  els.cardAttempts.textContent = st.attempts;
  els.cardPing.textContent = st.keepaliveFails;
  els.statusDot.className = 'dot ' + st.state;

  // トグルは「接続を維持したいか」を表す
  els.toggle.checked = st.desiredOn;
  lastDesiredOn = st.desiredOn;

  connectedSince = st.state === 'connected' ? st.connectedSince : null;
  if (!connectedSince) els.cardUptime.textContent = '—';
}

function tickUptime() {
  if (connectedSince) els.cardUptime.textContent = fmtUptime(Date.now() - connectedSince);
}

// ---- 接続 / 切断 ----
async function doConnect(sudoPw, remember) {
  const res = await window.api.connect(sudoPw || null, remember);
  if (res.needSudo) {
    openSudoModal();
    return;
  }
  if (!res.ok && res.error) {
    appendLog('⚠ ' + res.error);
    els.toggle.checked = false;
    alert(res.error);
  }
}

els.toggle.addEventListener('change', async () => {
  if (els.toggle.checked) {
    await doConnect();
  } else {
    await window.api.disconnect();
  }
});

// ---- sudo モーダル ----
function openSudoModal() {
  els.sudoInput.value = '';
  els.sudoModal.classList.remove('hidden');
  els.sudoInput.focus();
}
function closeSudoModal() {
  els.sudoModal.classList.add('hidden');
}
els.sudoCancel.addEventListener('click', () => {
  closeSudoModal();
  els.toggle.checked = false;
});
els.sudoOk.addEventListener('click', async () => {
  const pw = els.sudoInput.value;
  const remember = els.sudoRemember.checked;
  closeSudoModal();
  if (pw) await doConnect(pw, remember);
  else els.toggle.checked = false;
});
els.sudoInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') els.sudoOk.click(); });

// ---- trusted-cert 提案 ----
els.certApply.addEventListener('click', async () => {
  if (!suggestedCert) return;
  els.form.elements['trustedCert'].value = suggestedCert;
  const data = {};
  for (const el of els.form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') data[el.name] = el.checked;
    else if (el.type === 'number') data[el.name] = Number(el.value);
    else data[el.name] = el.value;
  }
  await window.api.saveSettings(data);
  els.certBanner.classList.add('hidden');
  appendLog('✓ trusted-cert を保存しました。再接続すると証明書が信頼されます。');
});

// ---- イベント購読 ----
window.api.onStatus(renderStatus);
window.api.onLog(appendLog);
window.api.onCert((digest) => {
  suggestedCert = digest;
  els.certText.textContent = `未知のゲートウェイ証明書を検出: ${digest.slice(0, 24)}…`;
  els.certBanner.classList.remove('hidden');
});

// ---- 初期化 ----
(async function init() {
  await loadSettings();
  const st = await window.api.getStatus();
  renderStatus(st);
  uptimeTimer = setInterval(tickUptime, 1000);

  const sec = await window.api.secretsStatus();
  if (!sec.encryptionAvailable) {
    appendLog('⚠ OS の暗号化が利用できないため、設定は平文 (600) で保存されます。');
  }
})();
