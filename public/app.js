let token = sessionStorage.getItem('jwt') || '';
let currentTab = 'email';
let currentTaskId = null;
let mustChangePassword = false;
let meState = null;

const loginView = document.getElementById('loginView');
const appView = document.getElementById('appView');

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
  document.documentElement.lang = language === 'en' ? 'en' : 'bg';
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
    if (me.role === 'admin') loadAdminUsers();
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
  document.getElementById('tabTitle').textContent = b.textContent;
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

document.getElementById('generatePasswordBtn').onclick = () => {
  document.getElementById('adminGeneratedPassword').value = randomPassword();
};

document.getElementById('copyPasswordBtn').onclick = async () => {
  const password = document.getElementById('adminGeneratedPassword').value || '';
  if (!password) {
    document.getElementById('adminUserStatus').textContent = 'Няма парола за копиране.';
    document.getElementById('adminUserStatus').className = 'status-message';
    return;
  }

  try {
    await navigator.clipboard.writeText(password);
    document.getElementById('adminUserStatus').textContent = 'Паролата е копирана.';
    document.getElementById('adminUserStatus').className = 'status-message success';
  } catch {
    const temp = document.createElement('textarea');
    temp.value = password;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand('copy');
    document.body.removeChild(temp);
    document.getElementById('adminUserStatus').textContent = 'Паролата е копирана.';
    document.getElementById('adminUserStatus').className = 'status-message success';
  }
};

document.getElementById('adminCreateUserForm').onsubmit = async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    const payload = {
      email: form.email.value,
      firstName: form.firstName.value,
      lastName: form.lastName.value,
      gender: form.gender.value,
      role: form.role.value,
      password: form.password.value
    };
    const result = await api('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) });
    document.getElementById('adminUserStatus').textContent = `Потребителят е създаден. Временна парола: ${result.tempPassword}`;
    document.getElementById('adminUserStatus').className = 'status-message success';
    form.reset();
    loadAdminUsers();
  } catch (e2) {
    document.getElementById('adminUserStatus').textContent = e2.message;
    document.getElementById('adminUserStatus').className = 'status-message';
  }
};

async function resetUserPassword(userId) {
  const data = await api(`/api/admin/users/${userId}/reset-password`, { method: 'POST' });
  document.getElementById('adminUserStatus').textContent = `Нова временна парола: ${data.tempPassword}`;
  document.getElementById('adminUserStatus').className = 'status-message success';
}

async function toggleUserActive(user) {
  await api(`/api/admin/users/${user.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ isActive: !user.isActive })
  });
}

async function deleteUser(user) {
  if (!confirm(`Сигурни ли сте, че искате да изтриете ${user.displayName}?`)) return;
  await api(`/api/admin/users/${user.id}`, { method: 'DELETE' });
}

async function loadAdminUsers() {
  if (!meState || meState.role !== 'admin') return;
  const res = await api('/api/admin/users');
  const list = document.getElementById('adminUsersList');
  list.innerHTML = '';

  res.users.forEach((u) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${u.displayName}</td><td>${u.email}</td><td>${u.role}</td><td>${u.isActive ? 'active' : 'inactive'}</td><td></td>`;
    const actionsTd = tr.querySelector('td:last-child');
    const actions = document.createElement('div');
    actions.className = 'table-actions';

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Ресет парола';
    resetBtn.onclick = async () => {
      try {
        await resetUserPassword(u.id);
      } catch (e) {
        document.getElementById('adminUserStatus').textContent = e.message;
        document.getElementById('adminUserStatus').className = 'status-message';
      }
    };

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn-warning';
    toggleBtn.textContent = u.isActive ? 'Деактивирай' : 'Активирай';
    toggleBtn.onclick = async () => {
      try {
        await toggleUserActive(u);
        await loadAdminUsers();
      } catch (e) {
        document.getElementById('adminUserStatus').textContent = e.message;
        document.getElementById('adminUserStatus').className = 'status-message';
      }
    };

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-danger';
    deleteBtn.textContent = 'Изтрий';
    deleteBtn.onclick = async () => {
      try {
        await deleteUser(u);
        await loadAdminUsers();
      } catch (e) {
        document.getElementById('adminUserStatus').textContent = e.message;
        document.getElementById('adminUserStatus').className = 'status-message';
      }
    };

    actions.appendChild(resetBtn);
    actions.appendChild(toggleBtn);
    actions.appendChild(deleteBtn);
    actionsTd.appendChild(actions);
    list.appendChild(tr);
  });
}

document.querySelectorAll('#adminTabs button[data-admin-tab]').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('#adminTabs button[data-admin-tab]').forEach((b) => b.classList.toggle('active', b === btn));
    const isUsers = btn.dataset.adminTab === 'users';
    document.getElementById('adminUsersTab').classList.toggle('hidden', !isUsers);
    document.getElementById('adminPlaceholder').classList.toggle('hidden', isUsers);
  };
});

applyTheme(localStorage.getItem('theme') || 'dark');
loadMe();
