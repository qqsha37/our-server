const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const dbPath = path.resolve(__dirname, 'database.sqlite');

let db;
function initDb() {
  db = new sqlite3.Database(dbPath);
  db.serialize(() => {
    // Таблица пользователей
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      email TEXT UNIQUE, 
      display_name TEXT, 
      username TEXT UNIQUE, 
      password TEXT
    )`);
    
    // Друзья
    db.run(`CREATE TABLE IF NOT EXISTS contacts (
      user_id INTEGER, 
      contact_id INTEGER,
      UNIQUE(user_id, contact_id)
    )`);

    // Группы
    db.run(`CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      name TEXT, 
      description TEXT,
      owner_id INTEGER,
      is_group INTEGER DEFAULT 1
    )`);

    // Участники
    db.run(`CREATE TABLE IF NOT EXISTS group_members (
      group_id INTEGER, 
      user_id INTEGER
    )`);

    // Сообщения (добавлено поле timestamp)
    db.run(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      group_id INTEGER, 
      sender_id INTEGER,
      sender_name TEXT,
      text TEXT, 
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  });
}
initDb();

// Эндпоинты API
app.get('/users/search/:username', (req, res) => {
  const search = req.params.username.trim().toLowerCase();
  const query = search.startsWith('@') ? search : `@${search}`;
  db.get("SELECT id, display_name, username FROM users WHERE username = ?", [query], (err, row) => {
    if (row) res.json(row);
    else res.status(404).json({ error: "Пользователь не найден" });
  });
});

// НОВОЕ: Получение истории сообщений
app.get('/messages/:groupId', (req, res) => {
  db.all("SELECT * FROM messages WHERE group_id = ? ORDER BY timestamp ASC", [req.params.groupId], (err, rows) => {
    res.json(rows || []);
  });
});

app.post('/contacts/add', (req, res) => {
  const { user_id, contact_id } = req.body;
  db.run("INSERT OR IGNORE INTO contacts (user_id, contact_id) VALUES (?, ?)", [user_id, contact_id], () => {
    res.json({ success: true });
  });
});

app.get('/contacts/:userId', (req, res) => {
  db.all(`SELECT u.id, u.display_name, u.username FROM users u 
          JOIN contacts c ON u.id = c.contact_id WHERE c.user_id = ?`, [req.params.userId], (err, rows) => {
    res.json(rows || []);
  });
});

app.post('/groups/create', (req, res) => {
  const { name, description, owner_id, members } = req.body;
  db.run("INSERT INTO groups (name, description, owner_id) VALUES (?, ?, ?)", [name, description, owner_id], function(err) {
    const groupId = this.lastID;
    const allMembers = [...new Set([...members, owner_id])]; 
    const stmt = db.prepare("INSERT INTO group_members (group_id, user_id) VALUES (?, ?)");
    allMembers.forEach(mId => stmt.run(groupId, mId));
    stmt.finalize();
    res.json({ success: true, id: groupId });
  });
});

app.get('/my-chats/:userId', (req, res) => {
  db.all(`SELECT g.* FROM groups g 
          JOIN group_members gm ON g.id = gm.group_id 
          WHERE gm.user_id = ?`, [req.params.userId], (err, rows) => {
    res.json(rows || []);
  });
});

app.post('/register', (req, res) => {
  const { email, display_name, username, password } = req.body;
  const e = email.trim().toLowerCase();
  const u = username.trim().startsWith('@') ? username.trim() : `@${username.trim()}`;
  db.run("INSERT INTO users (email, display_name, username, password) VALUES (?, ?, ?, ?)", [e, display_name, u, password], (err) => {
    if (err) return res.status(400).json({ error: "Занято" });
    res.json({ success: true });
  });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email = ? AND password = ?", [email.trim().toLowerCase(), password.trim()], (err, row) => {
    if (row) res.json({ success: true, ...row });
    else res.status(401).json({ error: "Ошибка входа" });
  });
});

// Socket.io логика
io.on('connection', (socket) => {
  socket.on('join', (id) => socket.join(`room_${id}`));
  socket.on('msg', (data) => {
    db.run("INSERT INTO messages (group_id, sender_id, sender_name, text) VALUES (?, ?, ?, ?)", 
    [data.group_id, data.sender_id, data.sender_name, data.text], function() {
      const savedMsg = { ...data, id: this.lastID, timestamp: new Date().toISOString() };
      io.to(`room_${data.group_id}`).emit('msg', savedMsg);
    });
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`Сервер запущен на порту ${PORT}`));