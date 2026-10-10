function createStaffSection(section) {
  const container = document.createElement('section');
  container.className = 'staff-section';
  const heading = document.createElement('h2');
  heading.id = `staff-heading-${section.id}`;
  heading.textContent = section.label;
  container.setAttribute('aria-labelledby', heading.id);
  container.appendChild(heading);

  if (!section.members.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-lineup';
    empty.textContent = 'No staff members assigned yet.';
    container.appendChild(empty);
    return container;
  }

  const members = document.createElement('ul');
  members.className = 'staff-members-grid';
  section.members.forEach(member => {
    const item = document.createElement('li');
    item.className = 'staff-member panel';
    const avatar = document.createElement('img');
    avatar.className = 'directory-avatar';
    avatar.src = member.avatar_url || `https://a.ppy.sh/${member.user_id}`;
    avatar.alt = `${member.username} avatar`;
    avatar.loading = 'lazy';
    const profile = document.createElement('a');
    profile.className = 'staff-member-name';
    profile.href = `https://osu.ppy.sh/users/${member.user_id}`;
    profile.target = '_blank';
    profile.rel = 'noopener noreferrer';
    profile.textContent = member.username;
    item.append(avatar, profile);
    applyProfileCover(item, member.user_id);
    members.appendChild(item);
  });
  container.appendChild(members);
  return container;
}

async function loadStaffPage() {
  const container = document.getElementById('staff-sections');
  try {
    const [userResponse, staffResponse] = await Promise.all([
      fetch('/api/user', { cache: 'no-store' }),
      fetch('/api/staff', { cache: 'no-store' })
    ]);
    if (userResponse.status === 401 || staffResponse.status === 401) {
      window.location.href = '/';
      return;
    }
    if (!userResponse.ok || !staffResponse.ok) {
      throw new Error('Staff members could not be loaded right now.');
    }
    const [user, data] = await Promise.all([userResponse.json(), staffResponse.json()]);
    document.getElementById('staff-username').textContent = user.username;
    renderUserRoles(document.getElementById('staff-role'), user);
    if (user.avatar_url) document.getElementById('staff-user-avatar').src = user.avatar_url;
    document.getElementById('admin-nav-link').hidden = user.role !== 'admin';
    container.replaceChildren(...data.sections.map(createStaffSection));
  } catch (error) {
    console.error('Could not load staff members:', error);
    const message = document.createElement('p');
    message.className = 'empty-lineup';
    message.textContent = 'Staff members could not be loaded right now. Please try again later.';
    container.replaceChildren(message);
  }
}

loadStaffPage();
