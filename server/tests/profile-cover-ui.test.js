const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createUI(fetch) {
    const images = [];
    const errors = [];
    const context = vm.createContext({
        fetch,
        console: { error: (...args) => errors.push(args) },
        document: {
            createElement() {
                const image = {
                    events: {},
                    setAttribute() {},
                    addEventListener(name, listener) { this.events[name] = listener; }
                };
                images.push(image);
                return image;
            }
        }
    });
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'client', 'js', 'profile-cover.js'), 'utf8');
    vm.runInContext(source, context);
    const card = () => ({
        children: [],
        classList: { add(name) { this[name] = true; } },
        prepend(image) { this.children.unshift(image); }
    });
    return { context, images, errors, card };
}

test('cover images attach only after loading and repeated staff cards share a request', async () => {
    let calls = 0;
    const ui = createUI(async () => {
        calls++;
        return { ok: true, json: async () => ({ coverUrl: 'https://example.test/cover.jpg' }) };
    });
    const first = ui.card();
    const second = ui.card();
    await Promise.all([ui.context.applyProfileCover(first, 1), ui.context.applyProfileCover(second, 1)]);
    assert.equal(calls, 1);
    assert.equal(first.children.length, 0);
    ui.images[0].events.load();
    ui.images[1].events.load();
    assert.equal(first.classList['has-profile-cover'], true);
    assert.equal(second.classList['has-profile-cover'], true);
    assert.equal(first.children[0].src, 'https://example.test/cover.jpg');
});

test('no cover leaves the existing card entirely unchanged', async () => {
    const ui = createUI(async () => ({ ok: true, json: async () => ({ coverUrl: null }) }));
    const card = ui.card();
    await ui.context.applyProfileCover(card, 1);
    assert.equal(ui.images.length, 0);
    assert.equal(card.children.length, 0);
    assert.equal(card.classList['has-profile-cover'], undefined);
});

test('image failures leave the existing background and report an error', async () => {
    const ui = createUI(async () => ({ ok: true, json: async () => ({ coverUrl: 'https://example.test/broken.jpg' }) }));
    const card = ui.card();
    await ui.context.applyProfileCover(card, 1);
    ui.images[0].events.error();
    assert.equal(card.children.length, 0);
    assert.equal(card.classList['has-profile-cover'], undefined);
    assert.equal(ui.errors.length, 1);
});

test('request failures report errors and can be retried', async () => {
    let calls = 0;
    const ui = createUI(async () => {
        calls++;
        return calls === 1
            ? { ok: false, status: 502 }
            : { ok: true, json: async () => ({ coverUrl: null }) };
    });
    const card = ui.card();
    await ui.context.applyProfileCover(card, 1);
    await ui.context.applyProfileCover(card, 1);
    assert.equal(calls, 2);
    assert.equal(ui.errors.length, 1);
    assert.equal(card.children.length, 0);
});
