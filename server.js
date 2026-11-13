const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, "data.json");

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

function readDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch { return {}; }
}
function writeDB(db) {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}
function validateInitData(initData) {
  if (!BOT_TOKEN || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const calculated = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(calculated, "hex"))) return null;
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;
  try { return JSON.parse(params.get("user") || "{}"); } catch { return null; }
}
function auth(req, res, next) {
  const user = validateInitData(req.get("x-telegram-init-data"));
  if (!user || !user.id) return res.status(401).json({ error: "لطفاً برنامه را از داخل تلگرام باز کن." });
  req.userId = String(user.id);
  next();
}
async function telegramSend(chatId, text) {
  if (!BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/data", auth, (req, res) => {
  const db = readDB();
  const user = db[req.userId] || { accounts: [], timers: [] };
  res.json(user);
});
app.post("/api/accounts", auth, (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 40);
  const townHall = String(req.body.townHall || "").trim().slice(0, 10);
  if (!name) return res.status(400).json({ error: "اسم اکانت را وارد کن." });
  const db = readDB();
  db[req.userId] ||= { accounts: [], timers: [] };
  const id = crypto.randomUUID();
  db[req.userId].accounts.push({ id, name, townHall });
  writeDB(db);
  res.json({ ok: true, id });
});
app.delete("/api/accounts/:id", auth, (req, res) => {
  const db = readDB(), user = db[req.userId];
  if (user) {
    user.accounts = user.accounts.filter(x => x.id !== req.params.id);
    user.timers = user.timers.filter(x => x.accountId !== req.params.id);
    writeDB(db);
  }
  res.json({ ok: true });
});
app.post("/api/timers", auth, (req, res) => {
  const { accountId, worker, task, minutes } = req.body || {};
  const mins = Number(minutes);
  if (!accountId || !worker || !task || !Number.isFinite(mins) || mins <= 0 || mins > 100000)
    return res.status(400).json({ error: "اطلاعات زمان‌سنج کامل و معتبر نیست." });
  const db = readDB(), user = db[req.userId];
  if (!user || !user.accounts.some(x => x.id === accountId))
    return res.status(400).json({ error: "اکانت پیدا نشد." });
  const id = crypto.randomUUID();
  user.timers.push({ id, accountId, worker: String(worker).slice(0, 30),
    task: String(task).slice(0, 80), endsAt: Date.now() + mins * 60000, notified: false });
  writeDB(db);
  res.json({ ok: true, id });
});
app.delete("/api/timers/:id", auth, (req, res) => {
  const db = readDB(), user = db[req.userId];
  if (user) { user.timers = user.timers.filter(x => x.id !== req.params.id); writeDB(db); }
  res.json({ ok: true });
});

setInterval(async () => {
  const db = readDB();
  let changed = false;
  for (const [userId, user] of Object.entries(db)) {
    for (const timer of user.timers || []) {
      if (!timer.notified && timer.endsAt <= Date.now()) {
        const account = (user.accounts || []).find(a => a.id === timer.accountId);
        await telegramSend(userId, `⏰ زمان ارتقای کارگر تمام شد!\nاکانت: ${account?.name || "نامشخص"}\nکارگر: ${timer.worker}\nارتقا: ${timer.task}`);
        timer.notified = true;
        changed = true;
      }
    }
  }
  if (changed) writeDB(db);
}, 15000);

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
