const tokenKey = 'anagami_token';
const i18n = {
  bg: {
    analysis: 'Анализ',
    service: 'Услуга',
    pricing: 'Ценообразуване',
    proposalDraft: 'Проект на предложение',
    emailDraft: 'Проект на имейл',
    upsell: 'Допълнителни предложения'
  },
  en: {
    analysis: 'Analysis',
    service: 'Service',
    pricing: 'Pricing',
    proposalDraft: 'Proposal Draft',
    emailDraft: 'Email Draft',
    upsell: 'Upsell'
  }
};
const sectionKeys = ['analysis', 'service', 'pricing', 'proposalDraft', 'emailDraft', 'upsell'];

let me = null;
let currentModule = 'offers';
let currentTaskId = null;

function updateModuleVisibility() {
  const isAdminModule = currentModule === 'admin';
  document.getElementById('taskWorkspace').classList.toggle('hidden', isAdminModule);
  document.getElementById('historyPanel').classList.toggle('hidden', isAdminModule);
  document.getElementById('adminPanel').classList.toggle('hidden', !isAdminModule || !['admin', 'manager'].includes(me?.role));
}

function getToken() {
  return sessionStorage.getItem(tokenKey);
}

async function api(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function renderSections(data = {}, lang = 'bg') {
  const root = document.getElementById('sixSections');
  root.innerHTML = '';
  for (const key of sectionKeys) {
    const label = document.createElement('h4');
    label.textContent = i18n[lang][key];
    const ta = document.createElement('textarea');
    ta.dataset.key = key;
    ta.value = data[key] || '';
    root.appendChild(label);
    root.appendChild(ta);
  }
}

function gatherSections() {
  const payload = {};
  document.querySelectorAll('#sixSections textarea').forEach((el) => {
    payload[el.dataset.key] = el.value;
  });
  return payload;
}

async function login() {
  const loginError = document.getElementById('loginError');
  loginError.textContent = '';

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    sessionStorage.setItem(tokenKey, data.token);
    await loadMe();
  } catch (err) {
    loginError.textContent = err.message;
  }
}

async function loadMe() {
  try {
    me = await api('/api/auth/me');
    document.getElementById('loginView').classList.add('hidden');
    document.getElementById('appView').classList.remove('hidden');
    document.getElementById('whoami').textContent = `${me.name} (${me.role})`;
    renderSections({}, document.getElementById('language').value);
    updateModuleVisibility();
    if (currentModule !== 'admin') loadHistory();
  } catch (_e) {
    document.getElementById('loginView').classList.remove('hidden');
    document.getElementById('appView').classList.add('hidden');
  }
}

async function loadHistory() {
  if (currentModule === 'admin') return;
  const q = document.getElementById('search').value;
  const rows = await api(`/api/tasks?module=${encodeURIComponent(currentModule)}&q=${encodeURIComponent(q)}`);
  const history = document.getElementById('history');
  history.innerHTML = '';
  rows.forEach((row) => {
    const li = document.createElement('li');
    li.textContent = `#${row.id} [${row.language}] [${row.status}] ${row.lead_text.slice(0, 80)}`;
    li.onclick = async () => {
      const details = await api(`/api/tasks/${row.id}`);
      currentTaskId = row.id;
      document.getElementById('leadText').value = details.task.lead_text || '';
      document.getElementById('company').value = details.task.company || '';
      document.getElementById('industry').value = details.task.industry || '';
      document.getElementById('budget').value = details.task.budget || '';
      document.getElementById('timeline').value = details.task.timeline || '';
      document.getElementById('language').value = details.task.language;
      renderSections(details.output || {}, details.task.language);
    };
    history.appendChild(li);
  });
}

