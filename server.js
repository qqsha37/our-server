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
const dbPath = path.resolve(__dirname, 'database.sqlite');
let db = new sqlite3.Database(dbPath);

const initDb = (database) => {
  database.serialize(() => {
    // Пользователи (добавлени даты рождения)
    database.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      email TEXT UNIQUE, 
      display_name TEXT, 
      username TEXT UNIQUE, 
      password TEXT,
      birth_date TEXT
    )`);
    
    // Группы (добавлен owner_id)
    database.run(`CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      name TEXT, 
      owner_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Участники групп
    database.run(`CREATE TABLE IF NOT EXISTS group_members (
      group_id INTEGER,
      user_id INTEGER
    )`);

    // Сообщения (добавлен id и тип)
    database.run(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      group_id INTEGER, 
      sender_id INTEGER,
      user TEXT, 
      text TEXT, 
      is_pinned INTEGER DEFAULT 0,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  });
};

initDb(db);

// API Эндпоинты
app.post('/register', (req, res) => {
  const { email, display_name, username, password } = req.body;
  db.run("INSERT INTO users (email, display_name, username, password) VALUES (?, ?, ?, ?)", 
    [email, display_name, username, password], function(err) {
      if (err) return res.status(400).json({ error: "Ошибка регистрации" });
      res.json({ success: true, id: this.lastID });
    });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email = ? AND password = ?", [email, password], (err, row) => {
    if (row) res.json({ success: true, ...row });
    else res.status(401).json({ error: "Неверные данные" });
  });
});

// Поиск пользователя по юзернейму
app.get('/users/search/:query', (req, res) => {
  db.all("SELECT id, username, display_name, email FROM users WHERE username LIKE ?", [`%${req.params.query}%`], (err, rows) => {
    res.json(rows || []);
  });
});

// Группы
app.get('/groups/:userId', (req, res) => {
  db.all("SELECT * FROM groups", (err, rows) => res.json(rows || []));
});

app.post('/groups', (req, res) => {
  const { name, owner_id } = req.body;
  db.run("INSERT INTO groups (name, owner_id) VALUES (?, ?)", [name, owner_id], function(err) {
    res.json({ success: true, id: this.lastID });
  });
});

// УДАЛЕНИЕ ВСЕЙ БАЗЫ (STUFF DADB)
app.post('/stuff/dadb', (req, res) => {
  db.close((err) => {
    const fs = require('fs');
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    db = new sqlite3.Database(dbPath);
    initDb(db);
    res.json({ success: true });
  });
});

io.on('connection', (socket) => {
  socket.on('join_group', (groupId) => {
    socket.join(`group_${groupId}`);
    db.all("SELECT * FROM messages WHERE group_id = ? ORDER BY timestamp ASC", [groupId], (err, rows) => {
      socket.emit('load_history', rows || []);
    });
  });

  socket.on('send_message', (data) => {
    db.run("INSERT INTO messages (group_id, sender_id, user, text) VALUES (?, ?, ?, ?)", 
      [data.group_id, data.sender_id, data.user, data.text], function() {
        io.to(`group_${data.group_id}`).emit('receive_message', { ...data, id: this.lastID });
    });
  });

  socket.on('delete_message', (msgId, groupId) => {
    db.run("DELETE FROM messages WHERE id = ?", [msgId], () => {
      io.to(`group_${groupId}`).emit('message_deleted', msgId);
    });
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running`));