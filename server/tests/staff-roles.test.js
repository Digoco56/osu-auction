const assert = require('node:assert/strict');
const test = require('node:test');
const { STAFF_ROLES, buildStaffSections, normalizeStaffRoles, formatRoleLabels } = require('../staff-roles');

test('staff directory follows the requested order and keeps empty sections', () => {
    const sections = buildStaffSections([]);
    assert.deepEqual(sections.map(section => section.label), [
        'Host', 'Admin', 'Mapper', 'GFX', 'Sheeter', 'Musician (Custom Song)',
        'Pooler', 'Playtester', 'Referee', 'Streamer', 'Commentator'
    ]);
    assert.ok(sections.every(section => section.members.length === 0));
});

test('staff appear in every assigned role, regardless of player registration', () => {
    const users = [
        { user_id: '1', username: 'Admin', role: 'admin', staff_roles: ['host', 'custom_song'], discord_id: 'private' },
        { user_id: '2', username: 'Captain', role: 'captain', staff_roles: ['streamer', 'commentator'] },
        { user_id: '3', username: 'Manual staff', role: 'staff', staff_roles: ['mapper', 'referee'] },
        { user_id: '4', username: 'Player', role: 'player', staff_roles: [] }
    ];
    const sections = buildStaffSections(users);
    const members = id => sections.find(section => section.id === id).members;
    assert.equal(members('host')[0].user_id, '1');
    assert.equal(members('admin')[0].user_id, '1');
    assert.equal(members('custom_song')[0].user_id, '1');
    assert.equal(members('streamer')[0].user_id, '2');
    assert.equal(members('commentator')[0].user_id, '2');
    assert.equal(members('mapper')[0].user_id, '3');
    assert.equal(members('referee')[0].user_id, '3');
    assert.ok(sections.every(section => section.members.every(member => member.user_id !== '4')));
    assert.deepEqual(Object.keys(members('admin')[0]), [
        'user_id', 'username', 'avatar_url', 'profile_country_code'
    ]);
});

test('every staff combination obeys player and captain restrictions', () => {
    const ids = STAFF_ROLES.map(role => role.id);
    for (let mask = 0; mask < 2 ** ids.length; mask++) {
        const selected = ids.filter((id, index) => mask & (1 << index));
        const allowed = selected.every(id => ['streamer', 'commentator'].includes(id));
        for (const primary of ['player', 'captain']) {
            assert.deepEqual(normalizeStaffRoles(selected, primary), allowed ? selected : null);
        }
        assert.deepEqual(normalizeStaffRoles(selected, 'admin'), selected);
    }
});

test('invalid staff assignments are rejected and role text remains compatible', () => {
    for (const invalid of [null, undefined, 'host', ['unknown'], ['host', 'host'], [1]]) {
        assert.equal(normalizeStaffRoles(invalid, 'admin'), null);
    }
    assert.equal(formatRoleLabels('captain', ['streamer', 'commentator']), 'Captain \u00b7 Streamer \u00b7 Commentator');
});
