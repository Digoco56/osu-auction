const API_BASE = 'https://osu-auction.onrender.com';

if (user.role === 'admin') {
  const adminBtn = document.createElement('a');
  adminBtn.href = '/admin.html';
  adminBtn.className = 'button';
  adminBtn.textContent = 'Admin Panel';
  document.body.appendChild(adminBtn);
}

fetch(`${API_BASE}/api/user`)
.then(response => {
  if (!response.ok) {
    window.location.href = '/';
  }
  return response.json();
})
.then(user => {
  const userInfoDiv = document.getElementById('user-info');
  userInfoDiv.innerHTML = `
    <p><strong>Username:</strong> ${user.username}</p>
    <p><strong>ID:</strong> ${user.id}</p>
    <img src="${user.avatar_url}" alt="Avatar">
  `;
})
.catch(error => {
  console.error('Error fetching user info:', error);
  window.location.href = '/';
});