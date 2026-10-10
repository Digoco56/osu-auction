const assert = require('node:assert/strict');
const test = require('node:test');
const { createProfileCoverLoader } = require('../profile-covers');

test('cover loader shares pending requests and caches covers per osu ID', async () => {
    let calls = 0;
    const load = createProfileCoverLoader(async () => {
        calls++;
        return { cover: { url: 'https://example.test/cover.jpg' } };
    });
    const [first, second] = await Promise.all([load(123), load('123')]);
    assert.equal(first, 'https://example.test/cover.jpg');
    assert.equal(second, first);
    assert.equal(await load(123), first);
    assert.equal(calls, 1);
});

test('missing profiles and profiles without covers return null and are cached', async () => {
    for (const fetchProfile of [
        async () => { throw Object.assign(new Error('Not found'), { response: { status: 404 } }); },
        async () => ({ cover: { url: null, custom_url: null } }),
        async () => ({})
    ]) {
        let calls = 0;
        const load = createProfileCoverLoader(async () => { calls++; return fetchProfile(); });
        assert.equal(await load(1), null);
        assert.equal(await load(1), null);
        assert.equal(calls, 1);
    }
});

test('custom covers work, stale entries expire, and the cache is bounded', async () => {
    let calls = 0;
    const load = createProfileCoverLoader(async () => {
        calls++;
        return { cover: { custom_url: 'https://example.test/custom.jpg' } };
    }, { maxEntries: 1 });
    assert.equal(await load(1), 'https://example.test/custom.jpg');
    await load(2);
    await load(1);
    assert.equal(calls, 3);
    const expired = createProfileCoverLoader(async () => { calls++; return {}; }, { ttlMs: -1 });
    await expired(3);
    await expired(3);
    assert.equal(calls, 5);
});

test('API errors are propagated rather than cached as absent covers', async () => {
    let calls = 0;
    const load = createProfileCoverLoader(async () => {
        calls++;
        if (calls === 1) throw Object.assign(new Error('Rate limited'), { response: { status: 429 } });
        return { cover: { url: 'https://example.test/cover.jpg' } };
    });
    await assert.rejects(load(1), /Rate limited/);
    assert.equal(await load(1), 'https://example.test/cover.jpg');
    assert.equal(calls, 2);
});

test('profile fetching never exceeds four concurrent osu requests', async () => {
    let active = 0;
    let peak = 0;
    const load = createProfileCoverLoader(async () => {
        active++;
        peak = Math.max(active, peak);
        await new Promise(resolve => setTimeout(resolve, 1));
        active--;
        return {};
    });
    await Promise.all(Array.from({ length: 20 }, (_, index) => load(index + 1)));
    assert.equal(peak, 4);
});
