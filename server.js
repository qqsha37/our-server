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
      description TEXT,
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

    // НОВЫЕ ТАБЛИЦЫ ДЛЯ ДРУЗЕЙ И УЧАСТНИКОВ ГРУПП
    db.run(`CREATE TABLE IF NOT EXISTS contacts (
      user_id INTEGER,
      contact_id INTEGER,
      PRIMARY KEY (user_id, contact_id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS group_members (
      group_id INTEGER,
      user_id INTEGER,
      PRIMARY KEY (group_id, user_id)
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
      if (err) return res.status(400).json({ error: "Email или Username уже заняты" });
      res.json({ success: true, id: this.lastID });
    });
});

app.post('/login', (req, res) => {
  const email = req.body.email.trim().toLowerCase();
  const password = req.body.password.trim();
  db.get("SELECT * FROM users WHERE email = ? AND password = ?", [email, password], (err, row) => {
    if (err) return res.status(500).json({ error: "Ошибка БД" });
    if (row) res.json({ success: true, ...row });
    else res.status(401).json({ error: "Неверная почта или пароль" });
  });
});

app.get('/users/search/:username', (req, res) => {
  let q = req.params.username.trim();
  const nick = q.startsWith('@') ? q.toLowerCase() : `@${q.toLowerCase()}`;
  
  // Используем LOWER в SQL для поиска без учета регистра
  db.get("SELECT id, username, display_name FROM users WHERE LOWER(username) = ?", [nick], (err, row) => {
    if (err) return res.status(500).json({ error: "Ошибка БД" });
    if (row) {
      res.json(row);
    } else {
      res.status(404).json({ error: "Пользователь не найден" });
    }
  });
});

// НОВЫЙ ЭНДПОИНТ: Добавить в друзья
app.post('/contacts/add', (req, res) => {
  const { user_id, contact_id } = req.body;
  if (user_id === contact_id) return res.status(400).json({ error: "Нельзя добавить себя" });
  
  db.run("INSERT OR IGNORE INTO contacts (user_id, contact_id) VALUES (?, ?)", [user_id, contact_id], (err) => {
    if (err) return res.status(500).json({ error: "Ошибка БД" });
    res.json({ success: true });
  });
});

// НОВЫЙ ЭНДПОИНТ: Получить список друзей
app.get('/contacts/:uid', (req, res) => {
  db.all(`
    SELECT u.id, u.username, u.display_name 
    FROM contacts c 
    JOIN users u ON c.contact_id = u.id 
    WHERE c.user_id = ?
  `, [req.params.uid], (err, rows) => {
    res.json(rows || []);
  });
});

// НОВЫЙ ЭНДПОИНТ: Создать группу
app.post('/groups/create', (req, res) => {
  const { name, description, owner_id, members } = req.body;
  
  db.run("INSERT INTO groups (name, description, owner_id) VALUES (?, ?, ?)", [name, description, owner_id], function(err) {
    if (err) return res.status(500).json({ error: "Ошибка создания" });
    const groupId = this.lastID;
    
    // Добавляем создателя и выбранных друзей в группу
    let allMembers = [owner_id, ...(members || [])];
    allMembers = [...new Set(allMembers)]; // Убираем дубликаты
    
    const placeholders = allMembers.map(() => "(?, ?)").join(",");
    const values = allMembers.flatMap(uid => [groupId, uid]);
    
    db.run(`INSERT INTO group_members (group_id, user_id) VALUES ${placeholders}`, values, () => {
      res.json({ success: true, id: groupId });
    });
  });
});

// НОВЫЙ ЭНДПОИНТ: Получить список чатов пользователя
app.get('/my-chats/:uid', (req, res) => {
  // Выводим Общий чат (owner=0) ИЛИ те чаты, где юзер есть в участниках
  db.all(`
    SELECT g.* FROM groups g
    LEFT JOIN group_members gm ON g.id = gm.group_id
    WHERE g.owner_id = 0 OR gm.user_id = ?
    GROUP BY g.id
  `, [req.params.uid], (err, rows) => {
    res.json(rows || []);
  });
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