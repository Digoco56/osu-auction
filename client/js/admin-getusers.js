const API_BASE = '';
const pendingRoleUpdates = {};
const pendingTeamUpdates = {};
let users = [];
let teams = [];

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

Promise.all([
  fetch(`${API_BASE}/admin/logged-users`),
  fetch(`${API_BASE}/admin/teams`)
])
  .then(async ([usersResponse, teamsResponse]) => {
    if (!usersResponse.ok || !teamsResponse.ok) {
      window.location.href = '/';
      throw new Error('Could not load users');
    }
    return Promise.all([usersResponse.json(), teamsResponse.json()]);
  })
  .then(([loadedUsers, loadedTeams]) => {
    users = loadedUsers;
    teams = loadedTeams;
    renderUsers();
  })
  .catch(error => {
    console.error('Error fetching users:', error);
    statusMessage.textContent = 'Users could not be loaded.';
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
  filterResult.textContent = `${filteredUsers.length} of ${users.length} users`;
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
    pendingRoleUpdates[event.target.dataset.userId] = event.target.value;
  });
  roleCell.appendChild(select);
  row.appendChild(roleCell);

  const teamCell = document.createElement('td');
  const teamSelect = document.createElement('select');
  teamSelect.className = 'team-select';
  teamSelect.dataset.userId = user.user_id;
  teamSelect.add(new Option('No team', '', false, !user.team_id));
  teams.forEach(team => {
    teamSelect.add(new Option(
      team.name,
      team.team_id,
      false,
      String(team.team_id) === String(user.team_id)
    ));
  });
  teamSelect.addEventListener('change', event => {
    pendingTeamUpdates[event.target.dataset.userId] = event.target.value || null;
  });
  teamCell.appendChild(teamSelect);
  row.appendChild(teamCell);
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
  const roleEntries = Object.entries(pendingRoleUpdates);
  const teamEntries = Object.entries(pendingTeamUpdates);
  if (!roleEntries.length && !teamEntries.length) {
    statusMessage.textContent = 'There are no pending changes.';
    return;
  }

  saveButton.disabled = true;
  try {
    await Promise.all(roleEntries.map(async ([userId, role]) => {
      const response = await fetch(`${API_BASE}/admin/set-role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role })
      });
      if (!response.ok) throw new Error(`Could not update user ${userId}`);
      const user = users.find(item => String(item.user_id) === String(userId));
      if (user) user.role = role;
      delete pendingRoleUpdates[userId];
    }));
    await Promise.all(teamEntries.map(async ([userId, teamId]) => {
      const response = await fetch(`${API_BASE}/admin/set-user-team`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, teamId })
      });
      if (!response.ok) throw new Error(`Could not update team for user ${userId}`);
      const user = users.find(item => String(item.user_id) === String(userId));
      const team = teams.find(item => String(item.team_id) === String(teamId));
      if (user) {
        user.team_id = teamId;
        user.team_name = team?.name || null;
      }
      delete pendingTeamUpdates[userId];
    }));
    statusMessage.textContent = 'Changes saved successfully.';
    renderUsers();
  } catch (error) {
    console.error('Error updating roles:', error);
    statusMessage.textContent = 'Not all changes could be saved.';
  } finally {
    saveButton.disabled = false;
  }
};

