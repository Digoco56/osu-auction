require('dotenv').config();
const express = require('express');
const axios = require('axios');
const session = require('express-session');
const path = require('path');
const db = require('./db');

const app = express();
const mappoolCache = new Map();
const MAPPOOL_CACHE_TTL_MS = 60 * 1000;
const GOOGLE_SHEET_ATTEMPTS = 3;
const AA_COLUMN_INDEX = 26;
const AB_COLUMN_INDEX = 27;
const AC_COLUMN_INDEX = 28;

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

db.query(`
    CREATE TABLE IF NOT EXISTS mappool_columns (
        sheet_name TEXT NOT NULL,
        position INTEGER NOT NULL,
        header TEXT NOT NULL,
        PRIMARY KEY (sheet_name, position)
    );
`);

db.query(`
    CREATE TABLE IF NOT EXISTS mappool_rows (
        sheet_name TEXT NOT NULL,
        row_number INTEGER NOT NULL,
        PRIMARY KEY (sheet_name, row_number)
    );
`);

db.query(`
    CREATE TABLE IF NOT EXISTS mappool_values (
        sheet_name TEXT NOT NULL,
        row_number INTEGER NOT NULL,
        position INTEGER NOT NULL,
        value TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (sheet_name, row_number, position)
    );
`);

db.query(`
    CREATE TABLE IF NOT EXISTS site_settings (
        setting_key TEXT PRIMARY KEY,
        boolean_value BOOLEAN NOT NULL DEFAULT TRUE
    );
    INSERT INTO site_settings (setting_key, boolean_value)
    VALUES ('mappool_public', TRUE)
    ON CONFLICT (setting_key) DO NOTHING;
`);

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

// Lightweight endpoint for Render health checks and uptime monitors.
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
});

app.get('/api/mappool-access', async (req, res) => {
    res.json({ publicAccessEnabled: await isMappoolPublic() });
});

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

function combineMappoolColumns(rows, headerIndex) {
    const header = rows[headerIndex] || [];
    const normalizedHeader = header.map(value => String(value).trim().toLowerCase());
    const namedAaIndex = normalizedHeader.indexOf('aa');
    const namedAbIndex = normalizedHeader.indexOf('ab');
    const namedAcIndex = normalizedHeader.indexOf('ac');
    const hasPhysicalColumns = rows.some(row => row.length > AC_COLUMN_INDEX);
    const aaIndex = namedAaIndex >= 0 ? namedAaIndex : (hasPhysicalColumns ? AA_COLUMN_INDEX : -1);
    const abIndex = namedAbIndex >= 0 ? namedAbIndex : (hasPhysicalColumns ? AB_COLUMN_INDEX : -1);
    const acIndex = namedAcIndex >= 0 ? namedAcIndex : (hasPhysicalColumns ? AC_COLUMN_INDEX : -1);

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
