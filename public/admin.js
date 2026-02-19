let token = sessionStorage.getItem('jwt') || '';

const userBadge = document.getElementById('userBadge');
const createUserForm = document.getElementById('createUserForm');
const usersTableBody = document.getElementById('usersTableBody');
const adminMessage = document.getElementById('adminMessage');

function showMessage(message, isError = false) {
  adminMessage.textContent = message;
  adminMessage.classList.toggle('error', isError);
  adminMessage.classList.toggle('success', !isError);
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

async function loadUsers() {
  const data = await api('/api/admin/users');
  renderUsers(data.users || []);
}

async function checkAdminAccess() {
  if (!token) {
    window.location.href = '/';
    return false;
  }

  try {
    const me = await api('/api/auth/me');
    if (me.role !== 'admin') {
      showMessage('Достъпът е само за администратори.', true);
      return false;
    }
    userBadge.textContent = `${me.displayName} (${me.role})`;
    return true;
  } catch {
    window.location.href = '/';
    return false;
  }
}

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
  await loadUsers();
})();
