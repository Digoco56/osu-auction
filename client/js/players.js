function formatRank(rank) {
      if (rank == null || Number.isNaN(Number(rank))) return 'Unavailable';
      return `#${Math.round(Number(rank)).toLocaleString('en-US')}`;
    }

    function countryFlagUrl(countryCode) {
      const normalizedCode = String(countryCode || '').toUpperCase();
      return /^[A-Z]{2}$/.test(normalizedCode)
        ? `https://osuflags.omkserver.nl/${normalizedCode}-32.png`
        : '';
    }

    function createPlayerMetaItem(label, value) {
      const item = document.createElement('div');
      item.className = 'player-meta-item';
      const itemLabel = document.createElement('span');
      itemLabel.className = 'player-meta-label';
      itemLabel.textContent = label;
      const itemValue = document.createElement('span');
      itemValue.className = 'player-meta-value';
      itemValue.textContent = value;
      item.append(itemLabel, itemValue);
      return item;
    }

    function createPlayerCard(player) {
      const card = document.createElement('article');
      card.className = 'player-directory-card panel';
      const isIneligible = !player.can_participate;
      card.classList.toggle('is-ineligible', isIneligible);

      const avatar = document.createElement('img');
      avatar.className = 'directory-avatar';
      avatar.src = player.avatar_url || `https://a.ppy.sh/${player.user_id}`;
      avatar.alt = `${player.username} avatar`;

      const details = document.createElement('div');
      const nameRow = document.createElement('div');
      nameRow.className = 'player-name-row';
      const flagUrl = countryFlagUrl(player.profile_country_code);
      if (flagUrl) {
        const flag = document.createElement('img');
        flag.className = 'country-flag';
        flag.src = flagUrl;
        flag.alt = player.profile_country_code;
        nameRow.append(flag);
      }
      const name = document.createElement('h2');
      name.textContent = player.username;
      nameRow.append(name);
      if (isIneligible) {
        const ineligibleMarker = document.createElement('span');
        ineligibleMarker.className = 'player-ineligible-marker';
        ineligibleMarker.textContent = 'Cannot participate';
        nameRow.append(ineligibleMarker);
      }
      const role = document.createElement('p');
      role.className = `player-directory-role role-${String(player.role || 'player').toLowerCase()}`;
      role.textContent = player.role;
      const team = document.createElement('p');
      team.className = `player-directory-team${player.team_name ? '' : ' is-unassigned'}`;
      team.textContent = player.team_name || 'No team';

      const metadata = document.createElement('div');
      metadata.className = 'player-meta';
      const globalRank = createPlayerMetaItem('Global rank', formatRank(player.global_rank));
      globalRank.classList.add('player-meta-global-rank');
      const badgeCount = createPlayerMetaItem('Badges', player.bws_badge_count ?? 'Unavailable');
      metadata.append(
        globalRank,
        badgeCount
      );
      if (Number(player.bws_badge_count) > 0) {
        const bwsRank = createPlayerMetaItem('Post-BWS rank', formatRank(player.bws_rank));
        bwsRank.classList.add('player-meta-bws-rank');
        metadata.append(bwsRank);
      } else {
        const reservedSlot = document.createElement('div');
        reservedSlot.className = 'player-meta-item player-meta-placeholder';
        reservedSlot.setAttribute('aria-hidden', 'true');
        metadata.append(reservedSlot);
      }

      details.append(nameRow, role, team, metadata);
      card.append(avatar, details);
      return card;
    }

    function sortPlayers(players, sortOrder) {
      const compareNames = (first, second) => String(first.username || '').localeCompare(
        String(second.username || ''),
        undefined,
        { sensitivity: 'base' }
      );
      const compareNumbers = (first, second, property) => {
        const firstValue = property === 'registered_at' ? Date.parse(first[property]) : Number(first[property]);
        const secondValue = property === 'registered_at' ? Date.parse(second[property]) : Number(second[property]);
        const firstIsValid = Number.isFinite(firstValue);
        const secondIsValid = Number.isFinite(secondValue);
        if (!firstIsValid && !secondIsValid) return 0;
        if (!firstIsValid) return 1;
        if (!secondIsValid) return -1;
        return firstValue - secondValue;
      };

      return [...players].sort((first, second) => {
        let comparison;
        switch (sortOrder) {
          case 'name-asc': comparison = compareNames(first, second); break;
          case 'name-desc': comparison = -compareNames(first, second); break;
          case 'registered-asc': comparison = compareNumbers(first, second, 'registered_at'); break;
          case 'registered-desc': comparison = -compareNumbers(first, second, 'registered_at'); break;
          case 'rank-asc': comparison = compareNumbers(first, second, 'global_rank'); break;
          case 'rank-desc':
          default: comparison = -compareNumbers(first, second, 'global_rank'); break;
        }
        return comparison || compareNames(first, second);
      });
    }

    async function loadPlayersPage() {
      const directory = document.getElementById('players-directory');
      const count = document.getElementById('players-count');
      const sortControl = document.getElementById('players-sort');

      try {
        const [userResponse, playersResponse] = await Promise.all([
          fetch('/api/user'),
          fetch('/api/players')
        ]);
        if (!userResponse.ok || !playersResponse.ok) {
          window.location.href = '/';
          return;
        }

        const [user, players] = await Promise.all([
          userResponse.json(),
          playersResponse.json()
        ]);
        document.getElementById('dashboard-username').textContent = user.username || 'Player';
        document.getElementById('user-role').textContent = (user.role || 'player')
          .replace(/^./, character => character.toUpperCase());
        if (user.avatar_url) document.getElementById('dashboard-user-avatar').src = user.avatar_url;
        document.getElementById('admin-nav-link').hidden = (user.role || '').toLowerCase() !== 'admin';

        const eligiblePlayers = players.filter(player => player.can_participate);
        count.textContent = `${eligiblePlayers.length} registered`;
        const renderPlayers = () => {
          directory.replaceChildren(...sortPlayers(players, sortControl.value).map(createPlayerCard));
        };
        renderPlayers();
        sortControl.addEventListener('change', renderPlayers);
        if (players.length === 0) {
          const empty = document.createElement('p');
          empty.className = 'empty-lineup';
          empty.textContent = 'No players have registered yet.';
          directory.append(empty);
        }
      } catch (error) {
        console.error('Could not load players:', error);
        count.textContent = 'Unavailable';
        directory.replaceChildren();
        const errorMessage = document.createElement('p');
        errorMessage.className = 'empty-lineup';
        errorMessage.textContent = 'Players could not be loaded right now.';
        directory.append(errorMessage);
      }
    }

    loadPlayersPage();