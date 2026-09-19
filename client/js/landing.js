const authAction = document.getElementById('auth-action');
const authMessage = document.getElementById('auth-message');

const discordStatus = new URLSearchParams(window.location.search).get('discord');

if (discordStatus === 'required') {
  authMessage.textContent = 'Join the tournament Discord server before registering.';
} else if (discordStatus === 'cancelled') {
  authMessage.textContent = 'Discord authorization was cancelled. Registration was not completed.';
}

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
