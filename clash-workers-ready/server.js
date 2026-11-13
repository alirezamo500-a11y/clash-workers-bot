const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const DB_FILE = path.join(__dirname, 'data.json');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return {}; }
}
function writeDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function validTelegramInitData(initData) {
  if (!BOT_TOKEN || !initData) return false;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return false;
    params.delete('hash');
    const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const calculated = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
    return hash.length === calculated.length && crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(calculated, 'hex'));
  } catch { return false; }
}
function getUser(req, res, next) {
  const initData = req.headers['x-telegram-init-data'] || '';
  if (!validTelegramInitData(initData)) return res.status(401).json({ error: 'لطفاً برنامه را از داخل تلگرام باز کنید.' });
  try {
    const user = JSON.parse(new URLSearchParams(initData).get('user') || '{}');
    if (!user.id) throw new Error('no user');
    req.userId = String(user.id); next();
  } catch { return res.status(401).json({ error: 'اطلاعات کاربر تلگرام معتبر نیست.' }); }
}
async function sendTelegram(chatId, text) {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
  } catch (e) { console.error('Telegram send failed:', e.message); }
}
app.get('/api/state', getUser, (req, res) => {
  const db = readDB();
  res.json(db[req.userId] || { accounts: [] });
});
app.post('/api/state', getUser, (req, res) => {
  const db = readDB();
  const body = req.body || {};
  if (!Array.isArray(body.accounts)) return res.status(400).json({ error: 'ساختار اطلاعات درست نیست.' });
  db[req.userId] = { accounts: body.accounts.slice(0, 20) };
  writeDB(db); res.json({ ok: true });
});
app.get('/health', (_req, res) => res.send('OK'));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

setInterval(async () => {
  const db = readDB(); let changed = false; const now = Date.now();
  for (const [userId, data] of Object.entries(db)) {
    for (const account of (data.accounts || [])) {
      for (const timer of (account.timers || [])) {
        if (!timer.notified && Number(timer.endAt) <= now) {
          await sendTelegram(userId, `⏰ زمان ارتقای سازنده تمام شد!\nاکانت: ${account.name || 'بدون نام'}\nسازنده: ${timer.builder || 'سازنده'}`);
          timer.notified = true; changed = true;
        }
      }
    }
  }
  if (changed) writeDB(db);
}, 15000);

app.listen(PORT, () => console.log(`Clash Workers running on ${PORT}`));
