require('dotenv').config();
const express = require('express');
const axios = require('axios');
const session = require('express-session');
const path = require('path');
const db = require('./db');

const app = express();

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

// Admin route to see logged-in users
app.get('/admin/logged-users', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).send('Not logged in');
    }

    const result = await db.query(`SELECT role FROM users WHERE user_id = $1`, [req.session.user.id]);
    const user = result.rows[0];

    if (!user || user.role !== 'admin') {
        return res.status(403).send('Access denied: not an admin');
    }

    const sessionsResult = await db.query(`SELECT * FROM sessions`);
    res.json(sessionsResult.rows);
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
