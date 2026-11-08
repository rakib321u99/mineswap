// Telegram Bot API client — plain fetch, no dependencies.
// All calls use BOT_TOKEN from env. Nothing here is called with a real
// token during local tests (tests never import this module).
'use strict';

const { config } = require('./config');

function apiUrl(method) {
  return `https://api.telegram.org/bot${config.botToken}/${method}`;
}

async function tgCall(method, params) {
  if (!config.botToken) return { ok: false, description: 'BOT_TOKEN not configured' };
  const res = await fetch(apiUrl(method), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params || {}),
  });
  const data = await res.json().catch(() => ({}));
  return data;
}

async function sendMessage(chatId, text, extra = {}) {
  return tgCall('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
}

async function answerCallbackQuery(id, text = '', showAlert = false) {
  return tgCall('answerCallbackQuery', { callback_query_id: id, text, show_alert: showAlert });
}

async function editMessageText(chatId, messageId, text, extra = {}) {
  return tgCall('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', ...extra });
}

// Returns the getChatMember status string ('member', 'left', 'kicked',
// 'creator', 'administrator', ...) or '' on any error (fail closed).
async function getChatMemberStatus(chatIdOrUsername, userId) {
  const res = await tgCall('getChatMember', { chat_id: chatIdOrUsername, user_id: userId });
  if (!res || res.ok !== true || !res.result) return '';
  return String(res.result.status || '');
}

module.exports = { tgCall, sendMessage, answerCallbackQuery, editMessageText, getChatMemberStatus };
