require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const CONFIG_EXAMPLE_PATH = path.join(ROOT, 'config.example.json');
const DEFAULT_GUILD_ID = '1352675653798989947';

const configFile = fs.existsSync(CONFIG_PATH) ? CONFIG_PATH : CONFIG_EXAMPLE_PATH;
if (!fs.existsSync(configFile)) {
  console.error('Missing config.json and config.example.json.');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const token = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN;
const guildId = process.env.GUILD_ID || config.guildId || DEFAULT_GUILD_ID;

if (!token) {
  console.error('Missing DISCORD_TOKEN.');
  console.error('On Railway: open this service \u2192 Variables \u2192 add DISCORD_TOKEN \u2192 Redeploy.');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const sessions = new Map();

const COLORS = {
  gold: 0xc4a35a,
  dark: 0x111315,
  green: 0x1f6b3a,
  red: 0x8b1e1e,
};

const PATH_LABELS = {
  starship: 'Starship Troopers',
  hllv: 'Hell Let Loose: Vietnam',
  ambassador: 'Ambassador',
  returning: 'Returning Member',
};

function asset(name) {
  return path.join(ROOT, 'assets', name);
}

function cardFile(name) {
  return path.join(ROOT, 'assets', 'cards', name);
}

const CARD_NAMES = [
  'step1.png',
  'step2.png',
  'step3-platform.png',
  'step3-rules-ambassador.png',
  'step3-rules-returning.png',
  'step4-experience.png',
  'step4-name.png',
  'step4-community.png',
  'step4-rank.png',
  'complete.png',
  'paused.png',
];

function readCardBase64(dir, name) {
  const b64Path = path.join(dir, `${name}.b64`);
  if (fs.existsSync(b64Path)) {
    const raw = fs.readFileSync(b64Path, 'utf8').trim();
    if (raw.length > 100) return raw.replace(/\s+/g, '');
  }

  const parts = fs.readdirSync(dir)
    .filter(file => file.startsWith(`${name}.b64.p`))
    .sort();
  if (!parts.length) return null;
  return parts.map(file => fs.readFileSync(path.join(dir, file), 'utf8').trim()).join('').replace(/\s+/g, '');
}

function ensureCards() {
  const dir = path.join(ROOT, 'assets', 'cards');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of CARD_NAMES) {
    const pngPath = path.join(dir, name);
    if (fs.existsSync(pngPath)) continue;
    const b64 = readCardBase64(dir, name);
    if (!b64) continue;
    try {
      fs.writeFileSync(pngPath, Buffer.from(b64, 'base64'));
    } catch (err) {
      console.warn(`Could not decode ${name}:`, err.message);
    }
  }
}

ensureCards();
