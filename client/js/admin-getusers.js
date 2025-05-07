const API_BASE = 'https://osu-auction.onrender.com';

fetch(`${API_BASE}/admin/logged-users`)
  .then(response => {
    if (!response.ok) {
      window.location.href = '/';
    }
    return response.json();
  })
  .then(users => {
    const table = document.getElementById('user-table');
    users.forEach(user => {
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td>${user.user_id}</td>
        <td>${user.username}</td>
        <td><img src="${user.avatar_url}" alt="Avatar"></td>
        <td>${user.role || 'player'}</td>
        <td>
          <select data-user-id="${user.user_id}" class="role-select">
            <option value="player" ${user.role === 'player' ? 'selected' : ''}>Player</option>
            <option value="captain" ${user.role === 'captain' ? 'selected' : ''}>Captain</option>
            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
          </select>
        </td>
      `;
      table.appendChild(tr);
    });

    document.querySelectorAll('.role-select').forEach(select => {
      select.addEventListener('change', async (e) => {
        const userId = e.target.getAttribute('data-user-id');
        const newRole = e.target.value;

        await fetch(`${API_BASE}/admin/set-role`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ userId, role: newRole })
        });

        alert(`Role updated to "${newRole}"`);
      });
    });
  });