
    function formatUtcDateTime(isoDate) {
      if (!isoDate) return 'an unknown time';
      return `${new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        hourCycle: 'h23',
        timeZone: 'UTC'
      }).format(new Date(isoDate))} UTC+0`;
    }

    async function loadCaptainTeamAction(user) {
      const actionEl = document.getElementById('captain-team-action');
      const isTeamManager = ['captain', 'admin'].includes((user.role || '').toLowerCase());
      if (!actionEl || !isTeamManager) return;

      const createButton = document.getElementById('captain-create-team-button');
      const dialog = document.getElementById('captain-team-dialog');
      const createForm = document.getElementById('captain-team-create-form');
      const nameInput = document.getElementById('captain-team-name');
      const manageLink = document.getElementById('captain-manage-team-link');
      const messageEl = document.getElementById('captain-team-message');
      const dialogMessageEl = document.getElementById('captain-team-dialog-message');
      const closeDialogButton = document.getElementById('captain-team-dialog-close');
      actionEl.hidden = false;

      try {
        const response = await fetch('/api/captain/team', { cache: 'no-store' });
        if (!response.ok) throw new Error('Could not load captain team.');
        const data = await response.json();

        if (data.team) {
          createButton.hidden = true;
          manageLink.hidden = false;
          messageEl.replaceChildren('Managing ');
          const teamName = document.createElement('span');
          teamName.className = 'captain-team-name';
          teamName.textContent = data.team.name;
          messageEl.append(teamName, '.');
          return;
        }

        createButton.addEventListener('click', () => {
          messageEl.className = 'captain-team-message';
          dialogMessageEl.className = 'team-create-dialog-message';
          dialogMessageEl.textContent = '';
          dialog.showModal();
          nameInput.focus();
        });
        closeDialogButton.addEventListener('click', () => dialog.close());
        createForm.addEventListener('submit', async event => {
          event.preventDefault();
          const name = nameInput.value.trim();
          if (!name) return;

          const submitButton = createForm.querySelector('button[type="submit"]');
          submitButton.disabled = true;
          dialogMessageEl.className = 'team-create-dialog-message';
          dialogMessageEl.textContent = 'Creating team...';
          try {
            const createResponse = await fetch('/api/captain/team', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name })
            });
            const result = await createResponse.json().catch(() => null);
            if (!createResponse.ok) throw new Error(result?.error || 'Could not create team.');
            window.location.href = '/team.html';
          } catch (error) {
            dialogMessageEl.className = 'team-create-dialog-message is-error';
            dialogMessageEl.textContent = error.message;
          } finally {
            submitButton.disabled = false;
          }
        });
      } catch (error) {
        messageEl.textContent = error.message;
      }
    }

    async function loadDashboardUser() {
      try {
        const response = await fetch('/api/user', { cache: 'no-store' });
        if (!response.ok) {
          window.location.href = '/';
          return;
        }

        const user = await response.json();
        const username = user.username || 'Player';
        const displayRole = (user.role || 'player').charAt(0).toUpperCase() + (user.role || 'player').slice(1);

        const avatarEl = document.getElementById('dashboard-user-avatar');
        const usernameEl = document.getElementById('dashboard-username');
        const roleEl = document.getElementById('user-role');
        const adminNavLink = document.getElementById('admin-nav-link');
        const registrationLink = document.getElementById('player-registration-link');
        const registrationMessage = document.getElementById('player-registration-message');

        if (avatarEl && user.avatar_url) {
          avatarEl.src = user.avatar_url;
        }

        if (usernameEl) usernameEl.textContent = username;
        if (roleEl) roleEl.textContent = displayRole;

        const isAdmin = (user.role || '').toLowerCase() === 'admin';
        if (adminNavLink) {
          adminNavLink.hidden = !isAdmin;
        }

        loadCaptainTeamAction(user);

        if (registrationLink && registrationMessage) {
          const registrationStatus = new URLSearchParams(window.location.search).get('registration');
          const isRegisteredPlayer = Boolean(user.isRegisteredPlayer);
          const canParticipate = Boolean(user.canParticipate);
          const registrationWindow = user.registrationWindow || {};
          registrationLink.hidden = isRegisteredPlayer;
          registrationMessage.className = 'player-registration-message';

          if (isRegisteredPlayer) {
            if (canParticipate) {
              registrationMessage.classList.add('is-registered');
              registrationMessage.textContent = 'You are registered as a player.';
            } else {
              registrationMessage.classList.add('is-error');
              registrationMessage.textContent = 'You are registered as a player but cannot participate.';
            }
          } else {
            const registrationsOpen = registrationWindow.status === 'open';
            const isBwsIneligible = user.playerEligibilityStatus === 'bws-ineligible';
            registrationLink.textContent = isBwsIneligible
              ? 'Out of rank range'
              : registrationsOpen
                ? 'Register as player'
                : 'Regs not yet open';
            registrationLink.classList.toggle('is-disabled', !registrationsOpen || isBwsIneligible);
            registrationLink.setAttribute('aria-disabled', String(!registrationsOpen || isBwsIneligible));
            if (registrationsOpen && !isBwsIneligible) {
              registrationLink.href = '/auth/discord';
              registrationMessage.textContent = 'Player registration requires being member of the tournament Discord server and a BWS rank from 10,000 to 99,999.';
            } else {
              registrationLink.removeAttribute('href');
              registrationMessage.classList.add('is-window-status');
              registrationMessage.textContent = registrationWindow.status === 'upcoming'
                ? `Registrations open: ${formatUtcDateTime(registrationWindow.startAt)}.`
                : 'Registrations closed.';
            }
            if (isBwsIneligible) {
              registrationMessage.classList.add('is-error');
              registrationMessage.textContent = 'You are not registered as a player because your BWS rank is outside the 10,000 to 99,999 range.';
            } else if (registrationsOpen && registrationStatus === 'cancelled') {
              registrationMessage.classList.add('is-error');
              registrationMessage.textContent = 'Discord authorization was cancelled. Registration was not completed.';
            } else if (registrationsOpen && registrationStatus === 'discord-required') {
              registrationMessage.classList.add('is-error');
              registrationMessage.textContent = 'Join the tournament Discord server before registering as a player.';
            } else if (registrationsOpen && registrationStatus === 'bws-ineligible') {
              registrationMessage.classList.add('is-error');
              registrationMessage.textContent = 'Your BWS rank must be between 10,000 and 99,999 to register as a player.';
            } else if (registrationStatus === 'closed') {
              registrationMessage.classList.add('is-error');
              registrationMessage.textContent = 'Player registrations are closed.';
            }
          }
        }
      } catch (error) {
        console.error('Could not load dashboard user:', error);
        window.location.href = '/';
      }
    }

    function setTeamLineupStatus(text, modifierClass) {
      const statusEl = document.getElementById('team-lineup-status');
      if (!statusEl) return;

      statusEl.className = `badge ${modifierClass}`;
      statusEl.textContent = text;
    }

    function addEmptyLineupMessage(message) {
      const lineupEl = document.getElementById('team-lineup');
      if (!lineupEl) return;

      lineupEl.replaceChildren();
      const messageEl = document.createElement('p');
      messageEl.className = 'empty-lineup';
      messageEl.textContent = message;
      lineupEl.append(messageEl);
    }

    function createPlayerRow(player) {
      const playerRow = document.createElement('div');
      playerRow.className = 'team-roster-row';

      const playerMain = document.createElement('div');
      playerMain.className = 'player-main';

      const avatar = document.createElement('img');
      avatar.className = 'avatar';
      avatar.src = player.avatar_url || `https://a.ppy.sh/${player.user_id}`;
      avatar.alt = `${player.username || 'Player'} avatar`;

      const flag = document.createElement('img');
      flag.className = 'team-roster-flag';
      const countryCode = String(player.profile_country_code || '').toUpperCase();
      if (/^[A-Z]{2}$/.test(countryCode)) {
        flag.src = `https://osuflags.omkserver.nl/${countryCode}-32.png`;
        flag.alt = countryCode;
      } else {
        flag.hidden = true;
      }

      const playerDetails = document.createElement('div');
      const playerName = document.createElement('div');
      playerName.className = 'player-name';
      playerName.textContent = player.username || 'Unknown player';

      const playerRole = document.createElement('div');
      playerRole.className = 'player-role';
      playerRole.textContent = player.is_captain ? 'Captain' : (player.team_role || 'Player');

      playerDetails.append(playerName, playerRole);
      playerMain.append(avatar, flag, playerDetails);

      const playerRanks = document.createElement('div');
      playerRanks.className = 'team-roster-ranks';
      const globalRank = document.createElement('span');
      globalRank.textContent = `Global ${player.global_rank == null ? '—' : `#${Number(player.global_rank).toLocaleString('en-US')}`}`;
      const bwsRank = document.createElement('span');
      bwsRank.textContent = `BWS ${player.bws_badge_count > 0 && player.bws_rank != null ? `#${Math.round(Number(player.bws_rank)).toLocaleString('en-US')}` : '—'}`;
      playerRanks.append(globalRank, bwsRank);

      playerRow.append(playerMain, playerRanks);
      return playerRow;
    }

    async function loadTeamLineup() {
      const lineupEl = document.getElementById('team-lineup');
      const titleEl = document.getElementById('team-lineup-title');
      const playerCountEl = document.getElementById('team-player-count');
      const teamImage = document.getElementById('team-dashboard-image');
      const teamImagePlaceholder = document.getElementById('team-dashboard-image-placeholder');
      if (!lineupEl) return;

      try {
        const response = await fetch('/api/user/team');
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const data = await response.json();
        if (!data.team) {
          if (titleEl) titleEl.textContent = 'Team lineup';
          if (playerCountEl) playerCountEl.textContent = '0';
          if (teamImage) teamImage.hidden = true;
          if (teamImagePlaceholder) teamImagePlaceholder.hidden = false;
          setTeamLineupStatus('No team', 'badge-muted');
          addEmptyLineupMessage('You have not been assigned to a team yet.');
          return;
        }

        if (titleEl) titleEl.textContent = data.team.name;
        if (playerCountEl) playerCountEl.textContent = String(data.lineup.length);
        if (teamImage && teamImagePlaceholder) {
          teamImage.hidden = !data.team.imageUrl;
          teamImagePlaceholder.hidden = Boolean(data.team.imageUrl);
          if (data.team.imageUrl) teamImage.src = data.team.imageUrl;
        }
        setTeamLineupStatus(`${data.lineup.length} players`, 'badge-live');
        lineupEl.replaceChildren(...data.lineup.map(createPlayerRow));
      } catch (error) {
        console.error('Could not load team lineup:', error);
        if (playerCountEl) playerCountEl.textContent = '—';
        setTeamLineupStatus('Unavailable', 'badge-warn');
        addEmptyLineupMessage('Team lineup is unavailable right now.');
      }
    }

    function updateUtcDate() {
      const dateEl = document.getElementById('current-utc-date');
      const dateValueEl = document.getElementById('current-utc-date-value');
      const timeValueEl = document.getElementById('current-utc-time-value');
      if (!dateEl || !dateValueEl || !timeValueEl) return;

      const now = new Date();
      dateValueEl.textContent = new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC'
      }).format(now);
      timeValueEl.textContent = `${new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone: 'UTC'
      }).format(now)} UTC+0`;
    }

    loadDashboardUser();
    loadTeamLineup();
    updateUtcDate();
    setInterval(updateUtcDate, 60 * 1000);