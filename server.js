const express = require('express');
const { Telegraf } = require('telegraf');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

// Настройка middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Настройка Telegram-бота
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;
const bot = new Telegraf(botToken);

// Хранилище статусов заказов (для демонстрации, в реальном приложении используйте БД)
const orderStatuses = {};

// Эндпоинт для получения заказа
app.post('/order', async (req, res) => {
  try {
    const {
      id,
      firstName,
      lastName,
      passport,
      phone,
      email,
      additional,
      amount,
      items,
      photo
    } = req.body;

    // Формирование сообщения для Telegram
    const itemList = items.map(item => `${item.name} - ${item.price} ₽ x ${item.quantity}`).join('\n');
    const message = `
📋 Новый заказ ${id}
👤 Имя: ${firstName} ${lastName}
🛂 Паспорт: ${passport}
📞 Телефон: ${phone}
📧 Email: ${email}
ℹ️ Дополнительно: ${additional || 'Нет'}
💰 Сумма: ${amount} ₽
🛒 Услуги:
${itemList}
    `;

    // Отправка сообщения
    await bot.telegram.sendMessage(chatId, message);

    // Отправка фото, если есть
    if (photo) {
      const buffer = Buffer.from(photo.split(',')[1], 'base64');
      await bot.telegram.sendPhoto(chatId, { source: buffer }, { caption: `Фото оплаты для заказа ${id}` });
    }

    // Сохранение статуса заказа (для демонстрации)
    orderStatuses[id] = { status: 'pending' };

    res.status(200).json({ orderId: id });
  } catch (error) {
    console.error('Ошибка при обработке заказа:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Эндпоинт для проверки статуса заказа
app.get('/status/:orderId', (req, res) => {
  const { orderId } = req.params;
  const status = orderStatuses[orderId] || { status: 'pending' };
  res.status(200).json(status);
});

// Запуск сервера
app.listen(port, () => {
  console.log(`Сервер запущен на порту ${port}`);
});

// Запуск бота
bot.launch().then(() => {
  console.log('Telegram-бот запущен');
}).catch(err => {
  console.error('Ошибка запуска бота:', err);
});

// Обработка graceful shutdown
process.on('SIGINT', () => {
  bot.stop('SIGINT');
  process.exit(0);
});
process.on('SIGTERM', () => {
  bot.stop('SIGTERM');
  process.exit(0);
});
