let token = sessionStorage.getItem('jwt') || '';
let currentTab = 'email';
let currentTaskId = null;
let mustChangePassword = false;
let meState = null;

const loginView = document.getElementById('loginView');
const appView = document.getElementById('appView');

let currentLanguage = 'bg';

const I18N = {
  bg: {
    loginEmail: 'Имейл',
    loginPassword: 'Парола',
    loginBtn: 'Вход',
    tabs: { email: 'Имейл отговори', offers: 'Оферти', contracts: 'Договори', support: 'Поддръжка', marketing: 'Маркетинг', recruiting: 'Подбор', escalations: 'Управление на ескалации', sales: 'Продажби', accounting: 'Счетоводни проблеми', tax: 'Данъчни проблеми', cases: 'Казуси (НАП/фирми)', procedures: 'Правила и процедури', admin: 'Админ' },
    userMenu: { profile: 'Профил', settings: 'Настройки', password: 'Смяна на паролата', logout: 'Изход' },
    searchPlaceholder: 'Търсене в историята',
    refresh: 'Обнови',
    taskInput: 'Въведи задача',
    createTask: 'Създай задача',
    generateDraft: 'Генерирай чернова',
    saveFinal: 'Запази финално',
    approve: 'Одобри',
    history: 'История',
    profileTitle: 'Профил',
    saveProfile: 'Запази профила',
    settingsTitle: 'Настройки',
    language: 'Език',
    saveSettings: 'Запази настройки',
    passwordTitle: 'Смяна на парола (задължително)',
    passwordHelp: 'Този акаунт е с временна парола. Моля, въведете нова парола (мин. 8 символа), за да продължите.',
    newPassword: 'Нова парола',
    confirmPassword: 'Потвърди паролата',
    changePassword: 'Смени парола',
    adminPanels: 'Админ панели',
    createUserTitle: 'Създаване на потребител',
    labels: {
      firstName: 'Име', lastName: 'Фамилия', displayName: 'Показвано име', phone: 'Телефон', jobTitle: 'Позиция', company: 'Компания', bio: 'Био', avatar: 'Снимка на профил',
      email: 'Email', gender: 'Пол', role: 'Роля', password: 'Парола'
    },
    generate: 'Генерирай',
    copy: 'Копирай',
    createUser: 'Създай потребител',
    table: { name: 'Име', email: 'Email', role: 'Роля', status: 'Статус', actions: 'Действия', active: 'активен', inactive: 'неактивен' },
    sessions: { title: 'Потребителски сесии', refresh: 'Обнови сесиите', user: 'Потребител', loginFrom: 'Логнат от', lastSeen: 'Последна активност', duration: 'Продължителност', online: 'Онлайн', offline: 'Офлайн' },
    adminSubtabs: { users: 'Потребители', prompts: 'Промпти', knowledge: 'Знания', templates: 'Шаблони', pricing: 'Цени', agents: 'Агенти', sessions: 'Сесии', audit: 'Одит' }
  },
  en: {
    loginEmail: 'Email', loginPassword: 'Password', loginBtn: 'Login',
    tabs: { email: 'Email Replies', offers: 'Offers', contracts: 'Contracts', support: 'Support', marketing: 'Marketing', recruiting: 'Recruiting', escalations: 'Escalation Management', sales: 'Sales', accounting: 'Accounting Issues', tax: 'Tax Issues', cases: 'Cases (NRA/Companies)', procedures: 'Rules & Procedures', admin: 'Admin' },
    userMenu: { profile: 'Profile', settings: 'Settings', password: 'Change password', logout: 'Logout' },
    searchPlaceholder: 'Search history', refresh: 'Refresh', taskInput: 'Task input', createTask: 'Create Task', generateDraft: 'Generate Draft', saveFinal: 'Save Final', approve: 'Approve', history: 'History',
    profileTitle: 'Profile', saveProfile: 'Save profile', settingsTitle: 'Settings', language: 'Language', saveSettings: 'Save settings',
    passwordTitle: 'Change password (required)', passwordHelp: 'This account uses a temporary password. Please set a new password (min. 8 chars) to continue.', newPassword: 'New password', confirmPassword: 'Confirm password', changePassword: 'Change password',
    adminPanels: 'Admin Panels', createUserTitle: 'Create user',
    labels: { firstName: 'First name', lastName: 'Last name', displayName: 'Display name', phone: 'Phone', jobTitle: 'Job title', company: 'Company', bio: 'Bio', avatar: 'Profile picture', email: 'Email', gender: 'Gender', role: 'Role', password: 'Password' },
    generate: 'Generate', copy: 'Copy', createUser: 'Create user',
    table: { name: 'Name', email: 'Email', role: 'Role', status: 'Status', actions: 'Actions', active: 'active', inactive: 'inactive' },
    sessions: { title: 'User sessions', refresh: 'Refresh sessions', user: 'User', loginFrom: 'Logged in from', lastSeen: 'Last activity', duration: 'Duration', online: 'Online', offline: 'Offline' },
    adminSubtabs: { users: 'Users', prompts: 'Prompts', knowledge: 'Knowledge', templates: 'Templates', pricing: 'Pricing', agents: 'Agents', sessions: 'Sessions', audit: 'Audit' }
  }
};

