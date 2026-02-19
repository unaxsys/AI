let token = sessionStorage.getItem('jwt') || '';
let currentTab = 'email';
let currentTaskId = null;
let mustChangePassword = false;

const loginView = document.getElementById('loginView');
const appView = document.getElementById('appView');

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.error || 'Request failed');
  return payload;
}

function setWorkEnabled(enabled) {
  ['createTask', 'generateDraft', 'saveFinal', 'approveTask', 'refreshHistory', 'search', 'taskInput'].forEach((id) => {
    document.getElementById(id).disabled = !enabled;
  });
}

async function loadMe() {
  if (!token) return;
  try {
    const me = await api('/api/auth/me');
    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
    document.getElementById('userBadge').textContent = `${me.displayName} (${me.role})`;
    document.getElementById('adminPanel').classList.toggle('hidden', me.role !== 'admin');
    mustChangePassword = Boolean(me.mustChangePassword);
    document.getElementById('passwordBox').classList.toggle('hidden', !mustChangePassword);
    setWorkEnabled(!mustChangePassword);
    if (!mustChangePassword) loadHistory();
  } catch {
    sessionStorage.removeItem('jwt');
    token = '';
  }
}

document.getElementById('loginBtn').onclick = async () => {
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: email.value, password: password.value }) });
    token = data.token;
    sessionStorage.setItem('jwt', token);
    loadMe();
  } catch (e) {
    document.getElementById('loginError').textContent = e.message;
  }
};

document.getElementById('changePasswordBtn').onclick = async () => {
  try {
    await api('/api/profile/change-password', {
      method: 'POST',
      body: JSON.stringify({ newPassword: document.getElementById('newPassword').value })
    });
    document.getElementById('passwordError').textContent = '';
    document.getElementById('passwordBox').classList.add('hidden');
    mustChangePassword = false;
    setWorkEnabled(true);
    alert('Паролата е сменена успешно.');
    loadHistory();
  } catch (e) {
    document.getElementById('passwordError').textContent = e.message;
  }
};

document.querySelectorAll('aside button[data-tab]').forEach((b) => b.onclick = () => {
  currentTab = b.dataset.tab;
  document.getElementById('tabTitle').textContent = b.textContent;
  currentTaskId = null;
  document.getElementById('sections').innerHTML = '';
  if (!mustChangePassword) loadHistory();
});

document.getElementById('createTask').onclick = async () => {
  const agents = await api('/api/agents');
  const agent = agents.find((a) => a.code === currentTab);
  if (!agent) return alert('Agent disabled/not found');
  const t = await api('/api/tasks', { method: 'POST', body: JSON.stringify({ agentId: agent.id, inputText: taskInput.value }) });
  currentTaskId = t.id;
  loadHistory();
};

document.getElementById('generateDraft').onclick = async () => {
  if (!currentTaskId) return alert('Create/open task first');
  const data = await api(`/api/tasks/${currentTaskId}/generate`, { method: 'POST' });
  renderSections(data.sections);
};

document.getElementById('saveFinal').onclick = async () => {
  if (!currentTaskId) return;
  const sections = [...document.querySelectorAll('#sections textarea')].map((t) => ({ sectionType: t.dataset.section, contentFinal: t.value }));
  await api(`/api/tasks/${currentTaskId}/sections`, { method: 'PATCH', body: JSON.stringify({ sections }) });
  alert('Saved');
};

document.getElementById('approveTask').onclick = async () => {
  if (!currentTaskId) return;
  await api(`/api/tasks/${currentTaskId}/approve`, { method: 'POST' });
  alert('Approved');
  loadHistory();
};

document.getElementById('refreshHistory').onclick = loadHistory;

async function loadHistory() {
  const agents = await api('/api/agents');
  const agent = agents.find((a) => a.code === currentTab);
  if (!agent) return;
  const q = encodeURIComponent(document.getElementById('search').value || '');
  const rows = await api(`/api/tasks?agentId=${agent.id}&q=${q}`);
  const list = document.getElementById('history');
  list.innerHTML = '';
  rows.forEach((r) => {
    const li = document.createElement('li');
    li.textContent = `#${r.id} [${r.status}] ${r.input_text.slice(0, 80)}`;
    li.onclick = async () => {
      currentTaskId = r.id;
      const data = await api(`/api/tasks/${r.id}`);
      taskInput.value = data.task.input_text;
      renderSections(data.sections.map((s) => ({ section_type: s.section_type, content_draft: s.content_final || s.content_draft || '' })));
    };
    list.appendChild(li);
  });
}

function renderSections(sections) {
  const el = document.getElementById('sections');
  el.innerHTML = '';
  sections.forEach((s) => {
    const label = document.createElement('label');
    label.textContent = s.section_type;
    const ta = document.createElement('textarea');
    ta.dataset.section = s.section_type;
    ta.value = s.content_final || s.content_draft || '';
    el.appendChild(label);
    el.appendChild(ta);
  });
}

loadMe();
