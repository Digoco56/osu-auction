const teamManagementGrid = document.getElementById('team-management-grid');
const unassignedPlayerList = document.getElementById('unassigned-player-list');
const teamManagementStatus = document.getElementById('team-management-status');
const newTeamNameInput = document.getElementById('new-team-name');
const createTeamButton = document.getElementById('create-team-button');
const teamViewFilter = document.getElementById('team-view-filter');
const unassignedPlayersSection = document.getElementById('unassigned-players-section');
const teamNameFilter = document.getElementById('team-name-filter');
const unassignedPlayerFilter = document.getElementById('unassigned-player-filter');

let managedTeams = [];
let unassignedPlayers = [];

function setTeamManagementStatus(message, statusClass = '') {
  teamManagementStatus.className = `status-message ${statusClass}`.trim();
  teamManagementStatus.textContent = message;
}

function createPlayerAvatar(player) {
  const avatar = document.createElement('img');
  avatar.className = 'team-management-avatar';
  avatar.src = player.avatarUrl || `https://a.ppy.sh/${player.id}`;
  avatar.alt = `${player.username} avatar`;
  return avatar;
}

function createPlayerInfo(player) {
  const playerInfo = document.createElement('div');
  playerInfo.className = 'team-member-info';
  playerInfo.classList.toggle('is-ineligible', player.canParticipate === false);
  const details = document.createElement('div');
  const name = document.createElement('span');
  name.textContent = player.username;
  const role = document.createElement('small');
  role.textContent = (player.role || 'player').replace(/^./, character => character.toUpperCase());
  details.append(name, role);
  if (player.canParticipate === false) {
    const marker = document.createElement('small');
    marker.className = 'team-participation-warning';
    marker.textContent = 'Cannot participate';
    details.append(marker);
  }
  playerInfo.append(createPlayerAvatar(player), details);
  return playerInfo;
}

function createDestinationSelect(selectedTeamId, includeUnassigned) {
  const select = document.createElement('select');
  select.className = 'team-destination-select';
  if (includeUnassigned) {
    select.add(new Option('Unassigned', '', false, !selectedTeamId));
  } else {
    select.add(new Option('Choose team', '', true, true));
  }
  managedTeams.forEach(team => {
    select.add(new Option(team.name, team.id, false, String(team.id) === String(selectedTeamId)));
  });
  return select;
}

async function requestTeamChange(url, options) {
  const response = await fetch(url, options);
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error || 'Could not update team management.');
  return result;
}

function createMemberRow(player, teamId) {
  const row = document.createElement('div');
  row.className = 'team-member-row';
  const playerInfo = createPlayerInfo(player);

  const destination = createDestinationSelect(teamId, true);
  const moveButton = document.createElement('button');
  moveButton.className = 'team-action-button';
  moveButton.type = 'button';
  moveButton.textContent = 'Move';
  const isIneligible = player.canParticipate === false;
  destination.disabled = isIneligible;
  moveButton.disabled = isIneligible;
  moveButton.addEventListener('click', async () => {
    moveButton.disabled = true;
    try {
      if (destination.value) {
        await requestTeamChange(`/admin/teams/${destination.value}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: player.id })
        });
      } else {
        await requestTeamChange(`/admin/teams/${teamId}/members/${player.id}`, { method: 'DELETE' });
      }
      setTeamManagementStatus('Player assignment updated.', 'success');
      await loadTeamManagement();
    } catch (error) {
      setTeamManagementStatus(error.message, 'error');
    } finally {
      moveButton.disabled = false;
    }
  });

  row.append(playerInfo, destination, moveButton);
  return row;
}

function createTeamCard(team) {
  const card = document.createElement('article');
  card.className = 'team-management-card';
  const header = document.createElement('div');
  header.className = 'team-management-card-header';
  let pendingImageData;
  const imageControl = document.createElement('label');
  imageControl.className = 'admin-team-image-control';
  const imagePreview = document.createElement('img');
  imagePreview.className = 'admin-team-image';
  imagePreview.alt = `${team.name} image`;
  imagePreview.src = team.imageUrl || '';
  imagePreview.hidden = !team.imageUrl;
  const imagePlaceholder = document.createElement('span');
  imagePlaceholder.className = 'admin-team-image-placeholder';
  imagePlaceholder.textContent = 'Image';
  imagePlaceholder.hidden = Boolean(team.imageUrl);
  const imageInput = document.createElement('input');
  imageInput.type = 'file';
  imageInput.accept = 'image/png,image/jpeg,image/webp';
  imageInput.hidden = true;
  imageInput.addEventListener('change', async () => {
    const file = imageInput.files[0];
    if (!file) return;
    try {
      const croppedImage = await window.openTeamImageEditor(file);
      if (croppedImage) {
        pendingImageData = croppedImage;
        imagePreview.src = croppedImage;
        imagePreview.hidden = false;
        imagePlaceholder.hidden = true;
      }
    } catch (error) {
      setTeamManagementStatus(error.message, 'error');
    } finally {
      imageInput.value = '';
    }
  });
  imageControl.append(imagePreview, imagePlaceholder, imageInput);
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 80;
  nameInput.value = team.name;

  const saveButton = document.createElement('button');
  saveButton.className = 'team-action-button';
  saveButton.type = 'button';
  saveButton.textContent = 'Save name';
  saveButton.addEventListener('click', async () => {
    saveButton.disabled = true;
    try {
      await requestTeamChange(`/admin/teams/${team.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameInput.value, ...(pendingImageData !== undefined && { imageData: pendingImageData }) })
      });
      setTeamManagementStatus('Team name saved.', 'success');
      await loadTeamManagement();
    } catch (error) {
      setTeamManagementStatus(error.message, 'error');
    } finally {
      saveButton.disabled = false;
    }
  });

  const deleteButton = document.createElement('button');
  deleteButton.className = 'team-action-button team-delete-button';
  deleteButton.type = 'button';
  deleteButton.textContent = 'Delete';
  deleteButton.addEventListener('click', async () => {
    if (!window.confirm(`Delete ${team.name}? Its players will become unassigned.`)) return;
    deleteButton.disabled = true;
    try {
      await requestTeamChange(`/admin/teams/${team.id}`, { method: 'DELETE' });
      setTeamManagementStatus('Team deleted.', 'success');
      await loadTeamManagement();
    } catch (error) {
      setTeamManagementStatus(error.message, 'error');
    } finally {
      deleteButton.disabled = false;
    }
  });

  header.append(imageControl, nameInput, saveButton, deleteButton);
  const members = document.createElement('div');
  members.className = 'team-member-list';
  if (team.members.length) {
    team.members.forEach(player => members.append(createMemberRow(player, team.id)));
  } else {
    const empty = document.createElement('p');
    empty.className = 'team-empty-state';
    empty.textContent = 'No players assigned.';
    members.append(empty);
  }
  card.append(header, members);
  return card;
}

