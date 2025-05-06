const express = require('express');
const { Telegraf } = require('telegraf');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
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
const adminIds = [729406890]; // Замените на реальные user ID администраторов

// Путь к файлу для сохранения заказов
const ordersFilePath = path.join(__dirname, 'orders.json');

// Хранилище статусов заказов
let orderStatuses = {};

// Загрузка заказов из файла при старте
async function loadOrders() {
  try {
    const data = await fs.readFile(ordersFilePath, 'utf8');
    orderStatuses = JSON.parse(data);
    console.log('Loaded orders from file:', Object.keys(orderStatuses));
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('Orders file not found, starting with empty orderStatuses');
    } else {
      console.error('Error loading orders:', error);
    }
  }
}

// Сохранение заказов в файл
async function saveOrders() {
  try {
    await fs.writeFile(ordersFilePath, JSON.stringify(orderStatuses, null, 2));
    console.log('Orders saved to file:', Object.keys(orderStatuses));
  } catch (error) {
    console.error('Error saving orders:', error);
  }
}

// Логирование для диагностики
console.log('Starting server...');
console.log('Bot token:', botToken ? 'Set' : 'Not set');
console.log('Chat ID:', chatId ? 'Set' : 'Not set');

// Загрузка заказов при старте
loadOrders();

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

    console.log('Received order:', { id, firstName, lastName, passport, phone, discord, amount, items });

    // Проверка валидности ID заказа
    if (!id || !id.startsWith('#') || id.length !== 5) {
      console.error('Invalid order ID:', id);
      return res.status(400).json({ error: 'Неверный формат ID заказа, ожидается #XXXX' });
    }

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

    // Отправка сообщения в Telegram
    try {
      console.log('Sending message to Telegram:', message);
      await bot.telegram.sendMessage(chatId, message);
      console.log('Message sent to Telegram');
    } catch (error) {
      console.error('Error sending message to Telegram:', error);
      // Ошибка Telegram не прерывает сохранение заказа
    }

    // Отправка фото, если есть
    if (photo) {
      try {
        console.log('Sending photo to Telegram for order:', id);
        const buffer = Buffer.from(photo.split(',')[1], 'base64');
        await bot.telegram.sendPhoto(chatId, { source: buffer }, { caption: `Фото оплаты для заказа ${id}` });
        console.log('Photo sent to Telegram');
      } catch (error) {
        console.error('Error sending photo to Telegram:', error);
        // Ошибка Telegram не прерывает сохранение заказа
      }
    }

    // Сохранение статуса заказа
    orderStatuses[id] = { status: 'pending', data: { firstName, lastName, passport, phone, discord, amount, items } };
    console.log('Order status saved:', id, orderStatuses[id]);
    console.log('Current orderStatuses:', Object.keys(orderStatuses));

    // Сохранение в файл
    await saveOrders();

    res.status(200).json({ orderId: id });
  } catch (error) {
    console.error('Error processing order:', error);
    res.status(500).json({ error: 'Ошибка сервера при обработке заказа' });
  }
});

// Эндпоинт для проверки статуса заказа
app.get('/status/:orderId', (req, res) => {
  const { orderId } = req.params;
  console.log('Status check requested for:', orderId);
  const status = orderStatuses[orderId];
  if (status) {
    console.log('Returning status:', status);
    res.status(200).json(status);
  } else {
    console.log('Order not found:', orderId, 'Available orders:', Object.keys(orderStatuses));
    res.status(404).json({ status: 'pending', error: 'Order not found' });
  }
});

// Эндпоинт для получения всех заказов (для диагностики)
app.get('/orders', (req, res) => {
  console.log('Fetching all orders:', Object.keys(orderStatuses));
  res.status(200).json(orderStatuses);
});

// Эндпоинт для обновления статуса заказа
app.post('/update-status/:orderId', (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;
  console.log('Updating status for:', orderId, status);

  if (['approved', 'rejected'].includes(status)) {
    if (orderStatuses[orderId]) {
      orderStatuses[orderId] = { ...orderStatuses[orderId], status };
      console.log('Status updated:', orderId, orderStatuses[orderId]);
      saveOrders();
      res.status(200).json({ status });
    } else {
      console.log('Order not found:', orderId);
      res.status(404).json({ error: 'Order not found' });
    }
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

  let orderId = ctx.message.text.split(' ')[1]?.trim();
  if (orderId) {
    // Нормализация ID
    if (!orderId.startsWith('#')) {
      orderId = `#${orderId.padStart(4, '0')}`;
    }
    console.log('Parsed orderId:', orderId);
    if (orderStatuses[orderId]) {
      orderStatuses[orderId].status = 'approved';
      console.log('Bot approved order:', orderId, orderStatuses[orderId]);
      await saveOrders();
      await ctx.reply(`Заказ ${orderId} подтвержден`);
    } else {
      console.log('Order not found:', orderId, 'Available orders:', Object.keys(orderStatuses));
      await ctx.reply(`Заказ ${orderId} не найден. Доступные заказы: ${Object.keys(orderStatuses).join(', ') || 'нет'}`);
    }
  } else {
    console.log('Missing orderId');
    await ctx.reply('Укажите ID заказа, например: /approve #1234');
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

  let orderId = ctx.message.text.split(' ')[1]?.trim();
  if (orderId) {
    // Нормализация ID
    if (!orderId.startsWith('#')) {
      orderId = `#${orderId.padStart(4, '0')}`;
    }
    console.log('Parsed orderId:', orderId);
    if (orderStatuses[orderId]) {
      orderStatuses[orderId].status = 'rejected';
      console.log('Bot rejected order:', orderId, orderStatuses[orderId]);
      await saveOrders();
      await ctx.reply(`Заказ ${orderId} отклонен`);
    } else {
      console.log('Order not found:', orderId, 'Available orders:', Object.keys(orderStatuses));
      await ctx.reply(`Заказ ${orderId} не найден. Доступные заказы: ${Object.keys(orderStatuses).join(', ') || 'нет'}`);
    }
  } else {
    console.log('Missing orderId');
    await ctx.reply('Укажите ID заказа, например: /reject #1234');
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
process.on('SIGINT', async () => {
  await saveOrders();
  bot.stop('SIGINT');
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await saveOrders();
  bot.stop('SIGTERM');
  process.exit(0);
});
