require('dotenv').config();
const express = require('express');
const axios = require('axios');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const mappoolCache = new Map();
const osuBeatmapCache = new Map();
const MAPPOOL_CACHE_TTL_MS = 60 * 1000;
const GOOGLE_SHEET_ATTEMPTS = 3;
const AA_COLUMN_INDEX = 26;
const AB_COLUMN_INDEX = 27;
const AC_COLUMN_INDEX = 28;
const BWS_BADGE_CUTOFF = new Date('2025-04-01T00:00:00Z');
const BWS_MIN_RANK = 10000;
const BWS_MAX_RANK = 99999;
const BWS_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REGISTRATION_START_AT_SEED = process.env.REGISTRATION_START_AT || null;
const REGISTRATION_END_AT_SEED = process.env.REGISTRATION_END_AT || null;
let osuApiToken = null;
let osuApiTokenExpiresAt = 0;
let playerEligibilityRefreshInProgress = false;
let nextPlayerEligibilityRefreshAt = null;

async function initializeDatabase() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS users (
            user_id BIGINT PRIMARY KEY,
            username TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'player',
            avatar_url TEXT,
            discord_id TEXT,
            discord_username TEXT,
            is_registered_player BOOLEAN NOT NULL DEFAULT FALSE,
            registered_at TIMESTAMPTZ,
            bws_rank NUMERIC,
            global_rank INTEGER,
            bws_badge_count INTEGER,
            bws_calculated_at TIMESTAMPTZ,
            profile_country_code TEXT,
            player_eligibility_status TEXT NOT NULL DEFAULT 'not_registered'
        );
        ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_id TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_username TEXT;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS is_registered_player BOOLEAN NOT NULL DEFAULT FALSE;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS bws_rank NUMERIC;
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'users' AND column_name = 'bws_global_rank'
            ) AND NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'users' AND column_name = 'global_rank'
            ) THEN
                ALTER TABLE users RENAME COLUMN bws_global_rank TO global_rank;
            END IF;
        END $$;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS global_rank INTEGER;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS bws_badge_count INTEGER;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS bws_calculated_at TIMESTAMPTZ;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_country_code TEXT;
                ALTER TABLE users ADD COLUMN IF NOT EXISTS player_eligibility_status TEXT NOT NULL DEFAULT 'not_registered';
                UPDATE users
                SET player_eligibility_status = 'registered'
                WHERE is_registered_player = TRUE
                    AND player_eligibility_status = 'not_registered';
        CREATE UNIQUE INDEX IF NOT EXISTS users_discord_id_unique
            ON users (discord_id)
            WHERE discord_id IS NOT NULL;
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS teams (
            team_id BIGSERIAL PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            captain_id BIGINT REFERENCES users(user_id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS team_members (
            team_id BIGINT NOT NULL REFERENCES teams(team_id) ON DELETE CASCADE,
            user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
            lineup_position SMALLINT,
            team_role TEXT,
            auction_price BIGINT,
            joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (team_id, user_id),
            UNIQUE (user_id),
            UNIQUE (team_id, lineup_position)
        );
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            user_id BIGINT REFERENCES users(user_id),
            username TEXT,
            avatar_url TEXT,
            login_time TIMESTAMP
        );
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS mappool_sections (
            sheet_name TEXT PRIMARY KEY,
            is_public BOOLEAN NOT NULL DEFAULT FALSE,
            display_order INTEGER NOT NULL DEFAULT 0
        );
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS mappool_data (
            sheet_name TEXT PRIMARY KEY,
            headers JSONB NOT NULL,
            rows JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS mappool_columns (
            sheet_name TEXT NOT NULL,
            position INTEGER NOT NULL,
            header TEXT NOT NULL,
            PRIMARY KEY (sheet_name, position)
        );
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS mappool_rows (
            sheet_name TEXT NOT NULL,
            row_number INTEGER NOT NULL,
            PRIMARY KEY (sheet_name, row_number)
        );
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS mappool_values (
            sheet_name TEXT NOT NULL,
            row_number INTEGER NOT NULL,
            position INTEGER NOT NULL,
            value TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (sheet_name, row_number, position)
        );
    `);

    await db.query(`
        CREATE TABLE IF NOT EXISTS site_settings (
            setting_key TEXT PRIMARY KEY,
            boolean_value BOOLEAN NOT NULL DEFAULT TRUE
        );
        ALTER TABLE site_settings ADD COLUMN IF NOT EXISTS text_value TEXT;
        INSERT INTO site_settings (setting_key, boolean_value)
        VALUES ('mappool_public', TRUE)
        ON CONFLICT (setting_key) DO NOTHING;
    `);

    await db.query(`
        INSERT INTO site_settings (setting_key, boolean_value, text_value)
        VALUES
            ('registration_start_at', TRUE, $1),
            ('registration_end_at', TRUE, $2)
        ON CONFLICT (setting_key) DO NOTHING;
    `, [REGISTRATION_START_AT_SEED, REGISTRATION_END_AT_SEED]);
}

// Configure session middleware
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));

async function isAdminUser(req) {
    if (!req.session.user) return false;
    const result = await db.query(
        'SELECT role FROM users WHERE user_id = $1',
        [req.session.user.id]
    );
    return result.rows[0]?.role === 'admin';
}

function saveSession(req) {
    return new Promise((resolve, reject) => {
        req.session.save(error => (error ? reject(error) : resolve()));
    });
}

function discordConfigurationIsComplete() {
    return Boolean(
        process.env.DISCORD_CLIENT_ID
        && process.env.DISCORD_CLIENT_SECRET
        && process.env.DISCORD_REDIRECT_URI
        && process.env.DISCORD_GUILD_ID
    );
}

function parseOptionalDate(value) {
    if (!value) return null;
    const parsedDate = new Date(value);
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

async function getRegistrationWindow() {
    const result = await db.query(`
        SELECT setting_key, text_value
        FROM site_settings
        WHERE setting_key IN ('registration_start_at', 'registration_end_at')
    `);
    const settings = Object.fromEntries(result.rows.map(row => [row.setting_key, row.text_value]));
    const startAt = parseOptionalDate(settings.registration_start_at);
    const endAt = parseOptionalDate(settings.registration_end_at);
    const isConfigured = Boolean(startAt && endAt && startAt < endAt);
    const now = new Date();
    const status = !isConfigured
        ? 'closed'
        : now < startAt
            ? 'upcoming'
            : now <= endAt
                ? 'open'
                : 'closed';

    return {
        startAt,
        endAt,
        isConfigured,
        isOpen: status === 'open',
        status
    };
}

async function isRegistrationWindowOpen() {
    return (await getRegistrationWindow()).isOpen;
}

async function calculateBwsEligibility(userId) {
    const token = await getOsuApiToken();
    const response = await axios.get(`https://osu.ppy.sh/api/v2/users/${userId}/osu`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { key: 'id' },
        timeout: 15000
    });
    const globalRank = response.data.statistics?.global_rank;
    if (!Number.isInteger(globalRank) || globalRank < 1) {
        return { eligible: false, reason: 'unranked' };
    }

    const badgeCount = (response.data.badges || []).filter(badge => (
        badge.awarded_at && new Date(badge.awarded_at) >= BWS_BADGE_CUTOFF
    )).length;
    const bwsRank = globalRank ** (0.9937 ** (badgeCount ** 2));

    return {
        eligible: bwsRank >= BWS_MIN_RANK && bwsRank <= BWS_MAX_RANK,
        globalRank,
        badgeCount,
        bwsRank,
        countryCode: response.data.country_code || response.data.country?.code || null
    };
}

