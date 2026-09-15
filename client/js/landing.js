const authAction = document.getElementById('auth-action');

fetch('/api/user')
  .then(async response => {
    if (!response.ok) return null;
    return response.json();
  })
  .then(user => {
    if (!user) return;

    authAction.replaceChildren();

    const dashboardLink = document.createElement('a');
    dashboardLink.className = 'button';
    dashboardLink.href = '/dashboard.html';
    dashboardLink.textContent = 'Go to dashboard';
    authAction.appendChild(dashboardLink);
  })
  .catch(error => {
    console.error('Error checking session:', error);
  });
