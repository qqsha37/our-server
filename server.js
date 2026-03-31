const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, display_name TEXT, username TEXT UNIQUE, password TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, owner_id INTEGER, is_private INTEGER DEFAULT 0)`);
  db.run(`CREATE TABLE IF NOT EXISTS group_members (group_id INTEGER, user_id INTEGER)`);
  db.run(`CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER, sender_id INTEGER, sender_name TEXT, text TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS contacts (user_id INTEGER, contact_id INTEGER)`);
});

// Регистрация
app.post('/register', (req, res) => {
  const { email, display_name, password } = req.body;
  const username = email.split('@')[0]; // Простой юзернейм
  db.run("INSERT INTO users (email, display_name, username, password) VALUES (?, ?, ?, ?)", 
    [email, display_name, username, password], function(err) {
      if (err) res.status(400).json({ error: "Email уже занят" });
      else res.json({ id: this.lastID, success: true });
  });
});

// Вход
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email = ? AND password = ?", [email, password], (err, row) => {
    if (row) res.json(row);
    else res.status(401).json({ error: "Неверные данные" });
  });
});

// Список чатов пользователя
app.get('/my-chats/:uid', (req, res) => {
  const uid = req.params.uid;
  db.all(`SELECT g.* FROM groups g JOIN group_members gm ON g.id = gm.group_id WHERE gm.user_id = ?`, [uid], (err, rows) => {
    res.json(rows || []);
  });
});

// Создание группы/чата
app.post('/groups/create', (req, res) => {
  const { name, owner_id, members, is_private } = req.body;
  db.run("INSERT INTO groups (name, owner_id, is_private) VALUES (?, ?, ?)", [name, owner_id, is_private], function() {
    const gid = this.lastID;
    const all = [owner_id, ...members];
    all.forEach(uid => db.run("INSERT INTO group_members (group_id, user_id) VALUES (?, ?)", [gid, uid]));
    res.json({ id: gid });
  });
});

// Список контактов (пока просто все пользователи кроме себя для теста)
app.get('/contacts/:uid', (req, res) => {
  db.all("SELECT id, display_name, username FROM users WHERE id != ?", [req.params.uid], (err, rows) => {
    res.json(rows || []);
  });
});

io.on('connection', (socket) => {
  socket.on('join', (gid) => {
    socket.join(`room_${gid}`);
    db.all("SELECT * FROM messages WHERE group_id = ? ORDER BY timestamp ASC", [gid], (err, rows) => {
      socket.emit('history', rows || []);
    });
  });

  socket.on('msg', (data) => {
    db.run("INSERT INTO messages (group_id, sender_id, sender_name, text) VALUES (?, ?, ?, ?)", 
      [data.group_id, data.sender_id, data.sender_name, data.text], () => {
        io.to(`room_${data.group_id}`).emit('msg', data);
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));