async function saveBwsEvaluation(userId, evaluation, eligibilityStatus, queryable = db) {
    await queryable.query(`
        UPDATE users
        SET bws_rank = $2,
            global_rank = $3,
            bws_badge_count = $4,
            bws_calculated_at = NOW(),
            profile_country_code = $5,
            player_eligibility_status = $6
        WHERE user_id = $1
    `, [
        userId,
        evaluation.bwsRank ?? null,
        evaluation.globalRank ?? null,
        evaluation.badgeCount ?? 0,
        evaluation.countryCode ?? null,
        eligibilityStatus
    ]);
}

async function refreshRegisteredPlayerEligibility(userId, force = false) {
    if (!(await isRegistrationWindowOpen())) return;

    const userResult = await db.query(`
        SELECT is_registered_player, bws_calculated_at
        FROM users
        WHERE user_id = $1
    `, [userId]);
    const player = userResult.rows[0];
    if (!player?.is_registered_player) return;

    const lastCalculation = player.bws_calculated_at && new Date(player.bws_calculated_at);
    if (!force && lastCalculation && Date.now() - lastCalculation.getTime() < BWS_REFRESH_INTERVAL_MS) {
        return;
    }

    const evaluation = await calculateBwsEligibility(userId);
    if (evaluation.eligible) {
        await saveBwsEvaluation(userId, evaluation, 'registered');
        return;
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await saveBwsEvaluation(userId, evaluation, 'bws-ineligible', client);
        await client.query(`
            UPDATE users
            SET is_registered_player = FALSE
            WHERE user_id = $1
        `, [userId]);
        await client.query('DELETE FROM team_members WHERE user_id = $1', [userId]);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function refreshAllPlayerEligibilities() {
    if (!(await isRegistrationWindowOpen()) || playerEligibilityRefreshInProgress) return;

    playerEligibilityRefreshInProgress = true;
    try {
        const result = await db.query(`
            SELECT user_id
            FROM users
            WHERE is_registered_player = TRUE
        `);
        for (const { user_id: userId } of result.rows) {
            try {
                await refreshRegisteredPlayerEligibility(userId, true);
            } catch (error) {
                console.error(`Could not refresh BWS eligibility for user ${userId}:`, error.message);
            }
            await new Promise(resolve => setTimeout(resolve, 1100));
        }
    } finally {
        playerEligibilityRefreshInProgress = false;
    }
}

async function isMappoolPublic() {
    const result = await db.query(
        'SELECT boolean_value FROM site_settings WHERE setting_key = $1',
        ['mappool_public']
    );
    return result.rows[0]?.boolean_value ?? true;
}

app.get('/mappool.html', async (req, res) => {
    if (!(await isMappoolPublic()) && !(await isAdminUser(req))) {
        return res.status(403).send('The mappool is not publicly available yet.');
    }
    res.sendFile(path.join(__dirname, '../client/mappool.html'));
});

// Serve static files from the client directory 
app.use(express.static(path.join(__dirname, '../client')));

// Redirect users depending on whether they are logged in.
app.use((req, res, next) => {
    if (req.method !== 'GET') return next();

    const publicPaths = [
        '/',
        '/index.html',
        '/mappool.html',
        '/health',
        '/auth/osu',
        '/auth/osu/callback',
        '/auth/discord',
        '/auth/discord/callback',
        '/logout'
    ];

    const isPublicPath = publicPaths.includes(req.path)
        || req.path.startsWith('/api/')
        || req.path.startsWith('/admin/')
        || req.path.startsWith('/css/')
        || req.path.startsWith('/js/')
        || req.path.startsWith('/img/');

    if (isPublicPath) {
        if ((req.path === '/' || req.path === '/index.html') && req.session?.user) {
            return res.redirect('/dashboard.html');
        }
        return next();
    }

    if (req.session?.user) {
        return res.redirect('/dashboard.html');
    }

    return res.redirect('/');
});

// Lightweight endpoint for Render health checks and uptime monitors.
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

app.get('/api/mappool-access', async (req, res) => {
    res.json({ publicAccessEnabled: await isMappoolPublic() });
});

// Route to initiate OAuth2 login with osu!
app.get('/auth/osu', (req, res) => {
    const state = crypto.randomUUID();
    req.session.osuOAuthState = state;

    const params = new URLSearchParams({
        client_id: process.env.OSU_CLIENT_ID,
        redirect_uri: process.env.OSU_REDIRECT_URI,
        response_type: 'code',
        scope: 'identify',
        state
    });

    saveSession(req)
        .then(() => res.redirect(`https://osu.ppy.sh/oauth/authorize?${params.toString()}`))
        .catch(error => {
            console.error('Could not start osu! login:', error);
            res.status(500).send('Could not start osu! login.');
        });
});

// Callback route after osu! authentication
app.get('/auth/osu/callback', async (req, res) => {
    const code = req.query.code;
    if (!code || req.query.state !== req.session.osuOAuthState) {
        return res.status(400).send('Invalid osu! authorization response.');
    }

    try {
        // Exchange code for access token
        const tokenResponse = await axios.post('https://osu.ppy.sh/oauth/token', {
            client_id: process.env.OSU_CLIENT_ID,
            client_secret: process.env.OSU_CLIENT_SECRET,
            code,
            grant_type: 'authorization_code',
            redirect_uri: process.env.OSU_REDIRECT_URI
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });

        const accessToken = tokenResponse.data.access_token;

        // Retrieve user information
        const userResponse = await axios.get('https://osu.ppy.sh/api/v2/me', {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });

        const user = userResponse.data;

        const sessionUser = {
            id: user.id,
            username: user.username,
            avatar_url: user.avatar_url
        };
        req.session.user = sessionUser;
        delete req.session.osuOAuthState;

        await db.query(`
            INSERT INTO users (user_id, username, avatar_url)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id) DO UPDATE SET
                username = EXCLUDED.username,
                avatar_url = EXCLUDED.avatar_url
        `, [sessionUser.id, sessionUser.username, sessionUser.avatar_url]);
        await db.query('DELETE FROM sessions WHERE user_id = $1', [sessionUser.id]);
        await db.query(`
            INSERT INTO sessions (session_id, user_id, username, avatar_url, login_time)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (session_id) DO UPDATE SET
                user_id = EXCLUDED.user_id,
                username = EXCLUDED.username,
                avatar_url = EXCLUDED.avatar_url,
                login_time = EXCLUDED.login_time
        `, [
            req.sessionID,
            sessionUser.id,
            sessionUser.username,
            sessionUser.avatar_url,
            new Date().toISOString()
        ]);
        await saveSession(req);
        res.redirect('/dashboard.html');
    } catch (error) {
        console.error('Authentication error:', error.response?.data || error.message);
        res.status(500).send('Authentication failed.');
    }
});

app.get('/auth/discord', async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/');
    }
    if (!(await isRegistrationWindowOpen())) {
        return res.redirect('/dashboard.html?registration=closed');
    }
    if (!discordConfigurationIsComplete()) {
        return res.status(500).send('Discord login is not configured.');
    }

    const state = crypto.randomUUID();
    req.session.discordOAuthState = state;
    await saveSession(req);

    const params = new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
        response_type: 'code',
        scope: 'identify guilds',
        state
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    const sessionUser = req.session.user;
    if (req.query.error === 'access_denied') {
        delete req.session.discordOAuthState;
        await saveSession(req);
        return res.redirect('/dashboard.html?registration=cancelled');
    }

    if (!code || !sessionUser || req.query.state !== req.session.discordOAuthState) {
        return res.status(400).send('Invalid Discord authorization response.');
    }

    if (!(await isRegistrationWindowOpen())) {
        delete req.session.discordOAuthState;
        await saveSession(req);
        return res.redirect('/dashboard.html?registration=closed');
    }

    try {
        const tokenResponse = await axios.post(
            'https://discord.com/api/oauth2/token',
            new URLSearchParams({
                client_id: process.env.DISCORD_CLIENT_ID,
                client_secret: process.env.DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: process.env.DISCORD_REDIRECT_URI
            }).toString(),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        const accessToken = tokenResponse.data.access_token;
        const headers = { Authorization: `Bearer ${accessToken}` };
        const [discordUserResponse, guildsResponse] = await Promise.all([
            axios.get('https://discord.com/api/users/@me', { headers }),
            axios.get('https://discord.com/api/users/@me/guilds', { headers })
        ]);
        const hasJoinedDiscord = guildsResponse.data.some(guild => (
            guild.id === process.env.DISCORD_GUILD_ID
        ));

        if (!hasJoinedDiscord) {
            delete req.session.discordOAuthState;
            await saveSession(req);
            return res.redirect('/dashboard.html?registration=discord-required');
        }

        const bwsEligibility = await calculateBwsEligibility(sessionUser.id);
        if (!bwsEligibility.eligible) {
            await saveBwsEvaluation(sessionUser.id, bwsEligibility, 'bws-ineligible');
            delete req.session.discordOAuthState;
            await saveSession(req);
            return res.redirect('/dashboard.html?registration=bws-ineligible');
        }

        const discordUser = discordUserResponse.data;
        const existingDiscordLink = await db.query(
            'SELECT user_id FROM users WHERE discord_id = $1 AND user_id <> $2',
            [discordUser.id, sessionUser.id]
        );
        if (existingDiscordLink.rows.length > 0) {
            return res.status(409).send('This Discord account is already linked to another osu! account.');
        }

        await db.query(`
            INSERT INTO users (
                user_id, username, avatar_url, discord_id, discord_username,
                is_registered_player, registered_at, bws_rank, global_rank,
                bws_badge_count, bws_calculated_at, profile_country_code,
                player_eligibility_status
            )
            VALUES ($1, $2, $3, $4, $5, TRUE, NOW(), $6, $7, $8, NOW(), $9, 'registered')
            ON CONFLICT (user_id) DO UPDATE SET
                username = EXCLUDED.username,
                avatar_url = EXCLUDED.avatar_url,
                discord_id = EXCLUDED.discord_id,
                discord_username = EXCLUDED.discord_username,
                is_registered_player = TRUE,
                registered_at = COALESCE(users.registered_at, NOW()),
                bws_rank = EXCLUDED.bws_rank,
                global_rank = EXCLUDED.global_rank,
                bws_badge_count = EXCLUDED.bws_badge_count,
                bws_calculated_at = NOW(),
                profile_country_code = EXCLUDED.profile_country_code,
                player_eligibility_status = 'registered'
        `, [
            sessionUser.id,
            sessionUser.username,
            sessionUser.avatar_url,
            discordUser.id,
            discordUser.global_name || discordUser.username,
            bwsEligibility.bwsRank,
            bwsEligibility.globalRank,
            bwsEligibility.badgeCount,
            bwsEligibility.countryCode
        ]);

        delete req.session.discordOAuthState;
        await saveSession(req);
        res.redirect('/dashboard.html?registration=success');
    } catch (error) {
        console.error('Discord authentication error:', error.response?.data || error.message);
        res.status(500).send('Discord authentication failed.');
    }
});

// API route to get current user info
app.get('/api/user', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    res.set('Cache-Control', 'no-store');

    try {
        await refreshRegisteredPlayerEligibility(req.session.user.id);
    } catch (error) {
        console.error(`Could not refresh BWS eligibility for current user:`, error.message);
    }

    const result = await db.query(
        'SELECT role, is_registered_player, player_eligibility_status FROM users WHERE user_id = $1',
        [req.session.user.id]
    );
    const registrationWindow = await getRegistrationWindow();

    res.json({
        ...req.session.user,
        role: result.rows[0]?.role || 'player',
        isRegisteredPlayer: Boolean(result.rows[0]?.is_registered_player),
        playerEligibilityStatus: result.rows[0]?.player_eligibility_status || 'not_registered',
        registrationWindow: {
            status: registrationWindow.status,
            startAt: registrationWindow.startAt?.toISOString() || null,
            endAt: registrationWindow.endAt?.toISOString() || null
        }
    });
});