function setLabelTextByInput(formId, fieldName, text) {
  const input = document.querySelector(`#${formId} [name="${fieldName}"]`) || (fieldName === 'avatar' ? document.getElementById('avatarInput') : null);
  if (!input) return;
  const label = input.closest('label');
  if (!label) return;
  const textNode = [...label.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
  if (textNode) textNode.textContent = text;
}

function translateUI(language) {
  const tr = I18N[language] || I18N.bg;
  document.getElementById('email').placeholder = tr.loginEmail;
  document.getElementById('password').placeholder = tr.loginPassword;
  document.getElementById('loginBtn').textContent = tr.loginBtn;

  document.querySelectorAll('aside button[data-tab]').forEach((btn) => {
    btn.textContent = tr.tabs[btn.dataset.tab] || btn.dataset.tab;
  });

  document.querySelectorAll('#userMenu button[data-user-action]').forEach((btn) => {
    btn.textContent = tr.userMenu[btn.dataset.userAction] || btn.dataset.userAction;
  });

  document.getElementById('search').placeholder = tr.searchPlaceholder;
  document.getElementById('refreshHistory').textContent = tr.refresh;
  document.getElementById('taskInput').placeholder = tr.taskInput;
  document.getElementById('createTask').textContent = tr.createTask;
  document.getElementById('generateDraft').textContent = tr.generateDraft;
  document.getElementById('saveFinal').textContent = tr.saveFinal;
  document.getElementById('approveTask').textContent = tr.approve;
  const historyTitle = document.querySelector('#workspacePanel h3');
  if (historyTitle) historyTitle.textContent = tr.history;

  const tabTitle = document.getElementById('tabTitle');
  if (tabTitle && tr.tabs[currentTab]) tabTitle.textContent = tr.tabs[currentTab];

  const passwordPanel = document.getElementById('passwordBox');
  const pTitle = passwordPanel.querySelector('h3');
  const pText = passwordPanel.querySelector('p');
  if (pTitle) pTitle.textContent = tr.passwordTitle;
  if (pText) pText.textContent = tr.passwordHelp;
  document.getElementById('newPassword').placeholder = tr.newPassword;
  document.getElementById('confirmPassword').placeholder = tr.confirmPassword;
  document.getElementById('changePasswordBtn').textContent = tr.changePassword;

  const profileTitle = document.querySelector('#profilePanel h3');
  if (profileTitle) profileTitle.textContent = tr.profileTitle;
  setLabelTextByInput('profileForm', 'firstName', tr.labels.firstName);
  setLabelTextByInput('profileForm', 'lastName', tr.labels.lastName);
  setLabelTextByInput('profileForm', 'displayName', tr.labels.displayName);
  setLabelTextByInput('profileForm', 'phone', tr.labels.phone);
  setLabelTextByInput('profileForm', 'jobTitle', tr.labels.jobTitle);
  setLabelTextByInput('profileForm', 'company', tr.labels.company);
  setLabelTextByInput('profileForm', 'bio', tr.labels.bio);
  setLabelTextByInput('profileForm', 'avatar', tr.labels.avatar);
  const profileSaveBtn = document.querySelector('#profileForm button[type="submit"]');
  if (profileSaveBtn) profileSaveBtn.textContent = tr.saveProfile;

  const settingsTitle = document.querySelector('#settingsPanel h3');
  if (settingsTitle) settingsTitle.textContent = tr.settingsTitle;
  const settingsLabel = document.querySelector('#settingsPanel label');
  if (settingsLabel) {
    const tn = [...settingsLabel.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
    if (tn) tn.textContent = tr.language;
  }
  document.getElementById('saveSettingsBtn').textContent = tr.saveSettings;

  const adminTitle = document.querySelector('#adminPanel h3');
  if (adminTitle) adminTitle.textContent = tr.adminPanels;
  document.querySelectorAll('#adminTabs button[data-admin-tab]').forEach((btn) => {
    btn.textContent = tr.adminSubtabs[btn.dataset.adminTab] || btn.dataset.adminTab;
  });
  const adminUserH4 = document.querySelector('#adminUsersTab h4');
  if (adminUserH4) adminUserH4.textContent = tr.createUserTitle;

  setLabelTextByInput('adminCreateUserForm', 'email', tr.labels.email);
  setLabelTextByInput('adminCreateUserForm', 'firstName', tr.labels.firstName);
  setLabelTextByInput('adminCreateUserForm', 'lastName', tr.labels.lastName);
  setLabelTextByInput('adminCreateUserForm', 'gender', tr.labels.gender);
  setLabelTextByInput('adminCreateUserForm', 'role', tr.labels.role);
  setLabelTextByInput('adminCreateUserForm', 'password', tr.labels.password);
  document.getElementById('generatePasswordBtn').textContent = tr.generate;
  document.getElementById('copyPasswordBtn').textContent = tr.copy;
  const createUserBtn = document.querySelector('#adminCreateUserForm button[type="submit"]');
  if (createUserBtn) createUserBtn.textContent = tr.createUser;

  const th = document.querySelectorAll('#adminUsersTable thead th');
  if (th.length >= 5) {
    th[0].textContent = tr.table.name;
    th[1].textContent = tr.table.email;
    th[2].textContent = tr.table.role;
    th[3].textContent = tr.table.status;
    th[4].textContent = tr.table.actions;
  }

  const sessionsTitle = document.getElementById('sessionsTitle');
  if (sessionsTitle) sessionsTitle.textContent = tr.sessions.title;
  const refreshSessionsBtn = document.getElementById('refreshSessionsBtn');
  if (refreshSessionsBtn) refreshSessionsBtn.textContent = tr.sessions.refresh;
  const sTh = document.querySelectorAll('#adminSessionsTable thead th');
  if (sTh.length >= 6) {
    sTh[0].textContent = tr.table.status;
    sTh[1].textContent = tr.sessions.user;
    sTh[2].textContent = tr.table.email;
    sTh[3].textContent = tr.sessions.loginFrom;
    sTh[4].textContent = tr.sessions.lastSeen;
    sTh[5].textContent = tr.sessions.duration;
  }
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const urls = [path];
  if (typeof path === 'string' && path.startsWith('/api/')) {
    const basePath = new URL(document.baseURI).pathname.replace(/[^/]*$/, '');
    const pathNoSlash = path.slice(1);
    urls.push(`${window.location.origin}${path}`);
    urls.push(pathNoSlash);
    urls.push(`${basePath}${pathNoSlash}`);
  }

  const uniqueUrls = [...new Set(urls)];
  let res = null;
  for (const url of uniqueUrls) {
    // eslint-disable-next-line no-await-in-loop
    res = await fetch(url, { ...options, headers });
    if (res.status !== 404) break;
  }

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const attempted = uniqueUrls.join(' -> ');
    throw new Error(payload.error || payload.message || `HTTP ${res.status} (${attempted})`);
  }
  return payload;
}

function randomPassword(len = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  let out = '';
  for (let i = 0; i < len; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return `${out}A1!`;
}

function applyTheme(theme) {
  const normalized = theme === 'light' ? 'light' : 'dark';
  document.body.classList.toggle('theme-light', normalized === 'light');
  document.getElementById('themeToggle').textContent = normalized === 'light' ? '☀️' : '🌙';
  localStorage.setItem('theme', normalized);
}

function applyLanguage(language) {
  currentLanguage = language === 'en' ? 'en' : 'bg';
  document.documentElement.lang = currentLanguage;
  localStorage.setItem('language', currentLanguage);
  translateUI(currentLanguage);
}

function setWorkEnabled(enabled) {
  ['createTask', 'generateDraft', 'saveFinal', 'approveTask', 'refreshHistory', 'search', 'taskInput'].forEach((id) => {
    document.getElementById(id).disabled = !enabled;
  });
  document.querySelectorAll('#sideNav button[data-tab]').forEach((btn) => { btn.disabled = !enabled; });
}

function hideContextPanels() {
  ['profilePanel', 'settingsPanel', 'passwordBox'].forEach((id) => document.getElementById(id).classList.add('hidden'));
}

function setActiveSidebar() {
  document.querySelectorAll('aside button[data-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === currentTab);
  });
}

function updateWorkspaceVisibility() {
  const adminPanel = document.getElementById('adminPanel');
  const workspacePanel = document.getElementById('workspacePanel');
  const isAdminWorkspace = Boolean(meState && meState.role === 'admin' && currentTab === 'admin' && !mustChangePassword);
  adminPanel.classList.toggle('hidden', !isAdminWorkspace);
  workspacePanel.classList.toggle('hidden', isAdminWorkspace || mustChangePassword);
}

function renderProfile(profile) {
  const form = document.getElementById('profileForm');
  form.firstName.value = profile.firstName || '';
  form.lastName.value = profile.lastName || '';
  form.displayName.value = profile.displayName || '';
  form.phone.value = profile.phone || '';
  form.jobTitle.value = profile.jobTitle || '';
  form.company.value = profile.company || '';
  form.bio.value = profile.bio || '';
  document.getElementById('languageSelect').value = profile.language || 'bg';
}

async function loadProfile() {
  const data = await api('/api/profile');
  renderProfile(data.profile);
}

function logout() {
  sessionStorage.removeItem('jwt');
  token = '';
  meState = null;
  loginView.classList.remove('hidden');
  appView.classList.add('hidden');
  const adminBtn = document.getElementById('adminTabBtn');
  if (adminBtn) adminBtn.classList.add('hidden');
}

async function loadMe() {
  if (!token) return;
  try {
    const me = await api('/api/auth/me');
    meState = me;
    loginView.classList.add('hidden');
    appView.classList.remove('hidden');
    document.getElementById('userMenuBtn').textContent = `${me.displayName} (${me.role})`;
    const adminBtn = document.getElementById('adminTabBtn');
    if (adminBtn) adminBtn.classList.toggle('hidden', me.role !== 'admin');
    if (me.role !== 'admin' && currentTab === 'admin') currentTab = 'email';
    mustChangePassword = Boolean(me.mustChangePassword);
    applyTheme(me.theme || localStorage.getItem('theme') || 'dark');
    applyLanguage(me.language || 'bg');
    renderProfile(me);

    if (mustChangePassword) {
      currentTab = 'email';
      setWorkEnabled(false);
      hideContextPanels();
      document.getElementById('passwordBox').classList.remove('hidden');
    } else {
      setWorkEnabled(true);
      hideContextPanels();
      updateWorkspaceVisibility();
      loadHistory();
    }

    setActiveSidebar();
    updateWorkspaceVisibility();
    if (me.role === 'admin') { loadAdminUsers(); loadAdminSessions(); bootstrapAdminCenter(); }
  } catch {
    logout();
  }
}

document.getElementById('themeToggle').onclick = async () => {
  const current = document.body.classList.contains('theme-light') ? 'light' : 'dark';
  const next = current === 'light' ? 'dark' : 'light';
  applyTheme(next);
  if (token) {
    try {
      await api('/api/profile', { method: 'POST', body: JSON.stringify({ theme: next }) });
    } catch {
      // no-op UI fallback
    }
  }
};

document.getElementById('loginBtn').onclick = async () => {
  try {
    const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: email.value, password: password.value }) });
    token = data.token;
    sessionStorage.setItem('jwt', token);
    await loadMe();
  } catch (e) {
    document.getElementById('loginError').textContent = e.message;
  }
};

