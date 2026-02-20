let token = sessionStorage.getItem('jwt') || '';

const userBadge = document.getElementById('userBadge');
const adminSidebar = document.getElementById('adminSidebar');
const createUserForm = document.getElementById('createUserForm');
const usersTableBody = document.getElementById('usersTableBody');
const adminMessage = document.getElementById('adminMessage');

const adminUsersPanel = document.getElementById('adminUsersPanel');
const agentSettingsPanel = document.getElementById('agentSettingsPanel');
const agentSettingsTitle = document.getElementById('agentSettingsTitle');
const agentPromptForm = document.getElementById('agentPromptForm');
const agentKnowledgeForm = document.getElementById('agentKnowledgeForm');
const agentPromptInput = document.getElementById('agentPromptInput');
const agentKnowledgeTitle = document.getElementById('agentKnowledgeTitle');
const agentKnowledgeContent = document.getElementById('agentKnowledgeContent');
const agentKnowledgeSource = document.getElementById('agentKnowledgeSource');
const agentKnowledgeList = document.getElementById('agentKnowledgeList');
const agentMessage = document.getElementById('agentMessage');

let agents = [];
let activeAgent = null;

function showMessage(message, isError = false) {
  adminMessage.textContent = message;
  adminMessage.classList.toggle('error', isError);
  adminMessage.classList.toggle('success', !isError);
}

function showAgentMessage(message, isError = false) {
  agentMessage.textContent = message;
  agentMessage.classList.toggle('error', isError);
  agentMessage.classList.toggle('success', !isError);
}

function generatePassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let out = '';
  for (let i = 0; i < length; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}), Authorization: `Bearer ${token}` };
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';

  const res = await fetch(path, { ...options, headers });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.ok === false) {
    throw new Error(payload.message || payload.error || `HTTP ${res.status}`);
  }
  return payload;
}

function formatDate(dateValue) {
  if (!dateValue) return '-';
  return new Date(dateValue).toLocaleString('bg-BG');
}