app.get('/api/user/team', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    try {
        const teamResult = await db.query(`
            SELECT t.team_id, t.name, t.captain_id
            FROM teams t
            JOIN team_members tm ON tm.team_id = t.team_id
            WHERE tm.user_id = $1
            LIMIT 1
        `, [req.session.user.id]);

        if (teamResult.rows.length === 0) {
            return res.json({ team: null, lineup: [] });
        }

        const team = teamResult.rows[0];
        const lineupResult = await db.query(`
            SELECT
                u.user_id,
                u.username,
                u.avatar_url,
                tm.team_role,
                tm.auction_price,
                tm.lineup_position,
                CASE WHEN t.captain_id = u.user_id THEN TRUE ELSE FALSE END AS is_captain
            FROM team_members tm
            JOIN users u ON u.user_id = tm.user_id
            JOIN teams t ON t.team_id = tm.team_id
            WHERE tm.team_id = $1
            ORDER BY tm.lineup_position NULLS LAST, tm.joined_at, u.username
        `, [team.team_id]);

        res.json({
            team: {
                id: team.team_id,
                name: team.name,
                captainId: team.captain_id
            },
            lineup: lineupResult.rows
        });
    } catch (error) {
        console.error('Could not load team lineup:', error.message);
        res.status(500).json({ error: 'Could not load team lineup' });
    }
});

