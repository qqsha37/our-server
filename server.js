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

const db = new sqlite3.Database(path.resolve(__dirname, 'database.sqlite'));

db.serialize(() => {
  // Пользователи
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    email TEXT UNIQUE, 
    display_name TEXT, 
    username TEXT UNIQUE, 
    password TEXT
  )`);
  
  // Группы
  db.run(`CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    name TEXT, 
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Сообщения (привязаны к group_id)
  db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    group_id INTEGER, 
    user TEXT, 
    text TEXT, 
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Создаем одну общую группу по умолчанию, если её нет
  db.get("SELECT * FROM groups WHERE id = 1", (err, row) => {
    if (!row) db.run("INSERT INTO groups (id, name) VALUES (1, 'Общий чат')");
  });
});

// Регистрация
app.post('/register', (req, res) => {
  const { email, display_name, username, password } = req.body;
  const formattedUser = username.startsWith('@') ? username : `@${username}`;
  db.run("INSERT INTO users (email, display_name, username, password) VALUES (?, ?, ?, ?)", 
    [email, display_name, formattedUser, password], (err) => {
      if (err) return res.status(400).json({ error: "Email или Username уже заняты" });
      res.json({ success: true });
    });
});

// Вход
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email = ? AND password = ?", [email, password], (err, row) => {
    if (row) res.json({ success: true, username: row.username, display_name: row.display_name });
    else res.status(401).json({ error: "Неверные данные" });
  });
});

// Список групп
app.get('/groups', (req, res) => {
  db.all("SELECT * FROM groups", (err, rows) => res.json(rows || []));
});

// Создание группы
app.post('/groups', (req, res) => {
  db.run("INSERT INTO groups (name) VALUES (?)", [req.body.name], function(err) {
    res.json({ success: true, id: this.lastID });
  });
});

io.on('connection', (socket) => {
  // При подключении к конкретной группе
  socket.on('join_group', (groupId) => {
    socket.join(`group_${groupId}`);
    db.all("SELECT user, text FROM messages WHERE group_id = ? ORDER BY timestamp ASC LIMIT 50", [groupId], (err, rows) => {
      socket.emit('load_history', rows || []);
    });
  });

  socket.on('send_message', (data) => {
    const { group_id, user, text } = data;
    db.run("INSERT INTO messages (group_id, user, text) VALUES (?, ?, ?)", [group_id, user, text]);
    io.to(`group_${group_id}`).emit('receive_message', data);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server live on ${PORT}`));