async function createTask() {
  const payload = {
    module: currentModule,
    language: document.getElementById('language').value,
    leadText: document.getElementById('leadText').value,
    company: document.getElementById('company').value,
    industry: document.getElementById('industry').value,
    budget: document.getElementById('budget').value,
    timeline: document.getElementById('timeline').value
  };
  const created = await api('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
  currentTaskId = created.id;
  await loadHistory();
}

async function generate() {
  if (!currentTaskId) await createTask();
  const data = await api(`/api/tasks/${currentTaskId}/generate`, { method: 'POST', body: '{}' });
  renderSections(data, document.getElementById('language').value);
  await loadHistory();
}

async function saveFinal() {
  if (!currentTaskId) return;
  const payload = gatherSections();
  payload.language = document.getElementById('language').value;
  await api(`/api/tasks/${currentTaskId}/final`, { method: 'PATCH', body: JSON.stringify(payload) });
  alert('Saved');
}

async function approveTask() {
  if (!currentTaskId) return;
  await api(`/api/tasks/${currentTaskId}/approve`, { method: 'POST', body: '{}' });
  alert('Approved');
  loadHistory();
}

async function loadCrud(resource, fields) {
  const rows = await api(`/api/admin/${resource}`);
  const root = document.getElementById('adminCrud');
  root.innerHTML = '';

  const form = document.createElement('div');
  form.className = 'crudForm';
  const values = {};
  fields.forEach((f) => {
    const input = document.createElement('input');
    input.placeholder = f;
    input.oninput = () => {
      values[f] = input.value;
    };
    form.appendChild(input);
  });
  const createBtn = document.createElement('button');
  createBtn.textContent = 'Create';
  createBtn.onclick = async () => {
    await api(`/api/admin/${resource}`, { method: 'POST', body: JSON.stringify(values) });
    await loadCrud(resource, fields);
  };
  form.appendChild(createBtn);
  root.appendChild(form);

  rows.forEach((row) => {
    const item = document.createElement('div');
    item.className = 'crudItem';
    item.textContent = JSON.stringify(row);
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.onclick = async () => {
      await api(`/api/admin/${resource}/${row.id}`, { method: 'DELETE' });
      await loadCrud(resource, fields);
    };
    item.appendChild(del);

    if (resource === 'users') {
      const toggle = document.createElement('button');
      toggle.textContent = row.is_active ? 'Disable' : 'Enable';
      toggle.onclick = async () => {
        await api(`/api/admin/users/${row.id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive: row.is_active ? 0 : 1 }) });
        await loadCrud(resource, fields);
      };
      const reset = document.createElement('button');
      reset.textContent = 'Reset Password';
      reset.onclick = async () => {
        const password = prompt('New password');
        if (!password) return;
        await api(`/api/admin/users/${row.id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) });
      };
      item.appendChild(toggle);
      item.appendChild(reset);
    }

    root.appendChild(item);
  });
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await login();
});

document.getElementById('logoutBtn').onclick = () => {
  sessionStorage.removeItem(tokenKey);
  location.reload();
};
document.getElementById('createTaskBtn').onclick = createTask;
document.getElementById('generateBtn').onclick = generate;
document.getElementById('saveFinalBtn').onclick = saveFinal;
document.getElementById('approveBtn').onclick = approveTask;
document.getElementById('refreshBtn').onclick = loadHistory;
document.getElementById('language').onchange = (e) => renderSections(gatherSections(), e.target.value);

document.querySelectorAll('.moduleBtn').forEach((btn) => {
  btn.onclick = () => {
    currentModule = btn.dataset.module;
    currentTaskId = null;
    document.getElementById('moduleTitle').textContent = btn.textContent;
    updateModuleVisibility();
    if (currentModule !== 'admin') loadHistory();
  };
});

document.getElementById('loadUsers').onclick = () => loadCrud('users', ['email', 'name', 'role', 'password']);
document.getElementById('loadPrompts').onclick = () => loadCrud('prompts', ['module', 'language', 'version', 'content', 'is_active']);
document.getElementById('loadKnowledge').onclick = () => loadCrud('knowledge', ['title', 'body', 'tags', 'language']);
document.getElementById('loadTemplates').onclick = () => loadCrud('templates', ['module', 'language', 'template_type', 'title', 'body', 'is_active']);
document.getElementById('loadPricing').onclick = () => loadCrud('pricing', ['module', 'service', 'min_price', 'max_price', 'currency', 'notes']);

loadMe();
