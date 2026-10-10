const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class Element {
    constructor(tagName = 'div') {
        this.tagName = tagName;
        this.children = [];
        this.textContent = '';
        this.classList = {
            toggle: (name, value) => { this[name] = value; },
            contains: name => (this.className || '').split(/\s+/).includes(name)
        };
    }
    replaceChildren(...children) {
        this.textContent = '';
        this.children = children;
    }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); }
    setAttribute(name, value) { this[name] = value; }
}

function loadUI() {
    const document = { createElement: tagName => new Element(tagName) };
    const context = vm.createContext({ document, applyProfileCover() {} });
    const client = path.join(__dirname, '..', '..', 'client');
    vm.runInContext(fs.readFileSync(path.join(client, 'js', 'role-display.js'), 'utf8'), context);
    const staffSource = fs.readFileSync(path.join(client, 'js', 'staff.js'), 'utf8');
    vm.runInContext(staffSource.replace(/\nloadStaffPage\(\);\s*$/, ''), context);
    return context;
}

test('players and captains keep one combined label in directory cards', () => {
    const context = loadUI();
    for (const primary of ['player', 'captain']) {
        for (const property of ['staffRoles', 'staff_roles']) {
            const element = new Element();
            element.className = 'player-directory-role';
            context.renderUserRoles(element, { role: primary, [property]: ['Streamer', 'Commentator'] });
            assert.equal(element.textContent, `${primary === 'player' ? 'Player' : 'Captain'} \u00b7 Streamer \u00b7 Commentator`);
            assert.equal(element.children.length, 0);
            assert.equal(element['role-badges'], false);
        }
    }
});

test('players and captains display separate badges in the account header', () => {
    const context = loadUI();
    for (const primary of ['player', 'captain']) {
        for (const staffRoles of [[], ['Streamer'], ['Commentator'], ['Streamer', 'Commentator']]) {
            const element = new Element('span');
            element.className = 'user-role';
            context.renderUserRoles(element, { role: primary, staffRoles });
            assert.equal(element['role-badges'], true);
            assert.deepEqual(element.children.map(child => child.textContent), [
                primary === 'player' ? 'Player' : 'Captain', ...staffRoles
            ]);
            assert.equal(element.children[0].className, `role-badge role-${primary}`);
        }
    }
});

test('other roles get separate badges and replacing roles clears the old display', () => {
    const context = loadUI();
    const element = new Element();
    context.renderUserRoles(element, { role: 'admin', staffRoles: ['Host', 'Mapper', 'GFX'] });
    assert.equal(element['role-badges'], true);
    assert.deepEqual(element.children.map(child => child.textContent), ['Admin', 'Host', 'Mapper', 'GFX']);
    assert.equal(element.children[0].className, 'role-badge role-admin');
    context.renderUserRoles(element, { role: 'player', staffRoles: [] });
    assert.equal(element.children.length, 1);
    assert.equal(element.children[0].textContent, 'Player');
    assert.equal(element['role-badges'], true);
});

test('staff sections render large headings and every member beneath their role', () => {
    const context = loadUI();
    const member = { user_id: '123', username: 'Staff member', avatar_url: null };
    const section = context.createStaffSection({ id: 'host', label: 'Host', members: [member] });
    assert.equal(section.children[0].tagName, 'h2');
    assert.equal(section.children[0].textContent, 'Host');
    const list = section.children[1];
    assert.equal(list.tagName, 'ul');
    assert.equal(list.children.length, 1);
    assert.equal(list.children[0].children[0].src, 'https://a.ppy.sh/123');
    assert.equal(list.children[0].children[1].textContent, 'Staff member');
    assert.equal(list.children[0].children[1].href, 'https://osu.ppy.sh/users/123');
    const empty = context.createStaffSection({ id: 'gfx', label: 'GFX', members: [] });
    assert.equal(empty.children[1].textContent, 'No staff members assigned yet.');
});