app.get('/api/players', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const players = await db.query(`
        SELECT
            u.user_id,
            u.username,
            u.avatar_url,
            u.role,
            u.profile_country_code,
            u.global_rank,
            u.bws_badge_count,
            u.bws_rank,
            t.name AS team_name
        FROM users u
        LEFT JOIN team_members tm ON tm.user_id = u.user_id
        LEFT JOIN teams t ON t.team_id = tm.team_id
        WHERE u.is_registered_player = TRUE
          AND u.discord_id IS NOT NULL
        ORDER BY u.username
    `);
    res.json(players.rows);
});

// Logout route 
app.get('/logout', async (req, res) => {
    await db.query(`DELETE FROM sessions WHERE session_id = $1`, [req.sessionID]);

    req.session.destroy(() => {
        res.redirect('/');
    });
});

async function requireAdmin(req, res, next) {
    if (!req.session.user) return res.status(401).send('Not authenticated');

    const result = await db.query(
        'SELECT role FROM users WHERE user_id = $1',
        [req.session.user.id]
    );

    if (result.rows[0]?.role !== 'admin') return res.status(403).send('Access denied');
    next();
}

app.get('/admin/registration-window', requireAdmin, async (req, res) => {
    const window = await getRegistrationWindow();
    res.json({
        startAt: window.startAt?.toISOString() || null,
        endAt: window.endAt?.toISOString() || null,
        isConfigured: window.isConfigured,
        isOpen: window.isOpen,
        nextPlayerEligibilityRefreshAt: window.isOpen
            ? nextPlayerEligibilityRefreshAt?.toISOString() || null
            : null
    });
});

