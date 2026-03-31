require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { 
  cors: { origin: "*" },
  pingTimeout: 60000 
});

// --- ПОДКЛЮЧЕНИЕ К БАЗЕ ДАННЫХ ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    // ВАЖНО: это исправляет ошибку "self-signed certificate"
    rejectUnauthorized: false 
  },
  connectionTimeoutMillis: 10000 // Ждем 10 сек до ошибки
});

// Проверка подключения при старте
const checkConnection = async () => {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log("✅ СВЯЗЬ С SUPABASE УСТАНОВЛЕНА:", res.rows[0].now);
  } catch (err) {
    console.error("❌ ОШИБКА ПОДКЛЮЧЕНИЯ К БД:", err.message);
    console.log("Подсказка: Проверь пароль и порт 6543 в настройках Render.");
  }
};
checkConnection();

// --- API ЭНДПОИНТЫ ---

// Регистрация
app.post('/register', async (req, res) => {
  let { email, display_name, username, password } = req.body;
  try {
    const cleanEmail = email.trim().toLowerCase();
    let cleanUsername = username.trim().toLowerCase();
    if (!cleanUsername.startsWith('@')) cleanUsername = `@${cleanUsername}`;

    const result = await pool.query(
      "INSERT INTO users (email, display_name, username, password) VALUES ($1, $2, $3, $4) RETURNING id",
      [cleanEmail, display_name.trim(), cleanUsername, password]
    );
    res.json({ id: result.rows[0].id, success: true });
  } catch (err) {
    console.error("Ошибка регистрации:", err.detail || err.message);
    res.status(400).json({ error: "Email или Username уже заняты" });
  }
});

// Вход
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const cleanEmail = email.trim().toLowerCase();
    const result = await pool.query(
      "SELECT * FROM users WHERE LOWER(email) = $1 AND password = $2", 
      [cleanEmail, password]
    );
    if (result.rows.length > 0) {
      res.json(result.rows[0]);
    } else {
      res.status(401).json({ error: "Неверный email или пароль" });
    }
  } catch (err) {
    res.status(500).json({ error: "Ошибка сервера при входе" });
  }
});

// Обновление профиля
app.post('/update-profile', async (req, res) => {
  const { id, display_name, username } = req.body;
  try {
    let cleanUsername = username.trim().toLowerCase();
    if (!cleanUsername.startsWith('@')) cleanUsername = `@${cleanUsername}`;
    await pool.query(
      "UPDATE users SET display_name = $1, username = $2 WHERE id = $3",
      [display_name.trim(), cleanUsername, id]
    );
    const updated = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
    res.json({ success: true, user: updated.rows[0] });
  } catch (err) {
    res.status(400).json({ error: "Этот юзернейм уже занят" });
  }
});

// Список чатов пользователя
app.get('/my-chats/:uid', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT g.* FROM groups g JOIN group_members gm ON g.id = gm.group_id WHERE gm.user_id = $1",
      [req.params.uid]
    );
    res.json(result.rows);
  } catch (err) {
    res.json([]);
  }
});

// Создание группы/чата
app.post('/groups/create', async (req, res) => {
  const { name, owner_id, members, is_private } = req.body;
  try {
    const groupRes = await pool.query(
      "INSERT INTO groups (name, owner_id, is_private) VALUES ($1, $2, $3) RETURNING id",
      [name, owner_id, is_private]
    );
    const gid = groupRes.rows[0].id;
    const allMembers = Array.from(new Set([owner_id, ...members]));
    for (let uid of allMembers) {
      await pool.query("INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)", [gid, uid]);
    }
    res.json({ id: gid });
  } catch (err) {
    res.status(500).json({ error: "Ошибка создания чата" });
  }
});

// Список контактов
app.get('/contacts/:uid', async (req, res) => {
  try {
    const result = await pool.query("SELECT id, display_name, username FROM users WHERE id != $1", [req.params.uid]);
    res.json(result.rows);
  } catch (err) {
    res.json([]);
  }
});

// --- WEB SOCKETS ---
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('join', async (gid) => {
    socket.join(`room_${gid}`);
    try {
      const history = await pool.query(
        "SELECT * FROM messages WHERE group_id = $1 ORDER BY timestamp ASC", 
        [gid]
      );
      socket.emit('history', history.rows);
    } catch (err) {
      console.error("Ошибка загрузки истории:", err.message);
    }
  });

  socket.on('msg', async (data) => {
    try {
      await pool.query(
        "INSERT INTO messages (group_id, sender_id, sender_name, text) VALUES ($1, $2, $3, $4)",
        [data.group_id, data.sender_id, data.sender_name, data.text]
      );
      io.to(`room_${data.group_id}`).emit('msg', data);
    } catch (err) {
      console.error("Ошибка сохранения сообщения:", err.message);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
  });
});

// Запуск
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});