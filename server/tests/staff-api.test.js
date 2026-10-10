const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function loadStaffRoute(query, routePath = '/api/staff', coverLoader) {
    const root = path.join(__dirname, '..');
    const serverRequire = createRequire(path.join(root, 'server.js'));
    const errors = [];
    const context = vm.createContext({
        __dirname: root,
        process: { env: { SESSION_SECRET: 'test-only-secret' } },
        console: { error: (...args) => errors.push(args) },
        require: id => {
            if (id === './db') return { query };
            if (id === 'dotenv') return { config() {} };
            if (id === './profile-covers' && coverLoader) {
                return { createProfileCoverLoader: () => coverLoader };
            }
            return serverRequire(id);
        }
    });
    const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    vm.runInContext(`${source.slice(0, source.indexOf('// Start the server'))}\nglobalThis.testApp = app;`, context);
    const route = context.testApp.router.stack.find(layer => layer.route?.path === routePath);
    assert.ok(route, 'Staff API route must exist');
    return { handle: route.route.stack[0].handle, errors };
}

function createResponse() {
    return {
        statusCode: 200,
        headers: {},
        status(code) { this.statusCode = code; return this; },
        set(name, value) { this.headers[name] = value; return this; },
        json(body) { this.body = body; return this; }
    };
}

test('staff API requires login without querying the database', async () => {
    const { handle } = loadStaffRoute(() => assert.fail('Unauthenticated requests must not query'));
    const response = createResponse();
    await handle({ session: {} }, response);
    assert.equal(response.statusCode, 401);
    assert.equal(response.body.error, 'Not authenticated');
});

test('cover API validates login, user IDs and local user existence before fetching osu', async () => {
    let queries = 0;
    const { handle } = loadStaffRoute(async () => {
        queries++;
        return { rowCount: 0 };
    }, '/api/users/:userId/cover', () => assert.fail('Unknown users must not fetch osu'));
    for (const [request, status] of [
        [{ session: {}, params: { userId: '1' } }, 401],
        [{ session: { user: {} }, params: { userId: 'invalid' } }, 400],
        [{ session: { user: {} }, params: { userId: '1' } }, 404]
    ]) {
        const response = createResponse();
        await handle(request, response);
        assert.equal(response.statusCode, status);
    }
    assert.equal(queries, 1);
});

test('cover API returns a cover or null for an absent osu profile', async () => {
    for (const coverUrl of [null, 'https://example.test/cover.jpg']) {
        const { handle } = loadStaffRoute(async () => ({ rowCount: 1 }),
            '/api/users/:userId/cover', async userId => {
                assert.equal(userId, 123);
                return coverUrl;
            });
        const response = createResponse();
        await handle({ session: { user: {} }, params: { userId: '123' } }, response);
        assert.equal(response.statusCode, 200);
        assert.equal(response.body.coverUrl, coverUrl);
    }
});

test('cover API logs upstream errors and returns 502 instead of a missing-cover success', async () => {
    const { handle, errors } = loadStaffRoute(async () => ({ rowCount: 1 }),
        '/api/users/:userId/cover', async () => { throw new Error('osu unavailable'); });
    const response = createResponse();
    await handle({ session: { user: {} }, params: { userId: '123' } }, response);
    assert.equal(response.statusCode, 502);
    assert.equal(errors.length, 1);
});

test('staff API returns grouped public profile data including unregistered staff', async () => {
    const { handle } = loadStaffRoute(async sql => {
        assert.match(sql, /role = 'admin' OR cardinality\(staff_roles\) > 0/);
        assert.doesNotMatch(sql, /is_registered_player|discord_id/);
        assert.match(sql, /ORDER BY LOWER\(username\), user_id/);
        return { rows: [{
            user_id: '5', username: 'Manual account', role: 'admin',
            staff_roles: ['host', 'mapper'], avatar_url: null, profile_country_code: 'ES'
        }] };
    });
    const response = createResponse();
    await handle({ session: { user: { id: '5' } } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.equal(response.body.sections.length, 11);
    for (const role of ['host', 'admin', 'mapper']) {
        assert.equal(response.body.sections.find(section => section.id === role).members[0].username, 'Manual account');
    }
});

test('staff API logs database errors and returns an explicit failure', async () => {
    const { handle, errors } = loadStaffRoute(async () => { throw new Error('Database unavailable'); });
    const response = createResponse();
    await handle({ session: { user: { id: '5' } } }, response);
    assert.equal(response.statusCode, 500);
    assert.match(response.body.error, /could not be loaded/);
    assert.equal(errors.length, 1);
    assert.equal(errors[0][1], 'Database unavailable');
});