app.post('/admin/registration-window', requireAdmin, express.json(), async (req, res) => {
    const startAt = parseOptionalDate(req.body.startAt);
    const endAt = parseOptionalDate(req.body.endAt);

    if (!startAt || !endAt || startAt >= endAt) {
        return res.status(400).json({ error: 'Opening time must be before closing time.' });
    }

    await db.query(`
        INSERT INTO site_settings (setting_key, boolean_value, text_value)
        VALUES
            ('registration_start_at', TRUE, $1),
            ('registration_end_at', TRUE, $2)
        ON CONFLICT (setting_key) DO UPDATE
        SET text_value = EXCLUDED.text_value
    `, [startAt.toISOString(), endAt.toISOString()]);

    const window = await getRegistrationWindow();
    refreshAllPlayerEligibilities();
    res.json({
        startAt: window.startAt.toISOString(),
        endAt: window.endAt.toISOString(),
        isOpen: window.isOpen,
        nextPlayerEligibilityRefreshAt: window.isOpen
            ? nextPlayerEligibilityRefreshAt?.toISOString() || null
            : null
    });
});

app.post('/admin/refresh-player-eligibility', requireAdmin, async (req, res) => {
    if (!(await isRegistrationWindowOpen())) {
        return res.status(409).json({
            error: 'Player data can only be refreshed while registrations are open.'
        });
    }

    if (playerEligibilityRefreshInProgress) {
        return res.status(409).json({ error: 'A player data refresh is already running.' });
    }

    await refreshAllPlayerEligibilities();
    res.json({ refreshed: true });
});

