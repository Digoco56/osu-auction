const authAction = document.getElementById('auth-action');

fetch('/api/user')
  .then(async response => {
    if (!response.ok) return null;
    return response.json();
  })
  .then(user => {
    if (user) {
      window.location.replace('/dashboard.html');
      return;
    }

    authAction.hidden = false;
  })
  .catch(error => {
    console.error('Error checking session:', error);
    authAction.hidden = false;
  });
