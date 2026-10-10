function renderUserRoles(element, user) {
  const primaryRole = user.role || 'player';
  const primaryLabel = primaryRole.replace(/^./, character => character.toUpperCase());
  const staffLabels = user.staffRoles || user.staff_roles || [];
  const labels = [primaryLabel, ...staffLabels];
  const combined = ['player', 'captain'].includes(primaryRole);

  element.replaceChildren();
  element.classList.toggle('role-badges', !combined);
  if (combined) {
    element.textContent = labels.join(' \u00b7 ');
    return;
  }

  labels.forEach((label, index) => {
    const badge = document.createElement('span');
    badge.className = index === 0 ? `role-badge role-${primaryRole}` : 'role-badge';
    badge.textContent = label;
    element.appendChild(badge);
  });
}