async function readGoogleSheet(sheetName) {
    if (!process.env.GOOGLE_APPS_SCRIPT_URL || !process.env.GOOGLE_APPS_SCRIPT_TOKEN) {
        throw new Error('Google Apps Script configuration is incomplete');
    }

    const cached = mappoolCache.get(sheetName);
    if (cached && Date.now() - cached.createdAt < MAPPOOL_CACHE_TTL_MS) {
        return cached.rows;
    }

    let response;
    let lastError;
    for (let attempt = 1; attempt <= GOOGLE_SHEET_ATTEMPTS; attempt++) {
        try {
            response = await axios.get(process.env.GOOGLE_APPS_SCRIPT_URL, {
                params: {
                    token: process.env.GOOGLE_APPS_SCRIPT_TOKEN,
                    sheet: sheetName
                },
                timeout: 15000
            });
            break;
        } catch (error) {
            lastError = error;
            console.warn(`Google Sheets request failed for ${sheetName} (attempt ${attempt}/${GOOGLE_SHEET_ATTEMPTS}):`, {
                status: error.response?.status,
                message: error.message
            });
            if (attempt < GOOGLE_SHEET_ATTEMPTS) {
                await new Promise(resolve => setTimeout(resolve, attempt * 500));
            }
        }
    }

    if (!response) throw lastError;
    const rows = response.data.rows || [];

    const headerIndex = rows.findIndex(row => {
        const values = row.map(value => String(value).trim().toLowerCase());
        return values.includes('pick') && values.includes('mod');
    });
    const effectiveHeaderIndex = headerIndex >= 0 ? headerIndex : 0;
    const transformedRows = combineMappoolColumns(rows, effectiveHeaderIndex);
    const headers = transformedRows[effectiveHeaderIndex] || [];
    const normalizedHeaders = headers.map((header, index) => (
        String(header).trim() || `column_${index + 1}`
    ));

    const normalizedRows = transformedRows.slice(effectiveHeaderIndex + 1)
        .filter(row => row.some(value => String(value ?? '').trim() !== ''))
        .map(row => Object.fromEntries(
            normalizedHeaders.map((header, index) => [header, row[index] ?? ''])
        ));

    await addBeatmapBanners(normalizedHeaders, normalizedRows);

    const visibleData = removeMappoolColumns(normalizedHeaders, normalizedRows);

    const result = {
        headers: visibleData.headers,
        rows: visibleData.rows
    };

    mappoolCache.set(sheetName, {
        createdAt: Date.now(),
        rows: result
    });

    return result;
}

function removeMappoolColumns(headers, rows) {
    const hiddenHeaders = new Set(['primary', 'secondary', 'map id']);
    const visibleHeaders = headers.filter(header => (
        !hiddenHeaders.has(String(header).trim().toLowerCase())
    ));

    return {
        headers: visibleHeaders,
        rows: rows.map(row => Object.fromEntries(
            visibleHeaders.map(header => [header, row[header] ?? ''])
        ))
    };
}

async function getOsuApiToken() {
    if (osuApiToken && Date.now() < osuApiTokenExpiresAt) return osuApiToken;

    const response = await axios.post('https://osu.ppy.sh/oauth/token', {
        client_id: process.env.OSU_CLIENT_ID,
        client_secret: process.env.OSU_CLIENT_SECRET,
        grant_type: 'client_credentials',
        scope: 'public'
    }, { timeout: 15000 });

    osuApiToken = response.data.access_token;
    osuApiTokenExpiresAt = Date.now() + Math.max(response.data.expires_in - 60, 60) * 1000;
    return osuApiToken;
}

function findHeader(headers, expected) {
    return headers.find(header => String(header).trim().toLowerCase() === expected);
}

