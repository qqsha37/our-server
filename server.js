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
const io = new Server(server, { 
    cors: { origin: "*", methods: ["GET", "POST"] } 
});

const db = new sqlite3.Database(path.resolve(__dirname, 'database.sqlite'));

db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password TEXT)");
    db.run("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, user TEXT, text TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)");
});

// Регистрация
app.post('/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Заполни все поля" });
    
    db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, password], function(err) {
        if (err) return res.status(400).json({ error: "Имя уже занято" });
        res.json({ success: true });
    });
});

// Вход
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE username = ? AND password = ?", [username, password], (err, row) => {
        if (row) res.json({ success: true, username: row.username });
        else res.status(401).json({ error: "Неверный логин или пароль" });
    });
});

io.on('connection', (socket) => {
    db.all("SELECT user, text FROM messages ORDER BY timestamp ASC LIMIT 50", (err, rows) => {
        if (!err) socket.emit('load_history', rows);
    });

    socket.on('send_message', (data) => {
        db.run("INSERT INTO messages (user, text) VALUES (?, ?)", [data.user, data.text]);
        io.emit('receive_message', data);
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Server running on port ${PORT}`));