function bindPasswordVisibilityToggle(toggleId, inputId) {
  const toggleBtn = document.getElementById(toggleId);
  const input = document.getElementById(inputId);
  toggleBtn.onclick = () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    toggleBtn.textContent = show ? '🙈' : '👁️';
  };
}

bindPasswordVisibilityToggle('toggleNewPassword', 'newPassword');
bindPasswordVisibilityToggle('toggleConfirmPassword', 'confirmPassword');

document.getElementById('changePasswordBtn').onclick = async () => {
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  if (newPassword !== confirmPassword) {
    document.getElementById('passwordError').textContent = 'Паролите не съвпадат.';
    return;
  }

  try {
    await api('/api/profile/change-password', {
      method: 'POST',
      body: JSON.stringify({ newPassword })
    });
    document.getElementById('passwordError').textContent = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
    mustChangePassword = false;
    hideContextPanels();
    setWorkEnabled(true);
    updateWorkspaceVisibility();
    alert('Паролата е сменена успешно.');
    loadHistory();
  } catch (e) {
    document.getElementById('passwordError').textContent = e.message;
  }
};

document.getElementById('userMenuBtn').onclick = () => {
  document.getElementById('userMenu').classList.toggle('hidden');
};

document.querySelectorAll('#userMenu button[data-user-action]').forEach((btn) => {
  btn.onclick = async () => {
    const action = btn.dataset.userAction;
    document.getElementById('userMenu').classList.add('hidden');

    if (action === 'logout') {
      logout();
      return;
    }
    if (action === 'password') {
      hideContextPanels();
      document.getElementById('passwordBox').classList.remove('hidden');
      return;
    }
    if (action === 'profile') {
      hideContextPanels();
      document.getElementById('profilePanel').classList.remove('hidden');
      await loadProfile();
      return;
    }
    if (action === 'settings') {
      hideContextPanels();
      document.getElementById('settingsPanel').classList.remove('hidden');
      await loadProfile();
    }
  };
});

