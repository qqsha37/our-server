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
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      email TEXT UNIQUE, 
      display_name TEXT, 
      username TEXT UNIQUE, 
      password TEXT,
      bio TEXT,
      birth_date TEXT
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      name TEXT, 
      owner_id INTEGER,
      is_private INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, 
      group_id INTEGER, 
      sender_id INTEGER,
      sender_name TEXT,
      text TEXT, 
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run("INSERT OR IGNORE INTO groups (id, name, owner_id) VALUES (1, 'Общий чат', 0)");
  });
}

initDb();

app.post('/register', (req, res) => {
  const email = req.body.email.trim().toLowerCase();
  const password = req.body.password.trim();
  const { display_name, username } = req.body;
  const nick = username.trim().startsWith('@') ? username.trim() : `@${username.trim()}`;

  db.run("INSERT INTO users (email, display_name, username, password) VALUES (?, ?, ?, ?)", 
    [email, display_name.trim(), nick, password], function(err) {
      if (err) {
        console.error("Ошибка регистрации:", err.message);
        return res.status(400).json({ error: "Email или Username уже заняты" });
      }
      res.json({ success: true, id: this.lastID });
    });
});

app.post('/login', (req, res) => {
  const email = req.body.email.trim().toLowerCase();
  const password = req.body.password.trim();

  console.log(`Попытка входа: ${email}`); // Для отладки в логах Render

  db.get("SELECT * FROM users WHERE email = ? AND password = ?", [email, password], (err, row) => {
    if (err) return res.status(500).json({ error: "Ошибка БД" });
    if (row) {
      console.log(`Успешный вход: ${row.username}`);
      res.json({ success: true, ...row });
    } else {
      console.log(`Неудачный вход для: ${email}`);
      res.status(401).json({ error: "Неверная почта или пароль" });
    }
  });
});

app.get('/groups', (req, res) => {
  db.all("SELECT * FROM groups", (err, rows) => res.json(rows || []));
});

app.post('/admin/nuclear-reset', (req, res) => {
  db.close(() => {
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    initDb();
    io.emit('FORCE_LOGOUT');
    res.json({ success: true, message: "База данных полностью очищена" });
  });
});

io.on('connection', (socket) => {
  socket.on('join', (groupId) => {
    socket.join(`group_${groupId}`);
    db.all("SELECT * FROM messages WHERE group_id = ? ORDER BY timestamp ASC LIMIT 100", [groupId], (err, rows) => {
      socket.emit('history', rows || []);
    });
  });

  socket.on('msg', (data) => {
    db.run("INSERT INTO messages (group_id, sender_id, sender_name, text) VALUES (?, ?, ?, ?)", 
      [data.group_id, data.sender_id, data.sender_name, data.text], function() {
        const fullMsg = { ...data, id: this.lastID, timestamp: new Date() };
        io.to(`group_${data.group_id}`).emit('msg', fullMsg);
    });
  });

  socket.on('delete_msg', (id, groupId) => {
    db.run("DELETE FROM messages WHERE id = ?", [id], () => {
      io.to(`group_${groupId}`).emit('msg_deleted', id);
    });
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Сервер запущен`));