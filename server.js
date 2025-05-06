const express = require('express');
const { Telegraf } = require('telegraf');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

// Настройка middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Настройка Telegram-бота
const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
const chatId = process.env.TELEGRAM_CHAT_ID || '';
const bot = new Telegraf(botToken);

// Список администраторов Telegram (их user ID)
const adminIds = [123456789, 987654321]; // Замените на реальные user ID администраторов

// Хранилище статусов заказов
const orderStatuses = {};

// Логирование для диагностики
console.log('Starting server...');
console.log('Bot token:', botToken ? 'Set' : 'Not set');
console.log('Chat ID:', chatId ? 'Set' : 'Not set');

// Эндпоинт для получения заказа
app.post('/order', async (req, res) => {
  try {
    const {
      id,
      firstName,
      lastName,
      passport,
      phone,
      discord,
      additional,
      amount,
      items,
      photo
    } = req.body;

    console.log('Received order:', id, firstName, lastName);

    // Формирование сообщения для Telegram
    const itemList = items.map(item => `${item.name} - ${item.price} ₽ x ${item.quantity}`).join('\n');
    const message = `
📋 Новый заказ ${id}
👤 Имя: ${firstName} ${lastName}
🛂 Паспорт: ${passport}
📞 Телефон: ${phone}
🌐 Discord: ${discord}
ℹ️ Дополнительно: ${additional || 'Нет'}
💰 Сумма: ${amount} ₽
🛒 Услуги:
${itemList}
    `;

    // Отправка сообщения
    console.log('Sending message to Telegram:', message);
    await bot.telegram.sendMessage(chatId, message).catch(err => {
      console.error('Error sending message:', err);
      throw err;
    });

    // Отправка фото, если есть
    if (photo) {
      console.log('Sending photo to Telegram');
      const buffer = Buffer.from(photo.split(',')[1], 'base64');
      await bot.telegram.sendPhoto(chatId, { source: buffer }, { caption: `Фото оплаты для заказа ${id}` }).catch(err => {
        console.error('Error sending photo:', err);
        throw err;
      });
    }

    // Сохранение статуса заказа
    orderStatuses[id] = { status: 'pending' };
    console.log('Order status saved:', id, orderStatuses[id]);

    res.status(200).json({ orderId: id });
  } catch (error) {
    console.error('Error processing order:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Эндпоинт для проверки статуса заказа
app.get('/status/:orderId', (req, res) => {
  const { orderId } = req.params;
  const status = orderStatuses[orderId] || { status: 'pending' };
  console.log('Status check for:', orderId, status);
  res.status(200).json(status);
});

// Эндпоинт для обновления статуса заказа
app.post('/update-status/:orderId', (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;
  console.log('Updating status for:', orderId, status);

  if (['approved', 'rejected'].includes(status)) {
    orderStatuses[orderId] = { status };
    console.log('Status updated:', orderId, orderStatuses[orderId]);
    res.status(200).json({ status });
  } else {
    console.error('Invalid status:', status);
    res.status(400).json({ error: 'Неверный статус' });
  }
});

// Telegram-бот: команды для управления статусами
bot.command('approve', async (ctx) => {
  const userId = ctx.from.id;
  console.log('Approve command from:', userId);
  if (!adminIds.includes(userId)) {
    console.log('Unauthorized approve attempt by:', userId);
    await ctx.reply('У вас нет прав для выполнения этой команды.');
    return;
  }

  const orderId = ctx.message.text.split(' ')[1];
  if (orderId && orderStatuses[orderId]) {
    orderStatuses[orderId] = { status: 'approved' };
    console.log('Bot approved order:', orderId);
    await ctx.reply(`Заказ ${orderId} подтвержден`);
  } else {
    console.log('Invalid or missing orderId:', orderId);
    await ctx.reply('Укажите действительный ID заказа, например: /approve #1234');
  }
});

bot.command('reject', async (ctx) => {
  const userId = ctx.from.id;
  console.log('Reject command from:', userId);
  if (!adminIds.includes(userId)) {
    console.log('Unauthorized reject attempt by:', userId);
    await ctx.reply('У вас нет прав для выполнения этой команды.');
    return;
  }

  const orderId = ctx.message.text.split(' ')[1];
  if (orderId && orderStatuses[orderId]) {
    orderStatuses[orderId] = { status: 'rejected' };
    console.log('Bot rejected order:', orderId);
    await ctx.reply(`Заказ ${orderId} отклонен`);
  } else {
    console.log('Invalid or missing orderId:', orderId);
    await ctx.reply('Укажите действительный ID заказа, например: /reject #1234');
  }
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
