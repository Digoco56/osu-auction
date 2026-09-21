 let pendingImageData;

    function setImagePreview(imageUrl) {
      const image = document.getElementById('team-image-preview');
      const placeholder = document.getElementById('team-image-placeholder');
      image.hidden = !imageUrl;
      placeholder.hidden = Boolean(imageUrl);
      if (imageUrl) image.src = imageUrl;
    }

    async function loadTeamSettings() {
      const teamResponse = await fetch('/api/captain/team', { cache: 'no-store' });
      if (!teamResponse.ok) {
        window.location.href = '/dashboard.html';
        return;
      }
      const data = await teamResponse.json();
      if (!data.team) {
        const status = document.getElementById('team-settings-status');
        status.className = 'team-settings-status is-error';
        status.textContent = 'No team is assigned to this captain.';
        return;
      }
      document.getElementById('team-name-input').value = data.team.name || '';
      setImagePreview(data.team.imageUrl);

      fetch('/api/user', { cache: 'no-store' })
        .then(response => response.ok ? response.json() : null)
        .then(user => {
          if (!user) return;
          document.getElementById('team-page-username').textContent = user.username || 'Captain';
          document.getElementById('team-page-role').textContent = (user.role || 'Captain')
            .replace(/^./, character => character.toUpperCase());
          if (user.avatar_url) document.getElementById('team-page-user-avatar').src = user.avatar_url;
          document.getElementById('admin-nav-link').hidden = (user.role || '').toLowerCase() !== 'admin';
        })
        .catch(error => console.error('Could not load team page user:', error));
    }

    document.getElementById('team-image-input').addEventListener('change', async event => {
      const file = event.target.files[0];
      if (!file) return;
      const status = document.getElementById('team-settings-status');
      try {
        const croppedImage = await window.openTeamImageEditor(file);
        if (croppedImage) {
          pendingImageData = croppedImage;
          setImagePreview(pendingImageData);
          status.className = 'team-settings-status';
          status.textContent = 'Image ready to save.';
        }
      } catch (error) {
        status.className = 'team-settings-status is-error';
        status.textContent = error.message;
      } finally {
        event.target.value = '';
      }
    });

    document.getElementById('clear-team-image').addEventListener('click', () => {
      if (!window.confirm('Remove the team image and restore the default image?')) return;
      pendingImageData = null;
      document.getElementById('team-image-input').value = '';
      setImagePreview(null);
    });

    document.getElementById('team-settings-form').addEventListener('submit', async event => {
      event.preventDefault();
      const status = document.getElementById('team-settings-status');
      const submitButton = event.currentTarget.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      status.className = 'team-settings-status';
      status.textContent = 'Saving changes...';
      try {
        const body = { name: document.getElementById('team-name-input').value.trim() };
        if (pendingImageData !== undefined) body.imageData = pendingImageData;
        const response = await fetch('/api/captain/team', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error || 'Could not save team.');
        pendingImageData = undefined;
        setImagePreview(result.team.imageUrl);
        status.className = 'team-settings-status is-success';
        status.textContent = 'Team saved.';
      } catch (error) {
        status.className = 'team-settings-status is-error';
        status.textContent = error.message;
      } finally {
        submitButton.disabled = false;
      }
    });

    loadTeamSettings();