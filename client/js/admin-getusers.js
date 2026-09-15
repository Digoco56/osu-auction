const API_BASE = 'https://osu-auction.onrender.com';
const pendingUpdates = {};
let users = [];

const table = document.getElementById('user-table');
const filterField = document.getElementById('user-filter-field');
const filterValue = document.getElementById('user-filter-value');
const roleFilter = document.getElementById('user-role-filter');
const filterResult = document.getElementById('user-filter-result');
const emptyState = document.getElementById('user-empty-state');
const statusMessage = document.getElementById('user-status');
const saveButton = document.getElementById('save-roles-button');

document.querySelectorAll('.admin-nav-button').forEach(button => {
  button.addEventListener('click', () => {
    const panelId = button.dataset.panel;
    document.querySelectorAll('.admin-nav-button').forEach(navButton => {
      const isActive = navButton === button;
      navButton.classList.toggle('is-active', isActive);
      navButton.setAttribute('aria-selected', isActive);
    });
    document.querySelectorAll('.admin-panel').forEach(panel => {
      const isVisible = panel.id === panelId;
      panel.hidden = !isVisible;
      panel.classList.toggle('is-visible', isVisible);
    });
  });
});

fetch(`${API_BASE}/admin/logged-users`)
  .then(response => {
    if (!response.ok) {
      window.location.href = '/';
      throw new Error('Could not load users');
    }
    return response.json();
  })
  .then(loadedUsers => {
    users = loadedUsers;
    renderUsers();
  })
  .catch(error => {
    console.error('Error fetching users:', error);
    statusMessage.textContent = 'No se pudieron cargar los usuarios.';
  });

function renderUsers() {
  const search = filterValue.value.trim().toLowerCase();
  const selectedField = filterField.value;
  const selectedRole = roleFilter.value;
  const filteredUsers = users.filter(user => {
    const matchesRole = selectedRole === 'all' || user.role === selectedRole;
    if (!matchesRole) return false;

    if (!search) return true;
    const values = selectedField === 'all'
      ? [user.user_id, user.username, user.role]
      : [user[selectedField]];
    return values.some(value => String(value ?? '').toLowerCase().includes(search));
  });

  table.replaceChildren();
  filteredUsers.forEach(user => table.appendChild(createUserRow(user)));
  filterResult.textContent = `${filteredUsers.length} de ${users.length} usuarios`;
  emptyState.classList.toggle('is-hidden', filteredUsers.length > 0);
}

function createUserRow(user) {
  const row = document.createElement('tr');
  row.append(
    createCell(user.user_id),
    createCell(user.username),
    createAvatarCell(user.avatar_url),
    createCell(user.role)
  );

  const roleCell = document.createElement('td');
  const select = document.createElement('select');
  select.className = 'role-select';
  select.dataset.userId = user.user_id;
  ['player', 'captain', 'admin'].forEach(role => {
    const option = new Option(role, role, false, user.role === role);
    select.add(option);
  });
  select.addEventListener('change', event => {
    pendingUpdates[event.target.dataset.userId] = event.target.value;
  });
  roleCell.appendChild(select);
  row.appendChild(roleCell);
  return row;
}

function createCell(value) {
  const cell = document.createElement('td');
  cell.textContent = value;
  return cell;
}

function createAvatarCell(avatarUrl) {
  const cell = document.createElement('td');
  if (!avatarUrl) {
    cell.textContent = '-';
    return cell;
  }
  const image = document.createElement('img');
  image.src = avatarUrl;
  image.alt = 'Avatar';
  cell.appendChild(image);
  return cell;
}

[filterField, filterValue, roleFilter].forEach(control => {
  control.addEventListener('input', renderUsers);
  control.addEventListener('change', renderUsers);
});

saveButton.onclick = async () => {
  const entries = Object.entries(pendingUpdates);
  if (!entries.length) {
    statusMessage.textContent = 'No hay cambios pendientes.';
    return;
  }

  saveButton.disabled = true;
  try {
    await Promise.all(entries.map(async ([userId, role]) => {
      const response = await fetch(`${API_BASE}/admin/set-role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role })
      });
      if (!response.ok) throw new Error(`Could not update user ${userId}`);
      const user = users.find(item => String(item.user_id) === String(userId));
      if (user) user.role = role;
      delete pendingUpdates[userId];
    }));
    statusMessage.textContent = 'Cambios guardados correctamente.';
    renderUsers();
  } catch (error) {
    console.error('Error updating roles:', error);
    statusMessage.textContent = 'No se pudieron guardar todos los cambios.';
  } finally {
    saveButton.disabled = false;
  }
};

document.body.appendChild(saveButton);