document.querySelectorAll('aside button[data-tab]').forEach((b) => b.onclick = () => {
  if (mustChangePassword) return;
  currentTab = b.dataset.tab;
  document.getElementById('tabTitle').textContent = (I18N[currentLanguage] && I18N[currentLanguage].tabs[currentTab]) || b.textContent;
  currentTaskId = null;
  document.getElementById('sections').innerHTML = '';
  setActiveSidebar();
  updateWorkspaceVisibility();
  hideContextPanels();
  if (currentTab !== 'admin') loadHistory();
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

document.getElementById('profileForm').onsubmit = async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    await api('/api/profile', {
      method: 'POST',
      body: JSON.stringify({
        firstName: form.firstName.value,
        lastName: form.lastName.value,
        displayName: form.displayName.value,
        phone: form.phone.value,
        jobTitle: form.jobTitle.value,
        company: form.company.value,
        bio: form.bio.value,
        language: document.getElementById('languageSelect').value,
        theme: document.body.classList.contains('theme-light') ? 'light' : 'dark'
      })
    });

    const avatar = document.getElementById('avatarInput').files[0];
    if (avatar) {
      const fd = new FormData();
      fd.append('avatar', avatar);
      await api('/api/profile/avatar', { method: 'POST', body: fd, headers: {} });
    }

    document.getElementById('profileStatus').textContent = 'Профилът е запазен успешно.';
    document.getElementById('profileStatus').className = 'status-message success';
    await loadMe();
  } catch (err) {
    document.getElementById('profileStatus').textContent = err.message;
    document.getElementById('profileStatus').className = 'status-message';
  }
};

