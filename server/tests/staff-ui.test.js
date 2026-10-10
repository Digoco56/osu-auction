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
        this.classList = { toggle: (name, value) => { this[name] = value; } };
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
    const context = vm.createContext({ document });
    const client = path.join(__dirname, '..', '..', 'client');
    vm.runInContext(fs.readFileSync(path.join(client, 'js', 'role-display.js'), 'utf8'), context);
    const staffSource = fs.readFileSync(path.join(client, 'js', 'staff.js'), 'utf8');
    vm.runInContext(staffSource.replace(/\nloadStaffPage\(\);\s*$/, ''), context);
    return context;
}

test('players and captains keep one combined label in headers and cards', () => {
    const context = loadUI();
    for (const primary of ['player', 'captain']) {
        for (const property of ['staffRoles', 'staff_roles']) {
            const element = new Element();
            context.renderUserRoles(element, { role: primary, [property]: ['Streamer', 'Commentator'] });
            assert.equal(element.textContent, `${primary === 'player' ? 'Player' : 'Captain'} \u00b7 Streamer \u00b7 Commentator`);
            assert.equal(element.children.length, 0);
            assert.equal(element['role-badges'], false);
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
    assert.equal(element.textContent, 'Player');
    assert.equal(element.children.length, 0);
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
