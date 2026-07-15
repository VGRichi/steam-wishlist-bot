const fetch = require('node-fetch');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API_BASE = `https://api.telegram.org/bot${TOKEN}`;

async function sendMessage(chatId, text, replyMarkup = null) {
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
  };
  if (replyMarkup) body.reply_markup = replyMarkup;

  const res = await fetch(`${API_BASE}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // Don't throw - a single failed notification shouldn't crash a cron run
    console.error('Telegram sendMessage failed:', await res.text());
  }
  return res;
}

async function answerCallbackQuery(callbackQueryId, text = '') {
  await fetch(`${API_BASE}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  });
}

function inlineKeyboard(buttons) {
  // buttons: array of { text, callback_data }
  return { inline_keyboard: buttons.map((b) => [b]) };
}

module.exports = { sendMessage, answerCallbackQuery, inlineKeyboard };
