const profileCoverRequests = new Map();

function loadProfileCover(userId) {
  const key = String(userId);
  if (!profileCoverRequests.has(key)) {
    const request = fetch(`/api/users/${encodeURIComponent(key)}/cover`)
      .then(async response => {
        if (!response.ok) throw new Error(`Profile cover request failed (${response.status}) for user ${key}.`);
        return response.json();
      });
    profileCoverRequests.set(key, request);
    request.catch(() => profileCoverRequests.delete(key));
  }
  return profileCoverRequests.get(key);
}

async function applyProfileCover(card, userId) {
  try {
    const { coverUrl } = await loadProfileCover(userId);
    if (!coverUrl) return;
    const image = document.createElement('img');
    image.className = 'profile-card-cover';
    image.alt = '';
    image.setAttribute('aria-hidden', 'true');
    image.addEventListener('load', () => {
      card.classList.add('has-profile-cover');
      card.prepend(image);
    }, { once: true });
    image.addEventListener('error', () => {
      console.error(`Could not load profile cover image for user ${userId}.`);
    }, { once: true });
    image.src = coverUrl;
  } catch (error) {
    console.error('Could not load profile cover:', error);
  }
}
