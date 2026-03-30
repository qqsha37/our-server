const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Подключаемся к MongoDB (локальной или в облаке)
mongoose.connect('mongodb://127.0.0.1:27017/messenger')
  .then(() => console.log("БД подключена"))
  .catch(err => console.log("Ошибка БД:", err));

// Схема сообщения
const MessageSchema = new mongoose.Schema({
  user: String,
  text: String,
  timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

io.on('connection', async (socket) => {
  console.log('User connected:', socket.id);

  // 1. При подключении отправляем историю сообщений
  const history = await Message.find().sort({ timestamp: 1 }).limit(50);
  socket.emit('load_history', history);

  // 2. Слушаем новое сообщение
  socket.on('send_message', async (data) => {
    const newMessage = new Message({ user: data.user, text: data.text });
    await newMessage.save(); // Сохраняем в базу
    io.emit('receive_message', newMessage); // Рассылаем всем
  });
});

server.listen(3000, '0.0.0.0', () => console.log(`Сервер: http://192.168.64.186:3000`));