document.getElementById('saveSettingsBtn').onclick = async () => {
  try {
    await api('/api/profile', {
      method: 'POST',
      body: JSON.stringify({
        language: document.getElementById('languageSelect').value,
        theme: document.body.classList.contains('theme-light') ? 'light' : 'dark'
      })
    });
    document.getElementById('settingsStatus').textContent = 'Настройките са запазени.';
    document.getElementById('settingsStatus').className = 'status-message success';
    await loadMe();
  } catch (e) {
    document.getElementById('settingsStatus').textContent = e.message;
    document.getElementById('settingsStatus').className = 'status-message';
  }
};

const adminAgentSelector = document.getElementById('adminAgentSelector');
const adminAgentStatus = document.getElementById('adminAgentStatus');
let adminAgentsCache = [];
let adminSelectedAgentId = null;

function showAdminStatus(message, isError = false) {
  if (!adminAgentStatus) return;
  adminAgentStatus.textContent = message || '';
  adminAgentStatus.className = isError ? 'status-message' : 'status-message success';
}

async function loadAdminAgents() {
  const data = await api('/api/admin/agents');
  adminAgentsCache = data.agents || [];
  if (!adminAgentSelector) return;
  adminAgentSelector.innerHTML = adminAgentsCache.map((a) => `<option value="${a.id}">${a.name} (${a.key})</option>`).join('');
  if (!adminSelectedAgentId && adminAgentsCache[0]) adminSelectedAgentId = adminAgentsCache[0].id;
  if (adminSelectedAgentId) adminAgentSelector.value = String(adminSelectedAgentId);
}

function selectedAgent() {
  return adminAgentsCache.find((a) => String(a.id) === String(adminSelectedAgentId));
}

function renderSimpleList(containerId, rows, formatter) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  rows.forEach((row) => {
    const li = document.createElement('li');
    li.innerHTML = formatter(row);
    el.appendChild(li);
  });
}