test('all tournament pages place Staff Members between Mappool and Rules and load shared role rendering first', () => {
    const client = path.join(__dirname, '..', '..', 'client');
    for (const page of ['dashboard', 'players', 'teams', 'team', 'mappool', 'staff']) {
        const source = fs.readFileSync(path.join(client, `${page}.html`), 'utf8');
        const mappool = source.indexOf('href="/mappool.html"');
        const staff = source.indexOf('href="/staff.html"');
        const rules = source.indexOf('>Rules</a>');
        assert.ok(mappool < staff && staff < rules, page);
        const scripts = [...source.matchAll(/<script src="([^"]+)"/g)].map(match => match[1]);
        assert.ok(scripts[0].endsWith('role-display.js'), page);
    }
});

test('dashboard lineup requests the matching player cover while preserving player details', () => {
    const client = path.join(__dirname, '..', '..', 'client');
    const source = fs.readFileSync(path.join(client, 'js', 'dashboard.js'), 'utf8');
    const start = source.indexOf('    function createPlayerRow(player)');
    const end = source.indexOf('    async function loadTeamLineup()', start);
    const requests = [];
    const context = vm.createContext({
        document: { createElement: tag => new Element(tag) },
        applyProfileCover: (element, userId) => requests.push({ element, userId })
    });

    vm.runInContext(source.slice(start, end), context);
    const row = context.createPlayerRow({
        user_id: '123', username: 'Captain', is_captain: true,
        profile_country_code: 'ES', global_rank: 12345, bws_badge_count: 0
    });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].element, row);
    assert.equal(requests[0].userId, '123');
    assert.equal(row.className, 'team-roster-row');
    assert.equal(row.children.length, 2);
    assert.equal(row.children[0].children[2].children[0].textContent, 'Captain');
    assert.equal(row.children[1].children[0].textContent, 'Global #12,345');
    const html = fs.readFileSync(path.join(client, 'dashboard.html'), 'utf8');
    assert.ok(html.indexOf('/js/profile-cover.js') < html.indexOf('/js/dashboard.js'));
    const css = fs.readFileSync(path.join(client, 'css', 'homepage.css'), 'utf8');
    assert.match(css, /\.team-roster-row\.has-profile-cover\s*\{/);
});

test('each tournament page highlights only its current navigation section', () => {
    const client = path.join(__dirname, '..', '..', 'client');
    const pages = { dashboard: 'dashboard', players: 'players', teams: 'teams', team: 'teams', mappool: 'mappool', staff: 'staff' };
    for (const [page, section] of Object.entries(pages)) {
        const source = fs.readFileSync(path.join(client, `${page}.html`), 'utf8');
        const navigation = source.match(/<nav>([\s\S]*?)<\/nav>/)[1];
        const active = [...navigation.matchAll(/<a href="([^"]+)" aria-current="([^"]+)"/g)];
        assert.equal(active.length, 1, page);
        assert.equal(active[0][1], `/${section}.html`, page);
        assert.equal(active[0][2], page === 'team' ? 'location' : 'page', page);
    }
});

test('Teams member tooltip shows names and global ranks without roles', () => {
    const client = path.join(__dirname, '..', '..', 'client');
    const source = fs.readFileSync(path.join(client, 'js', 'teams.js'), 'utf8');
    const context = vm.createContext({
        document: { createElement: tag => new Element(tag) }
    });
    vm.runInContext(source.slice(0, source.indexOf('    async function loadTeams()')), context);
    const card = context.createTeamCard({
        name: 'Team A', memberCount: 2, captainUsername: 'Captain',
        members: [
            { username: 'Captain', role: 'captain', roleLabel: 'Captain · Streamer', globalRank: 12345 },
            { username: 'Member', role: 'admin', roleLabel: 'Admin · Host', globalRank: null }
        ]
    });
    const details = card.children[2];
    assert.equal(details.children[1].textContent, 'Captain: Captain');
    assert.equal(details.children[2].children[0].textContent, 'Captain · Global #12,345\nMember · Global —');
});