function renderUsers(users) {
  usersTableBody.innerHTML = '';
  users.forEach((user) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${user.email}</td>
      <td>${user.displayName}</td>
      <td>${user.role}</td>
      <td>${formatDate(user.createdAt)}</td>
      <td>${user.isActive ? 'active' : 'disabled'}</td>
      <td>
        <button data-action="toggle" data-id="${user.id}" data-active="${user.isActive}">${user.isActive ? 'Disable' : 'Enable'}</button>
        <button data-action="reset" data-id="${user.id}">Reset Password</button>
      </td>
    `;
    usersTableBody.appendChild(tr);
  });
}

function renderKnowledge(items = []) {
  agentKnowledgeList.innerHTML = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.textContent = 'Няма добавена информация за този агент.';
    agentKnowledgeList.appendChild(li);
    return;
  }

  items.slice(0, 5).forEach((item) => {
    const li = document.createElement('li');
    const created = formatDate(item.created_at || item.createdAt);
    li.innerHTML = `<strong>${item.title || '(без заглавие)'}</strong><small>${created}</small>`;
    agentKnowledgeList.appendChild(li);
  });
}

async function loadUsers() {
  const data = await api('/api/admin/users');
  renderUsers(data.users || []);
}

async function loadAgents() {
  const data = await api('/api/agents');
  agents = Array.isArray(data.agents) ? data.agents : [];

  if (!agents.length) {
    showAgentMessage('Няма активни агенти.', true);
    return;
  }

  const buttons = Array.from(adminSidebar.querySelectorAll('button[data-agent-tab]'));
  buttons.forEach((button) => {
    const code = button.dataset.agentTab;
    if (code === 'admin') return;
    const found = agents.find((agent) => agent.code === code);
    button.disabled = !found;
    if (found) button.textContent = found.name;
  });

  const firstAvailable = agents.find((agent) => !adminSidebar.querySelector(`button[data-agent-tab="${agent.code}"]`)?.disabled);
  if (firstAvailable) {
    setSidebarTab(firstAvailable.code);
    await loadAgentWorkspace(firstAvailable.code);
  }
}

async function loadAgentWorkspace(agentCode) {
  const selected = agents.find((agent) => agent.code === agentCode);
  if (!selected) {
    showAgentMessage('Агентът не е наличен.', true);
    return;
  }

  activeAgent = selected;
  agentSettingsTitle.textContent = `${selected.name} · Настройки`;

  const promptsData = await api('/api/admin/prompts');
  const promptRows = Array.isArray(promptsData.prompts) ? promptsData.prompts : [];
  const activePrompt = promptRows.find((row) => row.agent_id === selected.id && row.is_active);
  agentPromptInput.value = activePrompt?.system_prompt_text || '';

  const knowledgeData = await api(`/api/admin/knowledge?agentId=${selected.id}`);
  renderKnowledge(knowledgeData.docs || []);
}

function setSidebarTab(tabCode) {
  adminSidebar.querySelectorAll('button[data-agent-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.agentTab === tabCode);
  });

  if (tabCode === 'admin') {
    adminUsersPanel.classList.remove('hidden');
    agentSettingsPanel.classList.add('hidden');
  } else {
    adminUsersPanel.classList.add('hidden');
    agentSettingsPanel.classList.remove('hidden');
  }
}

async function checkAdminAccess() {
  if (!token) {
    window.location.href = '/';
    return false;
  }

  try {
    const me = await api('/api/auth/me');
    if (me.role !== 'admin') {
      window.location.href = '/';
      return false;
    }
    userBadge.textContent = `${me.displayName} (${me.role})`;
    return true;
  } catch {
    window.location.href = '/';
    return false;
  }
}

adminSidebar.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-agent-tab]');
  if (!button || button.disabled) return;

  const tabCode = button.dataset.agentTab;
  setSidebarTab(tabCode);

  if (tabCode !== 'admin') {
    try {
      await loadAgentWorkspace(tabCode);
    } catch (error) {
      showAgentMessage(error.message, true);
    }
  }
});

agentPromptForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!activeAgent) return;

  const text = agentPromptInput.value.trim();
  if (!text) {
    showAgentMessage('Добави системен промпт преди запазване.', true);
    return;
  }

  try {
    await api('/api/admin/prompts', {
      method: 'POST',
      body: JSON.stringify({
        agentId: activeAgent.id,
        systemPromptText: text,
        isActive: true
      })
    });
    showAgentMessage('Настройките за агента са запазени.');
    await loadAgentWorkspace(activeAgent.code);
  } catch (error) {
    showAgentMessage(error.message, true);
  }
});

agentKnowledgeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!activeAgent) return;

  const title = agentKnowledgeTitle.value.trim();
  const contentText = agentKnowledgeContent.value.trim();
  const source = agentKnowledgeSource.value.trim();

  if (!title || !contentText) {
    showAgentMessage('Попълни заглавие и информация.', true);
    return;
  }

  try {
    await api('/api/admin/knowledge', {
      method: 'POST',
      body: JSON.stringify({
        agentId: activeAgent.id,
        title,
        contentText,
        source
      })
    });
    showAgentMessage('Информацията е добавена успешно.');
    agentKnowledgeForm.reset();
    await loadAgentWorkspace(activeAgent.code);
  } catch (error) {
    showAgentMessage(error.message, true);
  }
});

createUserForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const formData = new FormData(createUserForm);
  const firstName = String(formData.get('firstName') || '').trim();
  const lastName = String(formData.get('lastName') || '').trim();
  const gender = String(formData.get('gender') || '').trim();
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const role = String(formData.get('role') || 'user').trim();
  const tempPassword = String(formData.get('tempPassword') || '').trim();

  if (!firstName || !lastName || !gender || !email || !role) {
    showMessage('Моля попълни всички задължителни полета.', true);
    return;
  }

  try {
    const payload = {
      firstName,
      lastName,
      gender,
      displayName: `${firstName} ${lastName}`,
      email,
      role,
      password: tempPassword || generatePassword()
    };

    const data = await api('/api/admin/users', { method: 'POST', body: JSON.stringify(payload) });
    const pwd = data.tempPassword || payload.password;
    showMessage(`Потребителят е създаден успешно. Временна парола: ${pwd}`);
    createUserForm.reset();
    createUserForm.role.value = 'user';
    await loadUsers();
  } catch (error) {
    showMessage(error.message, true);
  }
});

usersTableBody.addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;

  const userId = button.dataset.id;
  const action = button.dataset.action;

  try {
    if (action === 'toggle') {
      const isCurrentlyActive = button.dataset.active === 'true';
      await api(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !isCurrentlyActive })
      });
      showMessage(`Потребителят е ${isCurrentlyActive ? 'disabled' : 'enabled'}.`);
    }

    if (action === 'reset') {
      const data = await api(`/api/admin/users/${userId}/reset-password`, {
        method: 'POST'
      });
      showMessage(`Паролата е ресетната. Временна парола: ${data.tempPassword}`);

      if (navigator.clipboard?.writeText && data.tempPassword) {
        const copyBtn = document.createElement('button');
        copyBtn.textContent = 'Copy';
        copyBtn.onclick = async () => {
          await navigator.clipboard.writeText(data.tempPassword);
          showMessage('Паролата е копирана.');
        };
        adminMessage.appendChild(document.createTextNode(' '));
        adminMessage.appendChild(copyBtn);
      }
    }

    await loadUsers();
  } catch (error) {
    showMessage(error.message, true);
  }
});

(async () => {
  const allowed = await checkAdminAccess();
  if (!allowed) return;

  try {
    await loadUsers();
    await loadAgents();
  } catch (error) {
    showMessage(error.message, true);
  }
})();
