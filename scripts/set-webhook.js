require('dotenv').config();
const fetch = require('node-fetch');

const deployedUrl = process.argv[2];
if (!deployedUrl) {
  console.error('Usage: node scripts/set-webhook.js https://your-project.vercel.app');
  process.exit(1);
}

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN not found in .env');
  process.exit(1);
}

const webhookUrl = `${deployedUrl.replace(/\/$/, '')}/api/webhook`;

fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`)
  .then((r) => r.json())
  .then((data) => console.log(data))
  .catch((err) => console.error(err));
