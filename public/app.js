const tokenKey = 'authToken';
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
  document.getElementById('adminPanel').classList.toggle('hidden', !isAdminModule || me?.role !== 'admin');
}

function getToken() {
  return sessionStorage.getItem(tokenKey);
}

function setToken(token) {
  sessionStorage.setItem(tokenKey, token);
}

function clearToken() {
  sessionStorage.removeItem(tokenKey);
}

function showLogin(error = '') {
  document.getElementById('loginView').classList.remove('hidden');
  document.getElementById('appView').classList.add('hidden');
  document.getElementById('loginError').textContent = error;
}

function showApp() {
  document.getElementById('loginView').classList.add('hidden');
  document.getElementById('appView').classList.remove('hidden');
}

async function api(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || 'Request failed');
    error.status = response.status;
    throw error;
  }

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

function generateStrongPassword(length = 16) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let password = '';
  for (let i = 0; i < bytes.length; i += 1) {
    password += alphabet[bytes[i] % alphabet.length];
  }
  return password;
}

async function login() {
  const loginError = document.getElementById('loginError');
  loginError.textContent = '';

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(body.error || 'Login failed');
      error.status = response.status;
      throw error;
    }

    if (!body?.token) {
      throw new Error('Missing auth token');
    }

    setToken(body.token);
    showApp();
    await loadMe();
  } catch (err) {
    if (err.status === 401) {
      clearToken();
    }
    showLogin(err.message || 'Login failed');
  }
}

async function loadMe() {
  me = await api('/api/auth/me', {
    headers: { Authorization: `Bearer ${getToken()}` }
  });
  document.getElementById('whoami').textContent = `${me.name} (${me.role})`;
  renderSections({}, document.getElementById('language').value);
  updateModuleVisibility();
  if (currentModule !== 'admin') {
    await loadHistory();
  }
}

async function bootstrapAuth() {
  const token = getToken();

  if (!token) {
    showLogin('');
    return;
  }

  try {
    await loadMe();
    showApp();
  } catch (err) {
    if (err.status === 401) {
      clearToken();
      showLogin('Session expired. Please login again.');
      return;
    }
    showLogin(err.message || 'Authentication check failed');
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

function createUserForm(root) {
  const form = document.createElement('div');
  form.className = 'crudForm';

  const emailInput = document.createElement('input');
  emailInput.placeholder = 'email';
  form.appendChild(emailInput);

  const nameInput = document.createElement('input');
  nameInput.placeholder = 'name';
  form.appendChild(nameInput);

  const roleSelect = document.createElement('select');
  ['admin', 'user'].forEach((role) => {
    const option = document.createElement('option');
    option.value = role;
    option.textContent = role;
    roleSelect.appendChild(option);
  });
  form.appendChild(roleSelect);

  const languageSelect = document.createElement('select');
  [
    { value: 'bg', label: 'Български' },
    { value: 'en', label: 'English' }
  ].forEach((language) => {
    const option = document.createElement('option');
    option.value = language.value;
    option.textContent = language.label;
    languageSelect.appendChild(option);
  });
  form.appendChild(languageSelect);

  const passwordInput = document.createElement('input');
  passwordInput.placeholder = 'password';
  passwordInput.type = 'text';
  form.appendChild(passwordInput);

  const generatePasswordBtn = document.createElement('button');
  generatePasswordBtn.textContent = 'Generate Password';
  generatePasswordBtn.type = 'button';
  generatePasswordBtn.onclick = () => {
    passwordInput.value = generateStrongPassword();
  };
  form.appendChild(generatePasswordBtn);

  const createBtn = document.createElement('button');
  createBtn.textContent = 'Create';
  createBtn.onclick = async () => {
    const payload = {
      email: emailInput.value,
      name: nameInput.value,
      role: roleSelect.value,
      language: languageSelect.value,
      password: passwordInput.value
    };
    await api('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) });
    await loadCrud('users', []);
  };
  form.appendChild(createBtn);

  root.appendChild(form);
}

async function loadCrud(resource, fields) {
  const rows = await api(`/api/admin/${resource}`);
  const root = document.getElementById('adminCrud');
  root.innerHTML = '';

  if (resource === 'users') {
    createUserForm(root);
  } else {
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
  }

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
  clearToken();
  showLogin('');
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

document.getElementById('loadUsers').onclick = () => loadCrud('users', []);
document.getElementById('loadPrompts').onclick = () => loadCrud('prompts', ['module', 'language', 'version', 'content', 'is_active']);
document.getElementById('loadKnowledge').onclick = () => loadCrud('knowledge', ['title', 'body', 'tags', 'language']);
document.getElementById('loadTemplates').onclick = () => loadCrud('templates', ['module', 'language', 'template_type', 'title', 'body', 'is_active']);
document.getElementById('loadPricing').onclick = () => loadCrud('pricing', ['module', 'service', 'min_price', 'max_price', 'currency', 'notes']);

bootstrapAuth();
