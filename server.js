const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
  // Пользователи
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    email TEXT UNIQUE, display_name TEXT, username TEXT UNIQUE, password TEXT, bio TEXT
  )`);
  // Группы / Чаты
  db.run(`CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, owner_id INTEGER, is_private INTEGER DEFAULT 0
  )`);
  // Участники чатов
  db.run(`CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER, user_id INTEGER, UNIQUE(group_id, user_id)
  )`);
  // Сообщения
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER, sender_id INTEGER, sender_name TEXT, text TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// API Эндпоинты
app.post('/register', (req, res) => {
  const { email, display_name, username, password } = req.body;
  db.run("INSERT INTO users (email, display_name, username, password) VALUES (?, ?, ?, ?)", 
    [email, display_name, username, password], (err) => {
      if (err) res.status(400).json({ error: "Ошибка регистрации" });
      else res.json({ success: true });
  });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email = ? AND password = ?", [email, password], (err, row) => {
    if (row) res.json(row);
    else res.status(401).json({ error: "Неверные данные" });
  });
});

app.get('/my-chats/:uid', (req, res) => {
  const query = `
    SELECT g.* FROM groups g 
    JOIN group_members gm ON g.id = gm.group_id 
    WHERE gm.user_id = ? OR g.owner_id = ?`;
  db.all(query, [req.params.uid, req.params.uid], (err, rows) => res.json(rows || []));
});

app.post('/groups/create', (req, res) => {
  const { name, owner_id, members, is_private } = req.body;
  db.run("INSERT INTO groups (name, owner_id, is_private) VALUES (?, ?, ?)", [name, owner_id, is_private], function() {
    const gid = this.lastID;
    const allMembers = [owner_id, ...members];
    allMembers.forEach(uid => db.run("INSERT INTO group_members (group_id, user_id) VALUES (?, ?)", [gid, uid]));
    res.json({ id: gid });
  });
});

// Socket.io Логика
io.on('connection', (socket) => {
  socket.on('join', (groupId) => {
    socket.join(`room_${groupId}`);
    db.all("SELECT * FROM messages WHERE group_id = ? ORDER BY timestamp ASC", [groupId], (err, rows) => {
      socket.emit('history', rows || []);
    });
  });

  socket.on('msg', (data) => {
    db.run("INSERT INTO messages (group_id, sender_id, sender_name, text) VALUES (?, ?, ?, ?)", 
      [data.group_id, data.sender_id, data.sender_name, data.text], function() {
        io.to(`room_${data.group_id}`).emit('msg', data);
    });
  });
});

server.listen(3000, () => console.log('Server running on port 3000'));