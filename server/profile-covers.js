function createProfileCoverLoader(fetchProfile, { ttlMs = 6 * 60 * 60 * 1000, maxEntries = 2000 } = {}) {
    const cache = new Map();
    const pending = new Map();
    const queue = [];
    let active = 0;

    function drain() {
        while (active < 4 && queue.length) {
            const { userId, resolve, reject } = queue.shift();
            active++;
            Promise.resolve().then(() => fetchProfile(userId))
                .then(profile => profile?.cover?.url || profile?.cover?.custom_url || null)
                .catch(error => {
                    if (error.response?.status === 404) return null;
                    throw error;
                })
                .then(coverUrl => {
                    cache.delete(userId);
                    cache.set(userId, { coverUrl, expiresAt: Date.now() + ttlMs });
                    if (cache.size > maxEntries) cache.delete(cache.keys().next().value);
                    pending.delete(userId);
                    resolve(coverUrl);
                }, error => {
                    pending.delete(userId);
                    reject(error);
                })
                .finally(() => {
                    active--;
                    drain();
                });
        }
    }

    return function getProfileCover(userId) {
        const key = String(userId);
        const cached = cache.get(key);
        if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.coverUrl);
        if (pending.has(key)) return pending.get(key);
        const promise = new Promise((resolve, reject) => queue.push({ userId: key, resolve, reject }));
        pending.set(key, promise);
        drain();
        return promise;
    };
}

module.exports = { createProfileCoverLoader };
