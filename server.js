const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const multer = require('multer');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 3001;

const botToken = process.env.BOT_TOKEN;
const adminId = process.env.ADMIN_ID;

const bot = new TelegramBot(botToken);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

const upload = multer({ dest: 'uploads/' }); // For screenshots

const USER_DATA_FILE = path.join(__dirname, 'users.json');

function loadUsers() {
  if (fs.existsSync(USER_DATA_FILE)) {
    return JSON.parse(fs.readFileSync(USER_DATA_FILE, 'utf8'));
  }
  return {};
}

function saveUsers(users) {
  fs.writeFileSync(USER_DATA_FILE, JSON.stringify(users, null, 2));
}

// Register
app.post('/register', async (req, res) => {
  const { username, email, referral, password } = req.body;

  const users = loadUsers();

  const existing = Object.values(users).find(u => u.username === username || u.email === email);
  if (existing) {
    return res.redirect('/?error=Username or email taken');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const userId = Date.now().toString();

  const newUser = {
    id: userId,
    username,
    email,
    passwordHash,
    balance: 0.05, // Welcome bonus
    taskBalance: 0,
    invites: 0,
    referred_by: referral || null,
    tonAddress: '',
    withdrawals: []
  };

  if (referral) {
    const referrer = Object.values(users).find(u => u.username === referral);
    if (referrer) {
      users[referrer.id].balance += 0.01; // Referral bonus
      users[referrer.id].invites += 1;
      bot.sendMessage(adminId, `New referral: ${username} by ${referrer.username}`);
    }
  }

  users[userId] = newUser;
  saveUsers(users);

  res.redirect('/dashboard.html');
});

// Submit task proof
app.post('/submit-proof', upload.single('proof'), (req, res) => {
  const userId = req.body.userId; // Assume userID from session, for now dummy
  const file = req.file;

  if (file) {
    bot.sendPhoto(adminId, file.path, { caption: `Task proof from user \( {userId}. Approve? Reply with /approve_ \){userId} or /decline_${userId}` });
    res.json({ success: true });
  }
});

// Bot for admin approvals
bot.onText(/\/approve_(\d+)/, (msg, match) => {
  const userId = match[1];
  const users = loadUsers();
  if (users[userId]) {
    users[userId].taskBalance += 0.01;
    saveUsers(users);
    bot.sendMessage(msg.chat.id, `Approved for user ${userId}`);
  }
});

bot.onText(/\/decline_(\d+)/, (msg, match) => {
  const userId = match[1];
  bot.sendMessage(msg.chat.id, `Declined for user ${userId}`);
});

// Withdraw
app.post('/withdraw', (req, res) => {
  const userId = req.body.userId; // Dummy, add session later
  const amount = req.body.amount;
  const users = loadUsers();
  const user = users[userId];

  if (user.balance < 0.05) {
    return res.json({ error: 'Not eligible' });
  } if (amount > 0.5) {
    return res.json({ error: 'Max 0.5 TON' });
  }

  user.withdrawals.push({ amount, status: 'Pending' });
  saveUsers(users);

  bot.sendMessage(adminId, `Withdraw request from ${user.username}: ${amount} TON to \( {user.tonAddress}. /approve_withdraw_ \){userId}_\( {amount} or /decline_withdraw_ \){userId}_${amount}`);

  res.json({ success: true });
});

// Bot for withdraw approvals
bot.onText(/\/approve_withdraw_(\d+)_([\d.]+)/, (msg, match) => {
  const userId = match[1];
  const amount = match[2];
  const users = loadUsers();
  const user = users[userId];
  if (user) {
    user.balance -= amount;
    user.withdrawals[user.withdrawals.length - 1].status = 'Approved';
    saveUsers(users);
    bot.sendMessage(msg.chat.id, `Approved withdraw for ${user.username}`);
  }
});

bot.onText(/\/decline_withdraw_(\d+)_([\d.]+)/, (msg, match) => {
  const userId = match[1];
  const amount = match[2];
  const users = loadUsers();
  const user = users[userId];
  if (user) {
    user.withdrawals[user.withdrawals.length - 1].status = 'Declined';
    saveUsers(users);
    bot.sendMessage(msg.chat.id, `Declined withdraw for ${user.username}`);
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'signup.html'));
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
