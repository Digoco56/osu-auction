require('dotenv').config();
const express = require('express');
const axios = require('axios');
const session = require('express-session');
const path = require('path');
const db = require('./db');

const app = express();
const mappoolCache = new Map();
const MAPPOOL_CACHE_TTL_MS = 60 * 1000;

// Crear las tablas si no existen (PostgreSQL)
db.query(`
  CREATE TABLE IF NOT EXISTS users (
    user_id BIGINT PRIMARY KEY,
    username TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'player'
  );
`);

db.query(`
  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    user_id BIGINT REFERENCES users(user_id),
    username TEXT,
    avatar_url TEXT,
    login_time TIMESTAMP
  );
`);

db.query(`
    CREATE TABLE IF NOT EXISTS mappool_sections (
        sheet_name TEXT PRIMARY KEY,
        is_public BOOLEAN NOT NULL DEFAULT FALSE,
        display_order INTEGER NOT NULL DEFAULT 0
    );
`);

db.query(`
    CREATE TABLE IF NOT EXISTS mappool_data (
        sheet_name TEXT PRIMARY KEY,
        headers JSONB NOT NULL,
        rows JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
`);

// Configure session middleware
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false
}));

// Serve static files from the client directory 
app.use(express.static(path.join(__dirname, '../client')));

// Route to initiate OAuth2 login with osu!
app.get('/auth/osu', (req, res) => {
    const params = new URLSearchParams({
        client_id: process.env.OSU_CLIENT_ID,
        redirect_uri: process.env.OSU_REDIRECT_URI,
        response_type: 'code',
        scope: 'identify'
    });
    res.redirect(`https://osu.ppy.sh/oauth/authorize?${params.toString()}`);
});

// Callback route after osu! authentication
app.get('/auth/osu/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send('Authorization code not provided.');

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

        // Store user info in session
        req.session.user = user;

        await db.query(
            'DELETE FROM sessions WHERE user_id = $1',
            [user.id]
        );

        // Save user in the database or update username if already exists
        await db.query(`
            INSERT INTO users (user_id, username)
            VALUES ($1, $2)
            ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username
        `, [user.id, user.username]);

        await db.query(`
            INSERT INTO sessions (session_id, user_id, username, avatar_url, login_time)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (session_id) DO UPDATE SET
                user_id = EXCLUDED.user_id,
                username = EXCLUDED.username,
                avatar_url = EXCLUDED.avatar_url,
                login_time = EXCLUDED.login_time
        `, [req.sessionID, user.id, user.username, user.avatar_url, new Date().toISOString()]);

        res.redirect('/dashboard.html');
    } catch (error) {
        console.error('Authentication error:', error.response?.data || error.message);
        res.status(500).send('Authentication failed.');
    }
});

// API route to get current user info
app.get('/api/user', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const result = await db.query(
        'SELECT role FROM users WHERE user_id = $1',
        [req.session.user.id]
    );

    res.json({
        ...req.session.user,
        role: result.rows[0]?.role || 'player'
    });
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

async function readGoogleSheet(sheetName) {
    if (!process.env.GOOGLE_APPS_SCRIPT_URL || !process.env.GOOGLE_APPS_SCRIPT_TOKEN) {
        throw new Error('Google Apps Script configuration is incomplete');
    }

    const cached = mappoolCache.get(sheetName);
    if (cached && Date.now() - cached.createdAt < MAPPOOL_CACHE_TTL_MS) {
        return cached.rows;
    }

    const response = await axios.get(process.env.GOOGLE_APPS_SCRIPT_URL, {
        params: {
            token: process.env.GOOGLE_APPS_SCRIPT_TOKEN,
            sheet: sheetName
        }
    });
    const rows = response.data.rows || [];

    const headerIndex = rows.findIndex(row => {
        const values = row.map(value => String(value).trim().toLowerCase());
        return values.includes('pick') && values.includes('mod');
    });
    const headers = rows[headerIndex >= 0 ? headerIndex : 0] || [];
    const normalizedHeaders = headers.map((header, index) => (
        String(header).trim() || `column_${index + 1}`
    ));

    const normalizedRows = rows.slice(headerIndex >= 0 ? headerIndex + 1 : 1)
        .filter(row => row.some(value => String(value ?? '').trim() !== ''))
        .map(row => Object.fromEntries(
            normalizedHeaders.map((header, index) => [header, row[index] ?? ''])
        ));

    const result = {
        headers: normalizedHeaders,
        rows: normalizedRows
    };

    mappoolCache.set(sheetName, {
        createdAt: Date.now(),
        rows: result
    });

    return result;
}

app.get('/api/mappool', async (req, res) => {
    try {
        const sections = await db.query(`
            SELECT s.sheet_name, d.headers, d.rows
            FROM mappool_sections s
            JOIN mappool_data d ON d.sheet_name = s.sheet_name
            WHERE s.is_public = TRUE
            ORDER BY s.display_order, s.sheet_name
        `);

        const data = sections.rows.map(section => ({
            name: section.sheet_name,
            headers: section.headers,
            rows: section.rows
        }));

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
        spreadsheetConfigured: Boolean(
            process.env.GOOGLE_APPS_SCRIPT_URL &&
            process.env.GOOGLE_APPS_SCRIPT_TOKEN
        ),
        sections: result.rows
    });
});

app.post('/admin/mappool/config', requireAdmin, express.json(), async (req, res) => {
    const sections = Array.isArray(req.body.sections) ? req.body.sections : [];
    const names = [...new Set(sections
        .map(section => String(section.name || '').trim())
        .filter(Boolean))];

    try {
        const publicSections = names.filter(sheetName => (
            sections.find(section => section.name === sheetName)?.isPublic
        ));
        const downloaded = await Promise.all(publicSections.map(async sheetName => ({
            sheetName,
            data: await readGoogleSheet(sheetName)
        })));

        await db.query('DELETE FROM mappool_sections');
        for (const [displayOrder, sheetName] of names.entries()) {
            await db.query(
                'INSERT INTO mappool_sections (sheet_name, is_public, display_order) VALUES ($1, $2, $3)',
                [sheetName, Boolean(sections.find(section => section.name === sheetName)?.isPublic), displayOrder]
            );
        }

        for (const section of downloaded) {
            await db.query(`
                INSERT INTO mappool_data (sheet_name, headers, rows, updated_at)
                VALUES ($1, $2::jsonb, $3::jsonb, NOW())
                ON CONFLICT (sheet_name) DO UPDATE SET
                    headers = EXCLUDED.headers,
                    rows = EXCLUDED.rows,
                    updated_at = NOW()
            `, [
                section.sheetName,
                JSON.stringify(section.data.headers),
                JSON.stringify(section.data.rows)
            ]);
        }

        res.sendStatus(204);
    } catch (error) {
        throw error;
    }
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
        SELECT u.user_id, u.username, u.role,
          (
            SELECT s.avatar_url
            FROM sessions s
            WHERE s.user_id = u.user_id
            ORDER BY login_time DESC
            LIMIT 1
          ) AS avatar_url
        FROM users u
      `);
      

    res.json(users.rows);
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



// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