async function loadAgentDataForActiveTab(tab) {
  if (!adminSelectedAgentId) return;
  if (tab === 'prompts') {
    const data = await api(`/api/admin/agents/${adminSelectedAgentId}/prompts`);
    renderSimpleList('adminPromptsList', data.prompts || [], (p) => `${p.type} v${p.version} ${p.is_active ? '[active]' : ''}<br/><small>${(p.content || '').slice(0, 180)}</small> <button data-activate-prompt="${p.id}">Активирай</button>`);
  }
  if (tab === 'knowledge') {
    const data = await api(`/api/admin/agents/${adminSelectedAgentId}/knowledge`);
    renderSimpleList('adminKnowledgeList', data.knowledge || [], (k) => `${k.title} ${k.is_active ? '' : '(off)'}<br/><small>${(k.content || '').slice(0, 140)}</small> <button data-delete-knowledge="${k.id}">Delete</button>`);
  }
  if (tab === 'templates') {
    const data = await api(`/api/admin/agents/${adminSelectedAgentId}/templates`);
    renderSimpleList('adminTemplatesList', data.templates || [], (t) => `${t.name}<br/><small>${(t.content || '').slice(0, 140)}</small> <button data-delete-template="${t.id}">Delete</button>`);
  }
  if (tab === 'agents') {
    renderSimpleList('adminAgentsList', adminAgentsCache, (a) => `${a.name} (${a.key}) - ${a.is_enabled ? 'enabled' : 'disabled'}`);
    const current = selectedAgent();
    const form = document.getElementById('adminAgentEditForm');
    if (current && form) {
      form.name.value = current.name || '';
      form.description.value = current.description || '';
      form.is_enabled.value = String(Boolean(current.is_enabled));
    }
  }
  if (tab === 'audit') {
    const data = await api(`/api/admin/agents/${adminSelectedAgentId}/audit`);
    renderSimpleList('adminAuditList', data.audit || [], (a) => `${a.action} <small>${new Date(a.created_at).toLocaleString()}</small>`);
  }
  if (tab === 'examples') {
    const data = await api(`/api/admin/agents/${adminSelectedAgentId}/examples`);
    renderSimpleList('adminExamplesList', data.examples || [], (e) => `${e.status} | ${(e.input_text || '').slice(0, 80)} <button data-approve-example="${e.id}">Approve</button> <button data-reject-example="${e.id}">Reject</button>`);
  }
  if (tab === 'debug') {
    const data = await api(`/api/admin/agents/${adminSelectedAgentId}/debug-context`);
    const box = document.getElementById('adminDebugBox');
    if (box) box.textContent = JSON.stringify(data, null, 2);
  }
}

document.getElementById('generatePasswordBtn').onclick = () => {
  document.getElementById('adminGeneratedPassword').value = randomPassword();
};

document.getElementById('copyPasswordBtn').onclick = async () => {
  const password = document.getElementById('adminGeneratedPassword').value || '';
  if (!password) return;
  await navigator.clipboard.writeText(password).catch(() => {});
};

document.getElementById('adminCreateUserForm').onsubmit = async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    const payload = { email: form.email.value, firstName: form.firstName.value, lastName: form.lastName.value, gender: form.gender.value, role: form.role.value, password: form.password.value };
    const result = await api('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) });
    document.getElementById('adminUserStatus').textContent = `Потребителят е създаден. Временна парола: ${result.tempPassword}`;
    document.getElementById('adminUserStatus').className = 'status-message success';
    form.reset();
    await loadAdminUsers();
  } catch (e2) {
    document.getElementById('adminUserStatus').textContent = e2.message;
    document.getElementById('adminUserStatus').className = 'status-message';
  }
};

async function resetUserPassword(userId) { const data = await api(`/api/admin/users/${userId}/reset-password`, { method: 'POST' }); document.getElementById('adminUserStatus').textContent = `Нова временна парола: ${data.tempPassword}`; }
async function toggleUserActive(user) { await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !user.isActive }) }); }
async function deleteUser(user) { if (!confirm(`Сигурни ли сте, че искате да изтриете ${user.displayName}?`)) return; await api(`/api/admin/users/${user.id}`, { method: 'DELETE' }); }