function extractBeatmapId(value) {
    const text = String(value ?? '').trim();
    const urlMatch = text.match(/(?:beatmaps\/|#osu\/)(\d+)/i);
    if (urlMatch) return urlMatch[1];
    const idMatch = text.match(/^\d+$/);
    return idMatch ? idMatch[0] : null;
}

async function getBeatmapBanner(beatmapId) {
    if (osuBeatmapCache.has(beatmapId)) return osuBeatmapCache.get(beatmapId);

    const token = await getOsuApiToken();
    const response = await axios.get(`https://osu.ppy.sh/api/v2/beatmaps/${beatmapId}`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15000
    });
    const banner = response.data.beatmapset?.covers?.cover
        || response.data.beatmapset?.covers?.['cover@2x']
        || '';
    osuBeatmapCache.set(beatmapId, banner);
    return banner;
}

async function addBeatmapBanners(headers, rows) {
    const bannerHeader = findHeader(headers, 'banner');
    const mapHeader = headers.find(header => (
        /map\s*(id|id\/url)|map\s*\+\s*url/i.test(String(header))
    ));
    if (!bannerHeader || !mapHeader) return;

    try {
        await Promise.all(rows.map(async row => {
            const beatmapId = extractBeatmapId(row[mapHeader]);
            if (!beatmapId) return;
            try {
                row[bannerHeader] = await getBeatmapBanner(beatmapId);
            } catch (error) {
                console.warn(`Could not load osu! banner for beatmap ${beatmapId}:`, error.message);
            }
        }));
    } catch (error) {
        console.warn('Could not enrich mappool banners:', error.message);
    }
}

function combineMappoolColumns(rows, headerIndex) {
    const header = rows[headerIndex] || [];
    const normalizedHeader = header.map(value => String(value).trim().toLowerCase());
    const namedAaIndex = normalizedHeader.indexOf('aa');
    const namedAbIndex = normalizedHeader.indexOf('ab');
    const namedAcIndex = normalizedHeader.indexOf('ac');
    const hasPhysicalColumns = rows.some(row => row.length > AC_COLUMN_INDEX);
    const isCompactMappoolRange = normalizedHeader[0] === 'pick' &&
        normalizedHeader[2] === 'mod';
    const aaIndex = namedAaIndex >= 0
        ? namedAaIndex
        : (isCompactMappoolRange || hasPhysicalColumns ? (isCompactMappoolRange ? 0 : AA_COLUMN_INDEX) : -1);
    const abIndex = namedAbIndex >= 0
        ? namedAbIndex
        : (isCompactMappoolRange || hasPhysicalColumns ? (isCompactMappoolRange ? 1 : AB_COLUMN_INDEX) : -1);
    const acIndex = namedAcIndex >= 0
        ? namedAcIndex
        : (isCompactMappoolRange || hasPhysicalColumns ? (isCompactMappoolRange ? 2 : AC_COLUMN_INDEX) : -1);

    if (aaIndex < 0 || abIndex < 0 || acIndex < 0) return rows;

    return rows.map((row, rowIndex) => {
        const values = [...row];
        const aaValue = values[aaIndex] ?? '';
        const abValue = values[abIndex] ?? '';

        if (rowIndex !== headerIndex) {
            values[aaIndex] = `${aaValue}${abValue}`;
        }

        [abIndex, acIndex].sort((left, right) => right - left)
            .forEach(index => values.splice(index, 1));
        return values;
    });
}

async function saveMappoolInDatabase(sheetName, data) {
    const client = await db.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM mappool_values WHERE sheet_name = $1', [sheetName]);
        await client.query('DELETE FROM mappool_rows WHERE sheet_name = $1', [sheetName]);
        await client.query('DELETE FROM mappool_columns WHERE sheet_name = $1', [sheetName]);

        await insertInBatches(client, 'mappool_columns', ['sheet_name', 'position', 'header'],
            data.headers.map((header, position) => [sheetName, position, header]));
        await insertInBatches(client, 'mappool_rows', ['sheet_name', 'row_number'],
            data.rows.map((row, index) => [sheetName, index + 4]));

        const values = [];
        data.rows.forEach((row, rowIndex) => {
            data.headers.forEach((header, position) => {
                values.push([sheetName, rowIndex + 4, position, String(row[header] ?? '')]);
            });
        });
        await insertInBatches(client, 'mappool_values',
            ['sheet_name', 'row_number', 'position', 'value'], values);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function insertInBatches(client, table, columns, rows, batchSize = 500) {
    for (let offset = 0; offset < rows.length; offset += batchSize) {
        const batch = rows.slice(offset, offset + batchSize);
        const values = [];
        const placeholders = batch.map((row, rowIndex) => {
            const rowPlaceholders = row.map((_, columnIndex) => {
                values.push(row[columnIndex]);
                return `$${values.length}`;
            });
            return `(${rowPlaceholders.join(', ')})`;
        });
        await client.query(
            `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders.join(', ')}`,
            values
        );
    }
}

app.get('/api/mappool', async (req, res) => {
    try {
        if (!(await isMappoolPublic()) && !(await isAdminUser(req))) {
            return res.status(403).json({ error: 'The mappool is not publicly available yet.' });
        }

        const sections = await db.query(`
            SELECT sheet_name
            FROM mappool_sections
            WHERE is_public = TRUE
            ORDER BY display_order, sheet_name
        `);

        const data = [];
        for (const section of sections.rows) {
            const columns = await db.query(
                'SELECT position, header FROM mappool_columns WHERE sheet_name = $1 ORDER BY position',
                [section.sheet_name]
            );
            const rows = await db.query(
                'SELECT row_number FROM mappool_rows WHERE sheet_name = $1 ORDER BY row_number',
                [section.sheet_name]
            );
            const values = await db.query(
                `SELECT row_number, position, value
                 FROM mappool_values
                 WHERE sheet_name = $1
                 ORDER BY row_number, position`,
                [section.sheet_name]
            );
            const valuesByRow = new Map();
            values.rows.forEach(cell => {
                if (!valuesByRow.has(cell.row_number)) valuesByRow.set(cell.row_number, {});
                const header = columns.rows.find(column => column.position === cell.position)?.header;
                if (header) valuesByRow.get(cell.row_number)[header] = cell.value;
            });
            data.push({
                name: section.sheet_name,
                rows: rows.rows.map(row => valuesByRow.get(row.row_number) || {})
            });
        }

        res.json({ sections: data });
    } catch (error) {
        console.error('Mappool fetch error:', error.message);
        res.status(502).json({ error: 'Could not load the mappool' });
    }
});

app.get('/admin/mappool', requireAdmin, async (req, res) => {
    const result = await db.query(`
        SELECT sheet_name, is_public, display_order
        FROM mappool_sections
        ORDER BY display_order, sheet_name
    `);
    res.json({
        publicAccessEnabled: await isMappoolPublic(),
        spreadsheetConfigured: Boolean(
            process.env.GOOGLE_APPS_SCRIPT_URL &&
            process.env.GOOGLE_APPS_SCRIPT_TOKEN
        ),
        sections: result.rows
    });
});

app.post('/admin/mappool/config', requireAdmin, express.json(), async (req, res) => {
    const sections = Array.isArray(req.body.sections) ? req.body.sections : [];
    const publicAccessEnabled = Boolean(req.body.publicAccessEnabled);
    const names = [...new Set(sections
        .map(section => String(section.name || '').trim())
        .filter(Boolean))];

    try {
        await db.query(
            `INSERT INTO site_settings (setting_key, boolean_value)
             VALUES ($1, $2)
             ON CONFLICT (setting_key) DO UPDATE SET boolean_value = EXCLUDED.boolean_value`,
            ['mappool_public', publicAccessEnabled]
        );
        await db.query('DELETE FROM mappool_sections');
        for (const [displayOrder, sheetName] of names.entries()) {
            await db.query(
                'INSERT INTO mappool_sections (sheet_name, is_public, display_order) VALUES ($1, $2, $3)',
                [sheetName, Boolean(sections.find(section => section.name === sheetName)?.isPublic), displayOrder]
            );
        }

        res.json({ updated: true });
    } catch (error) {
        console.error('Mappool configuration error:', error.message);
        res.status(400).json({
            error: `Could not save mappool configuration: ${error.message}`
        });
    }
});

app.post('/admin/mappool/refresh', requireAdmin, async (req, res) => {
    const result = await db.query(`
        SELECT sheet_name
        FROM mappool_sections
        WHERE is_public = TRUE
        ORDER BY display_order, sheet_name
    `);
    const warnings = [];

    for (const { sheet_name: sheetName } of result.rows) {
        try {
            const data = await readGoogleSheet(sheetName);
            await saveMappoolInDatabase(sheetName, data);
        } catch (error) {
            console.error('Mappool sheet refresh failed:', {
                sheetName,
                status: error.response?.status,
                response: error.response?.data,
                message: error.message
            });
            warnings.push(`Google Sheets tab "${sheetName}" could not be refreshed.`);
        }
    }

    res.json({ refreshed: true, warnings });
});

// Admin route to see users registered
app.get('/admin/logged-users', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).send('Not logged in');
    }

    const result = await db.query(
        'SELECT role FROM users WHERE user_id = $1',
        [req.session.user.id]
    );
    const user = result.rows[0];

    if (!user || user.role !== 'admin') {
        return res.status(403).send('Access denied: not an admin');
    }

    // Obtener todos los usuarios registrados
        const users = await db.query(`
                SELECT
                        u.user_id,
                        u.username,
                        u.role,
                        COALESCE(u.avatar_url, (
                                SELECT s.avatar_url
                                FROM sessions s
                                WHERE s.user_id = u.user_id
                                ORDER BY login_time DESC
                                LIMIT 1
                        )) AS avatar_url,
                        t.team_id,
                        t.name AS team_name
                FROM users u
                LEFT JOIN team_members tm ON tm.user_id = u.user_id
                LEFT JOIN teams t ON t.team_id = tm.team_id
                ORDER BY u.username
        `);
      

    res.json(users.rows);
});

