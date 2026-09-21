  function createTeamCard(team) {
      const card = document.createElement('article');
      card.className = 'team-directory-card panel';
      const image = document.createElement('img');
      image.className = 'team-directory-image';
      image.hidden = !team.imageUrl;
      image.src = team.imageUrl || '';
      image.alt = `${team.name} image`;
      const placeholder = document.createElement('div');
      placeholder.className = 'team-directory-placeholder';
      placeholder.hidden = Boolean(team.imageUrl);
      placeholder.textContent = 'Team';
      const details = document.createElement('div');
      const name = document.createElement('h2'); name.textContent = team.name;
      const captain = document.createElement('p'); captain.textContent = team.captainUsername ? `Captain: ${team.captainUsername}` : 'No captain assigned';
      const count = document.createElement('button');
      count.className = 'team-member-count';
      count.type = 'button';
      count.textContent = `${team.memberCount} players`;
      const tooltip = document.createElement('span');
      tooltip.className = 'team-member-tooltip';
      tooltip.textContent = team.members.map(member => {
        const rank = member.globalRank == null ? 'Global —' : `Global #${Number(member.globalRank).toLocaleString('en-US')}`;
        return `${member.username} · ${member.role} · ${rank}`;
      }).join('\n');
      count.append(tooltip);
      details.append(name, captain, count);
      card.append(image, placeholder, details);
      return card;
    }
    async function loadTeams() {
      const [userResponse, teamsResponse] = await Promise.all([fetch('/api/user'), fetch('/api/teams')]);
      if (!userResponse.ok || !teamsResponse.ok) { window.location.href = '/'; return; }
      const [user, teams] = await Promise.all([userResponse.json(), teamsResponse.json()]);
      document.getElementById('teams-username').textContent = user.username || 'Player';
      document.getElementById('teams-role').textContent = (user.role || 'player').replace(/^./, character => character.toUpperCase());
      if (user.avatar_url) document.getElementById('teams-user-avatar').src = user.avatar_url;
      document.getElementById('admin-nav-link').hidden = (user.role || '').toLowerCase() !== 'admin';
      document.getElementById('teams-count').textContent = `${teams.length} teams`;
      const directory = document.getElementById('teams-directory');
      directory.replaceChildren(...teams.map(createTeamCard));
      if (!teams.length) {
        const empty = document.createElement('p');
        empty.className = 'empty-lineup';
        empty.textContent = 'No teams have been created yet.';
        directory.append(empty);
      }
    }
    loadTeams().catch(error => console.error('Could not load teams:', error));