async function loadAdminUsers() {
  if (!meState || meState.role !== 'admin') return;
  const res = await api('/api/admin/users');
  const list = document.getElementById('adminUsersList');
  list.innerHTML = '';
  res.users.forEach((u) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${u.displayName}</td><td>${u.email}</td><td>${u.role}</td><td>${u.isActive ? I18N[currentLanguage].table.active : I18N[currentLanguage].table.inactive}</td><td class="actions-cell"></td>`;
    const actionsTd = tr.querySelector('td:last-child');
    const actions = document.createElement('div'); actions.className = 'table-actions';
    ['reset','toggle','delete'].forEach((kind) => { const b=document.createElement('button'); b.className='btn-secondary btn-compact'; b.textContent=kind; b.onclick=async()=>{ try { if(kind==='reset') await resetUserPassword(u.id); if(kind==='toggle'){await toggleUserActive(u); await loadAdminUsers();} if(kind==='delete'){await deleteUser(u); await loadAdminUsers();} } catch(err){ document.getElementById('adminUserStatus').textContent = err.message; } }; actions.appendChild(b); });
    actionsTd.appendChild(actions); list.appendChild(tr);
  });
}

function formatDuration(seconds) { if (seconds === null || Number.isNaN(seconds)) return '-'; const h = Math.floor(seconds / 3600); const m = Math.floor((seconds % 3600) / 60); const sec = seconds % 60; return `${h}h ${m}m ${sec}s`; }
function formatDateTimeCell(value) { if (!value) return '-'; const d = new Date(value); return `<div class="datetime-cell"><span>${d.toLocaleDateString()}</span><small>${d.toLocaleTimeString()}</small></div>`; }

async function loadAdminSessions() {
  if (!meState || meState.role !== 'admin') return;
  const res = await api('/api/admin/sessions');
  const list = document.getElementById('adminSessionsList'); if (!list) return;
  list.innerHTML = '';
  res.sessions.forEach((session) => {
    const tr = document.createElement('tr');
    const statusText = session.isOnline ? I18N[currentLanguage].sessions.online : I18N[currentLanguage].sessions.offline;
    tr.innerHTML = `<td><div class="session-status"><span class="status-dot ${session.isOnline ? 'online' : 'offline'}"></span>${statusText}</div></td><td>${session.displayName}</td><td>${session.email}</td><td>${formatDateTimeCell(session.lastLoginAt)}</td><td>${formatDateTimeCell(session.lastSeenAt)}</td><td>${formatDuration(session.sessionDurationSec)}</td>`;
    list.appendChild(tr);
  });
}

document.getElementById('refreshSessionsBtn').onclick = loadAdminSessions;

if (adminAgentSelector) {
  adminAgentSelector.onchange = async () => {
    adminSelectedAgentId = Number(adminAgentSelector.value);
    const activeTab = document.querySelector('#adminTabs button.active')?.dataset.adminTab || 'users';
    await loadAgentDataForActiveTab(activeTab).catch((e) => showAdminStatus(e.message, true));
  };
}

const promptForm = document.getElementById('adminPromptForm');
if (promptForm) promptForm.onsubmit = async (e) => { e.preventDefault(); try { await api(`/api/admin/agents/${adminSelectedAgentId}/prompts`, { method: 'POST', body: JSON.stringify({ type: promptForm.type.value, content: promptForm.content.value }) }); promptForm.reset(); showAdminStatus('Промптът е добавен.'); await loadAgentDataForActiveTab('prompts'); } catch (err) { showAdminStatus(err.message, true); } };

const knowledgeForm = document.getElementById('adminKnowledgeForm');
if (knowledgeForm) knowledgeForm.onsubmit = async (e) => { e.preventDefault(); try { await api(`/api/admin/agents/${adminSelectedAgentId}/knowledge`, { method: 'POST', body: JSON.stringify({ title: knowledgeForm.title.value, content: knowledgeForm.content.value, source: knowledgeForm.source.value, tags: knowledgeForm.tags.value }) }); knowledgeForm.reset(); showAdminStatus('Знанието е добавено.'); await loadAgentDataForActiveTab('knowledge'); } catch (err) { showAdminStatus(err.message, true); } };

const templateForm = document.getElementById('adminTemplateForm');
if (templateForm) templateForm.onsubmit = async (e) => { e.preventDefault(); try { await api(`/api/admin/agents/${adminSelectedAgentId}/templates`, { method: 'POST', body: JSON.stringify({ name: templateForm.name.value, content: templateForm.content.value, tags: templateForm.tags.value }) }); templateForm.reset(); showAdminStatus('Шаблонът е добавен.'); await loadAgentDataForActiveTab('templates'); } catch (err) { showAdminStatus(err.message, true); } };

const exampleForm = document.getElementById('adminExampleForm');
if (exampleForm) exampleForm.onsubmit = async (e) => { e.preventDefault(); try { await api(`/api/admin/agents/${adminSelectedAgentId}/examples`, { method: 'POST', body: JSON.stringify({ input_text: exampleForm.input_text.value, output_text: exampleForm.output_text.value, status: exampleForm.status.value }) }); exampleForm.reset(); showAdminStatus('Примерът е добавен.'); await loadAgentDataForActiveTab('examples'); } catch (err) { showAdminStatus(err.message, true); } };

const agentEditForm = document.getElementById('adminAgentEditForm');
if (agentEditForm) agentEditForm.onsubmit = async (e) => { e.preventDefault(); try { await api(`/api/admin/agents/${adminSelectedAgentId}`, { method: 'PUT', body: JSON.stringify({ name: agentEditForm.name.value, description: agentEditForm.description.value, is_enabled: agentEditForm.is_enabled.value === 'true' }) }); showAdminStatus('Агентът е обновен.'); await loadAdminAgents(); await loadAgentDataForActiveTab('agents'); } catch (err) { showAdminStatus(err.message, true); } };

document.getElementById('adminRefreshAgentBtn').onclick = async () => {
  try {
    await loadAdminAgents();
    const activeTab = document.querySelector('#adminTabs button.active')?.dataset.adminTab || 'users';
    await loadAgentDataForActiveTab(activeTab);
    showAdminStatus('Данните са обновени.');
  } catch (e) {
    showAdminStatus(e.message, true);
  }
};

document.getElementById('adminPanel').addEventListener('click', async (event) => {
  const activateBtn = event.target.closest('[data-activate-prompt]');
  const deleteKnowledgeBtn = event.target.closest('[data-delete-knowledge]');
  const deleteTemplateBtn = event.target.closest('[data-delete-template]');
  const approveExampleBtn = event.target.closest('[data-approve-example]');
  const rejectExampleBtn = event.target.closest('[data-reject-example]');
  try {
    if (activateBtn) { await api(`/api/admin/prompts/${activateBtn.dataset.activatePrompt}/activate`, { method: 'POST' }); await loadAgentDataForActiveTab('prompts'); showAdminStatus('Промптът е активиран.'); }
    if (deleteKnowledgeBtn) { await api(`/api/admin/knowledge/${deleteKnowledgeBtn.dataset.deleteKnowledge}`, { method: 'DELETE' }); await loadAgentDataForActiveTab('knowledge'); showAdminStatus('Изтрито.'); }
    if (deleteTemplateBtn) { await api(`/api/admin/templates/${deleteTemplateBtn.dataset.deleteTemplate}`, { method: 'DELETE' }); await loadAgentDataForActiveTab('templates'); showAdminStatus('Изтрито.'); }
    if (approveExampleBtn) { await api(`/api/admin/examples/${approveExampleBtn.dataset.approveExample}/approve`, { method: 'POST' }); await loadAgentDataForActiveTab('examples'); showAdminStatus('Одобрен пример.'); }
    if (rejectExampleBtn) { await api(`/api/admin/examples/${rejectExampleBtn.dataset.rejectExample}/reject`, { method: 'POST' }); await loadAgentDataForActiveTab('examples'); showAdminStatus('Отхвърлен пример.'); }
  } catch (err) { showAdminStatus(err.message, true); }
});

document.querySelectorAll('#adminTabs button[data-admin-tab]').forEach((btn) => {
  btn.onclick = async () => {
    document.querySelectorAll('#adminTabs button[data-admin-tab]').forEach((b) => b.classList.toggle('active', b === btn));
    const tab = btn.dataset.adminTab;
    ['Users','Prompts','Knowledge','Templates','Pricing','Agents','Sessions','Audit','Examples','Debug'].forEach((name) => {
      const pane = document.getElementById(`admin${name}Tab`);
      if (pane) pane.classList.toggle('hidden', tab !== name.toLowerCase());
    });
    if (tab === 'sessions') await loadAdminSessions();
    if (tab !== 'users' && tab !== 'sessions') await loadAgentDataForActiveTab(tab);
  };
});

async function bootstrapAdminCenter() {
  if (!meState || meState.role !== 'admin') return;
  await loadAdminAgents();
  await loadAgentDataForActiveTab('prompts').catch(() => {});
}

applyTheme(localStorage.getItem('theme') || 'dark');
applyLanguage(localStorage.getItem('language') || 'bg');
loadMe();