app.get('/admin/teams', requireAdmin, async (req, res) => {
    const teams = await db.query(`
        SELECT team_id, name
        FROM teams
        ORDER BY name
    `);
    res.json(teams.rows);
});


app.post('/admin/set-role', express.json(), async (req, res) => {
    const { userId, role } = req.body;
  
    if (!req.session.user) return res.status(401).send('Not authenticated');
  
    const adminCheck = await db.query(
      'SELECT role FROM users WHERE user_id = $1',
      [req.session.user.id]
    );
  
    if (adminCheck.rows[0]?.role !== 'admin') {
      return res.status(403).send('Access denied');
    }
  
    await db.query(
      'UPDATE users SET role = $1 WHERE user_id = $2',
      [role, userId]
    );
  
    res.sendStatus(200);
  });

app.post('/admin/set-user-team', requireAdmin, express.json(), async (req, res) => {
    const { userId, teamId } = req.body;
    const parsedUserId = Number(userId);

    if (!Number.isSafeInteger(parsedUserId) || parsedUserId < 1) {
        return res.status(400).json({ error: 'A valid user is required' });
    }

    if (teamId === null) {
        await db.query('DELETE FROM team_members WHERE user_id = $1', [parsedUserId]);
        return res.sendStatus(204);
    }

    const parsedTeamId = Number(teamId);
    if (!Number.isSafeInteger(parsedTeamId) || parsedTeamId < 1) {
        return res.status(400).json({ error: 'A valid team is required' });
    }

    const teamResult = await db.query(
        'SELECT team_id FROM teams WHERE team_id = $1',
        [parsedTeamId]
    );
    if (teamResult.rows.length === 0) {
        return res.status(404).json({ error: 'Team not found' });
    }

    await db.query('DELETE FROM team_members WHERE user_id = $1', [parsedUserId]);
    await db.query(
        'INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)',
        [parsedTeamId, parsedUserId]
    );

    res.sendStatus(204);
});



// Start the server
const PORT = process.env.PORT || 3000;
initializeDatabase()
    .then(() => {
        refreshAllPlayerEligibilities();
        nextPlayerEligibilityRefreshAt = new Date(Date.now() + BWS_REFRESH_INTERVAL_MS);
        setInterval(() => {
            nextPlayerEligibilityRefreshAt = new Date(Date.now() + BWS_REFRESH_INTERVAL_MS);
            refreshAllPlayerEligibilities();
        }, BWS_REFRESH_INTERVAL_MS);
        app.listen(PORT, () => {
            console.log(`Server running at http://localhost:${PORT}`);
        });
    })
    .catch(error => {
        console.error('Database initialization failed:', error);
        process.exit(1);
    });
