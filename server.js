const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const app = express();
const server = http.createServer(app);

// Настройка CORS важна для того, чтобы мобильное приложение могло подключиться
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

(async () => {
  // Инициализация базы данных SQLite
  const db = await open({
    filename: './database.sqlite',
    driver: sqlite3.Database
  });

  // Создание таблицы сообщений
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT,
      text TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  io.on('connection', async (socket) => {
    console.log('User connected:', socket.id);

    // Отправляем историю при подключении
    try {
      const history = await db.all("SELECT user, text FROM messages ORDER BY timestamp ASC LIMIT 50");
      socket.emit('load_history', history);
    } catch (err) {
      console.log("History error:", err);
    }

    // Обработка нового сообщения
    socket.on('send_message', async (data) => {
      if (data.user && data.text) {
        await db.run("INSERT INTO messages (user, text) VALUES (?, ?)", [data.user, data.text]);
        io.emit('receive_message', data); // Рассылка всем
      }
    });

    socket.on('disconnect', () => {
      console.log('User disconnected');
    });
  });

  // Render сам подставит нужный PORT
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
  });
})();