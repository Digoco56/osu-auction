const STAFF_ROLES = [
    { id: 'host', label: 'Host' },
    { id: 'mapper', label: 'Mapper' },
    { id: 'gfx', label: 'GFX' },
    { id: 'sheeter', label: 'Sheeter' },
    { id: 'custom_song', label: 'Custom Song', directoryLabel: 'Musician (Custom Song)' },
    { id: 'pooler', label: 'Pooler' },
    { id: 'playtester', label: 'Playtester' },
    { id: 'referee', label: 'Referee' },
    { id: 'streamer', label: 'Streamer', allowedForPlayerOrCaptain: true },
    { id: 'commentator', label: 'Commentator', allowedForPlayerOrCaptain: true }
];

function getStaffRoleLabels(staffRoleIds = []) {
    const selectedRoles = new Set(staffRoleIds);
    return STAFF_ROLES.filter(role => selectedRoles.has(role.id)).map(role => role.label);
}

function formatRoleLabels(role, staffRoleIds = []) {
    const primaryRole = String(role || 'player');
    const primaryRoleLabel = primaryRole.replace(/^./, character => character.toUpperCase());
    return [primaryRoleLabel, ...getStaffRoleLabels(staffRoleIds)].join(' \u00b7 ');
}

function normalizeStaffRoles(staffRoles, primaryRole) {
    if (!Array.isArray(staffRoles)) return null;
    const selectedRoles = new Set(staffRoles);
    if (selectedRoles.size !== staffRoles.length
        || staffRoles.some(role => typeof role !== 'string' || !STAFF_ROLES.some(item => item.id === role))) {
        return null;
    }
    if (['player', 'captain'].includes(primaryRole)
        && staffRoles.some(role => !STAFF_ROLES.find(item => item.id === role).allowedForPlayerOrCaptain)) {
        return null;
    }
    return STAFF_ROLES.filter(role => selectedRoles.has(role.id)).map(role => role.id);
}

function buildStaffSections(users) {
    // Keep Admin after Host; additional staff roles follow the catalog order.
    const directoryRoles = [STAFF_ROLES[0], { id: 'admin', label: 'Admin' }, ...STAFF_ROLES.slice(1)];
    return directoryRoles.map(role => ({
        id: role.id,
        label: role.directoryLabel || role.label,
        members: users.filter(user => role.id === 'admin'
            ? user.role === 'admin'
            : (user.staff_roles || []).includes(role.id)
        ).map(user => ({
            user_id: user.user_id,
            username: user.username,
            avatar_url: user.avatar_url,
            profile_country_code: user.profile_country_code
        }))
    }));
}

module.exports = { STAFF_ROLES, getStaffRoleLabels, formatRoleLabels, normalizeStaffRoles, buildStaffSections };
