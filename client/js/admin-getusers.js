const API_BASE = 'https://osu-auction.onrender.com';
const pendingUpdates = {};

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
        <td>${user.avatar_url ? `<img src="${user.avatar_url}" alt="Avatar">` : '—'}</td>
        <td>${user.role}</td>
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

    // Escuchar cambios y guardarlos en memoria
    document.querySelectorAll('.role-select').forEach(select => {
      select.addEventListener('change', e => {
        const userId = e.target.getAttribute('data-user-id');
        const newRole = e.target.value;
        pendingUpdates[userId] = newRole;
      });
    });
  });

// Botón guardar cambios
const saveButton = document.createElement('button');
saveButton.textContent = 'Guardar cambios';
saveButton.style.marginTop = '1rem';

saveButton.className = 'button';
saveButton.style.cssText = `
  background-color: #1b2838;
  color: #66c0f4;
  border: none;
  padding: 10px 16px;
  font-size: 1rem;
  cursor: pointer;
  border-radius: 4px;
  margin-top: 1rem;
`;

saveButton.onclick = async () => {
  const entries = Object.entries(pendingUpdates);
  for (const [userId, role] of entries) {
    await fetch(`${API_BASE}/admin/set-role`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role })
    });
  }
  alert('Cambios guardados');
  location.reload();
};

document.body.appendChild(saveButton);