function renderUnassignedPlayers(players) {
  unassignedPlayerList.replaceChildren();
  if (!players.length) {
    const empty = document.createElement('p');
    empty.className = 'team-empty-state';
    empty.textContent = 'No unassigned registered players.';
    unassignedPlayerList.append(empty);
    return;
  }

  players.forEach(player => {
    const row = document.createElement('div');
    row.className = 'team-member-row';
    const playerInfo = createPlayerInfo(player);

    const destination = createDestinationSelect(null, false);
    const assignButton = document.createElement('button');
    assignButton.className = 'team-action-button';
    assignButton.type = 'button';
    assignButton.textContent = 'Assign';
    const isIneligible = player.canParticipate === false;
    destination.disabled = isIneligible;
    assignButton.disabled = isIneligible;
    assignButton.addEventListener('click', async () => {
      if (!destination.value) {
        setTeamManagementStatus('Choose a team first.', 'warning');
        return;
      }
      assignButton.disabled = true;
      try {
        await requestTeamChange(`/admin/teams/${destination.value}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: player.id })
        });
        setTeamManagementStatus('Player assigned.', 'success');
        await loadTeamManagement();
      } catch (error) {
        setTeamManagementStatus(error.message, 'error');
      } finally {
        assignButton.disabled = false;
      }
    });
    row.append(playerInfo, destination, assignButton);
    unassignedPlayerList.append(row);
  });
}

async function loadTeamManagement() {
  try {
    const response = await fetch('/admin/team-management');
    if (!response.ok) throw new Error('Could not load teams.');
    const data = await response.json();
    managedTeams = data.teams;
    unassignedPlayers = data.unassignedPlayers;
    renderTeamManagement();
  } catch (error) {
    setTeamManagementStatus(error.message, 'error');
  }
}

function renderTeamManagement() {
  const view = teamViewFilter.value;
  const teamSearch = teamNameFilter.value.trim().toLowerCase();
  const playerSearch = unassignedPlayerFilter.value.trim().toLowerCase();
  const filteredTeams = teamSearch
    ? managedTeams.filter(team => team.name.toLowerCase().includes(teamSearch))
    : managedTeams;
  const filteredUnassignedPlayers = playerSearch
    ? unassignedPlayers.filter(player => player.username.toLowerCase().includes(playerSearch))
    : unassignedPlayers;

  unassignedPlayersSection.hidden = view === 'teams';
  teamManagementGrid.hidden = view === 'unassigned';
  if (view !== 'teams') renderUnassignedPlayers(filteredUnassignedPlayers);
  if (view !== 'unassigned') {
    teamManagementGrid.replaceChildren(...filteredTeams.map(createTeamCard));
  }
}

teamViewFilter.addEventListener('change', renderTeamManagement);
teamNameFilter.addEventListener('input', renderTeamManagement);
unassignedPlayerFilter.addEventListener('input', renderTeamManagement);

createTeamButton.addEventListener('click', async () => {
  const name = newTeamNameInput.value.trim();
  if (!name) {
    setTeamManagementStatus('Enter a team name.', 'warning');
    return;
  }
  createTeamButton.disabled = true;
  try {
    await requestTeamChange('/admin/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    newTeamNameInput.value = '';
    setTeamManagementStatus('Team created.', 'success');
    await loadTeamManagement();
  } catch (error) {
    setTeamManagementStatus(error.message, 'error');
  } finally {
    createTeamButton.disabled = false;
  }
});

loadTeamManagement();