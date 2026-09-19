const registrationStartInput = document.getElementById('registration-start-at');
const registrationEndInput = document.getElementById('registration-end-at');
const registrationSaveButton = document.getElementById('save-registration-window-button');
const refreshPlayerEligibilityButton = document.getElementById('refresh-player-eligibility-button');
const registrationStatusMessage = document.getElementById('registration-window-status');
const nextUpdateMessage = document.getElementById('registration-next-update');

function toLocalDateTimeInputValue(isoDate) {
  if (!isoDate) return '';
  return new Date(isoDate).toISOString().slice(0, 16);
}

function setRegistrationStatus(message, statusClass = '') {
  registrationStatusMessage.className = `status-message ${statusClass}`.trim();
  registrationStatusMessage.textContent = message;
}

function setNextUpdateMessage(nextUpdateAt) {
  if (!nextUpdateAt) {
    nextUpdateMessage.textContent = 'Player data updates are paused while registrations are closed.';
    return;
  }

  const formattedDate = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC'
  }).format(new Date(nextUpdateAt));
  nextUpdateMessage.textContent = `Next player data update: ${formattedDate} UTC+0`;
}

async function loadRegistrationWindow() {
  try {
    const response = await fetch('/admin/registration-window');
    if (!response.ok) throw new Error('Could not load registration window.');

    const window = await response.json();
    registrationStartInput.value = toLocalDateTimeInputValue(window.startAt);
    registrationEndInput.value = toLocalDateTimeInputValue(window.endAt);
    setNextUpdateMessage(window.nextPlayerEligibilityRefreshAt);
    setRegistrationStatus(
      window.isOpen ? 'Registrations are currently open.' : 'Registrations are currently closed.',
      window.isOpen ? 'success' : 'warning'
    );
  } catch (error) {
    console.error('Error loading registration window:', error);
    setRegistrationStatus(error.message, 'error');
  }
}

registrationSaveButton.addEventListener('click', async () => {
  if (!registrationStartInput.value || !registrationEndInput.value) {
    setRegistrationStatus('Both opening and closing times are required.', 'error');
    return;
  }

  registrationSaveButton.disabled = true;
  setRegistrationStatus('Saving registration window', 'updating');
  try {
    const response = await fetch('/admin/registration-window', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startAt: new Date(`${registrationStartInput.value}Z`).toISOString(),
        endAt: new Date(`${registrationEndInput.value}Z`).toISOString()
      })
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || 'Could not save registration window.');

    registrationStartInput.value = toLocalDateTimeInputValue(result.startAt);
    registrationEndInput.value = toLocalDateTimeInputValue(result.endAt);
    setNextUpdateMessage(result.nextPlayerEligibilityRefreshAt);
    setRegistrationStatus(result.isOpen ? 'Registrations are currently open.' : 'Registration window saved.', 'success');
  } catch (error) {
    console.error('Error saving registration window:', error);
    setRegistrationStatus(error.message, 'error');
  } finally {
    registrationSaveButton.disabled = false;
  }
});

refreshPlayerEligibilityButton.addEventListener('click', async () => {
  refreshPlayerEligibilityButton.disabled = true;
  setRegistrationStatus('Refreshing player data from osu!', 'updating');
  try {
    const response = await fetch('/admin/refresh-player-eligibility', { method: 'POST' });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || 'Could not refresh player data.');

    setRegistrationStatus('Player data refreshed.', 'success');
    await loadRegistrationWindow();
  } catch (error) {
    console.error('Error refreshing player data:', error);
    setRegistrationStatus(error.message, 'error');
  } finally {
    refreshPlayerEligibilityButton.disabled = false;
  }
});

loadRegistrationWindow();