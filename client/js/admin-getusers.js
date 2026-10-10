const API_BASE = '';
const pendingRoleUpdates = {};
const pendingTeamUpdates = {};
const pendingParticipationUpdates = {};
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
    users = loadedUsers.users;
    teams = loadedTeams;
    STAFF_ROLES = loadedUsers.staffRoles;
    STAFF_ROLES.forEach(({ id, label }) => roleFilter.add(new Option(label, id)));
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
    const matchesRole = selectedRole === 'all'
      || user.role === selectedRole
      || (user.staff_roles || []).includes(selectedRole);
    if (!matchesRole) return false;

    if (!search) return true;
    const values = selectedField === 'all'
      ? [user.user_id, user.username, ...getUserRoleLabels(user)]
      : selectedField === 'role'
        ? getUserRoleLabels(user)
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
    createCell(getUserRoleLabels(user).join(' · '))
  );

  const roleCell = document.createElement('td');
  const select = document.createElement('select');
  select.className = 'role-select';
  select.dataset.userId = user.user_id;
  const staffRoleOptions = document.createElement('div');
  staffRoleOptions.className = 'staff-role-options';
  ['player', 'captain', 'admin'].forEach(role => {
    const option = new Option(role, role, false, user.role === role);
    select.add(option);
  });
  select.addEventListener('change', event => {
    updateStaffRoleAvailability(staffRoleOptions, event.target.value);
    queueRoleUpdate(event.target.dataset.userId, roleCell, event.target.value);
  });
  roleCell.append(select, staffRoleOptions);
  STAFF_ROLES.forEach(({ id, label }) => {
    const optionLabel = document.createElement('label');
    optionLabel.className = 'staff-role-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'staff-role-checkbox';
    checkbox.value = id;
    checkbox.checked = (user.staff_roles || []).includes(id);
    checkbox.addEventListener('change', () => queueRoleUpdate(user.user_id, roleCell));
    optionLabel.append(checkbox, document.createTextNode(label));
    staffRoleOptions.appendChild(optionLabel);
  });
  updateStaffRoleAvailability(staffRoleOptions, user.role);
  row.appendChild(roleCell);

  const participationCell = document.createElement('td');
  const participationSelect = document.createElement('select');
  participationSelect.className = 'participation-select';
  participationSelect.dataset.userId = user.user_id;
  participationSelect.add(new Option('Automatic', '', false, user.participation_override == null));
  participationSelect.add(new Option('Can participate', 'true', false, user.participation_override === true));
  participationSelect.add(new Option('Cannot participate', 'false', false, user.participation_override === false));
  participationSelect.addEventListener('change', event => {
    const value = event.target.value;
    pendingParticipationUpdates[event.target.dataset.userId] = value === '' ? null : value === 'true';
  });
  participationCell.appendChild(participationSelect);
  row.appendChild(participationCell);

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

let STAFF_ROLES = [];

function getUserRoleLabels(user) {
  const labelsById = new Map(STAFF_ROLES.map(({ id, label }) => [id, label]));
  return [
    (user.role || 'player').replace(/^./, character => character.toUpperCase()),
    ...(user.staff_roles || []).map(role => labelsById.get(role) || role)
  ];
}

function updateStaffRoleAvailability(container, primaryRole) {
  const isPlayerOrCaptain = ['player', 'captain'].includes(primaryRole);
  container.querySelectorAll('.staff-role-checkbox').forEach(checkbox => {
    const allowed = !isPlayerOrCaptain
      || STAFF_ROLES.find(role => role.id === checkbox.value)?.allowedForPlayerOrCaptain;
    checkbox.disabled = !allowed;
    if (!allowed) checkbox.checked = false;
  });
}

function queueRoleUpdate(userId, roleCell, primaryRole) {
  pendingRoleUpdates[userId] = {
    role: primaryRole || roleCell.querySelector('.role-select').value,
    staffRoles: [...roleCell.querySelectorAll('.staff-role-checkbox:checked')]
      .map(checkbox => checkbox.value)
  };
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
  const participationEntries = Object.entries(pendingParticipationUpdates);
  if (!roleEntries.length && !teamEntries.length && !participationEntries.length) {
    statusMessage.textContent = 'There are no pending changes.';
    return;
  }

  saveButton.disabled = true;
  try {
    await Promise.all(roleEntries.map(async ([userId, roleUpdate]) => {
      const response = await fetch(`${API_BASE}/admin/set-role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...roleUpdate })
      });
      if (!response.ok) throw new Error(`Could not update user ${userId}`);
      const user = users.find(item => String(item.user_id) === String(userId));
      if (user) {
        user.role = roleUpdate.role;
        user.staff_roles = roleUpdate.staffRoles;
      }
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
    await Promise.all(participationEntries.map(async ([userId, participationOverride]) => {
      const response = await fetch(`${API_BASE}/admin/set-participation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, participationOverride })
      });
      if (!response.ok) throw new Error(`Could not update participation for user ${userId}`);
      const user = users.find(item => String(item.user_id) === String(userId));
      if (user) user.participation_override = participationOverride;
      delete pendingParticipationUpdates[userId];
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
