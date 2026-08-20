/**
 * Per-member message + voice tracking (Statbot-style 1d / 7d / 45d).
 * Counts from the moment this module is running — Discord cannot backfill voice hours.
 */
const fs = require('fs');
const path = require('path');
const {
  SlashCommandBuilder,
  EmbedBuilder,
  Events,
  ChannelType
} = require('discord.js');

const TARGET_GUILD_ID = '1256977709884641382';
const DATA_FILE = path.join(__dirname, 'data', 'activity-stats.json');
const LOOKBACK_DAYS = 45;
const FLUSH_MS = 60 * 1000;

function loadStore() {
  try {
    if (!fs.existsSync(DATA_FILE)) return { days: {}, sessions: {} };
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!data.days || typeof data.days !== 'object') data.days = {};
    if (!data.sessions || typeof data.sessions !== 'object') data.sessions = {};
    return data;
  } catch {
    return { days: {}, sessions: {} };
  }
}

function saveStore() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
}

let store = loadStore();
let dirty = false;

function markDirty() {
  dirty = true;
}

function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function pruneOldDays() {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - (LOOKBACK_DAYS + 2));
  const min = cutoff.toISOString().slice(0, 10);
  for (const key of Object.keys(store.days)) {
    if (key < min) delete store.days[key];
  }
}

function ensureUserDay(uid, key = dayKey()) {
  if (!store.days[key]) store.days[key] = { users: {} };
  if (!store.days[key].users[uid]) {
    store.days[key].users[uid] = { m: 0, v: 0, mc: {}, vc: {} };
  }
  return store.days[key].users[uid];
}

function addVoiceMs(uid, channelId, ms, endedAt = Date.now()) {
  if (ms <= 0) return;
  let remaining = ms;
  let end = endedAt;
  while (remaining > 0) {
    const endDate = new Date(end);
    const startOfDay = Date.UTC(
      endDate.getUTCFullYear(),
      endDate.getUTCMonth(),
      endDate.getUTCDate()
    );
    const inThisDay = Math.min(remaining, end - startOfDay);
    const key = dayKey(new Date(end));
    const rec = ensureUserDay(uid, key);
    rec.v += inThisDay;
    if (channelId) rec.vc[channelId] = (rec.vc[channelId] || 0) + inThisDay;
    remaining -= inThisDay;
    end -= inThisDay;
  }
  markDirty();
}

function closeSession(uid, endedAt = Date.now()) {
  const session = store.sessions[uid];
  if (!session) return;
  addVoiceMs(uid, session.channelId, endedAt - session.startedAt, endedAt);
  delete store.sessions[uid];
}

function openSession(uid, channelId, startedAt = Date.now()) {
  store.sessions[uid] = { channelId, startedAt };
  markDirty();
}

function formatHours(ms) {
  const hours = ms / 3600000;
  if (hours <= 0) return '0 hours';
  if (hours < 0.01) return `${hours.toFixed(3)} hours`;
  if (hours < 10) return `${hours.toFixed(2)} hours`;
  return `${hours.toFixed(1)} hours`;
}

function dayKeysFor(days) {
  const keys = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    keys.push(dayKey(d));
  }
  return keys;
}

function liveVoiceMs(uid, now = Date.now()) {
  const session = store.sessions[uid];
  if (!session) return 0;
  return Math.max(0, now - session.startedAt);
}

function sumUser(uid, days) {
  const now = Date.now();
  const live = liveVoiceMs(uid, now);
  const out = { messages: 0, voiceMs: 0, mc: {}, vc: {} };
  for (const key of dayKeysFor(days)) {
    const rec = store.days[key]?.users?.[uid];
    if (!rec) continue;
    out.messages += rec.m || 0;
    out.voiceMs += rec.v || 0;
    for (const [ch, n] of Object.entries(rec.mc || {})) {
      out.mc[ch] = (out.mc[ch] || 0) + n;
    }
    for (const [ch, n] of Object.entries(rec.vc || {})) {
      out.vc[ch] = (out.vc[ch] || 0) + n;
    }
  }
  if (live && store.sessions[uid]) {
    out.voiceMs += live;
    const ch = store.sessions[uid].channelId;
    if (ch) out.vc[ch] = (out.vc[ch] || 0) + live;
  }
  return out;
}

function allUserIds() {
  const ids = new Set(Object.keys(store.sessions || {}));
  for (const day of Object.values(store.days)) {
    for (const id of Object.keys(day.users || {})) ids.add(id);
  }
  return [...ids];
}

function ranksFor(uid, days) {
  const scored = allUserIds().map((id) => {
    const s = sumUser(id, days);
    return { id, messages: s.messages, voiceMs: s.voiceMs };
  });
  const byMsg = [...scored].sort((a, b) => b.messages - a.messages);
  const byVoice = [...scored].sort((a, b) => b.voiceMs - a.voiceMs);
  const msgRank = byMsg.findIndex((x) => x.id === uid) + 1 || null;
  const voiceRank = byVoice.findIndex((x) => x.id === uid) + 1 || null;
  return {
    msgRank,
    voiceRank,
    msgTotal: byMsg.filter((x) => x.messages > 0).length,
    voiceTotal: byVoice.filter((x) => x.voiceMs > 0).length
  };
}

function topChannels(uid, days) {
  const s = sumUser(uid, days);
  const texts = Object.entries(s.mc).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const voices = Object.entries(s.vc).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return { texts, voices };
}

function statsEmbed(user, days = LOOKBACK_DAYS) {
  const d1 = sumUser(user.id, 1);
  const d7 = sumUser(user.id, 7);
  const d45 = sumUser(user.id, days);
  const ranks = ranksFor(user.id, days);
  const tops = topChannels(user.id, days);

  const msgRank = ranks.msgRank && d45.messages
    ? `#${ranks.msgRank}`
    : 'No Data';
  const voiceRank = ranks.voiceRank && d45.voiceMs
    ? `#${ranks.voiceRank}`
    : 'No Data';

  const topLines = [];
  if (tops.texts[0]) topLines.push(`# <#${tops.texts[0][0]}>  ${tops.texts[0][1]} messages`);
  if (tops.voices[0]) topLines.push(`🔊 <#${tops.voices[0][0]}>  ${formatHours(tops.voices[0][1])}`);
  if (!topLines.length) topLines.push('_No channel activity yet_');

  return new EmbedBuilder()
    .setTitle(`${user.displayName || user.username}`)
    .setColor(0x2b2d31)
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .setDescription(`Activity in **1st Mobile Infantry**`)
    .addFields(
      {
        name: 'Server Ranks',
        value: `Message **${msgRank}**\nVoice **${voiceRank}**`,
        inline: true
      },
      {
        name: 'Messages',
        value: `**1d**  ${d1.messages}\n**7d**  ${d7.messages}\n**45d**  ${d45.messages}`,
        inline: true
      },
      {
        name: 'Voice Activity',
        value: `**1d**  ${formatHours(d1.voiceMs)}\n**7d**  ${formatHours(d7.voiceMs)}\n**45d**  ${formatHours(d45.voiceMs)}`,
        inline: true
      },
      {
        name: 'Top Channels',
        value: topLines.join('\n')
      }
    )
    .setFooter({ text: '1st M.I. • Lookback 45 days (UTC) • Starts from when this bot began tracking' });
}

function topEmbed(type, limit = 15) {
  const scored = allUserIds().map((id) => {
    const s = sumUser(id, LOOKBACK_DAYS);
    return { id, messages: s.messages, voiceMs: s.voiceMs };
  });
  const voice = type === 'voice';
  const rows = scored
    .filter((x) => (voice ? x.voiceMs : x.messages) > 0)
    .sort((a, b) => (voice ? b.voiceMs - a.voiceMs : b.messages - a.messages))
    .slice(0, limit);

  const lines = rows.map((row, i) => {
    const value = voice ? formatHours(row.voiceMs) : `${row.messages} msgs`;
    return `**${i + 1}.** <@${row.id}> — ${value}`;
  });

  return new EmbedBuilder()
    .setTitle(voice ? 'Top voice (45d)' : 'Top messages (45d)')
    .setColor(0x2b2d31)
    .setDescription(lines.join('\n') || '_No data yet._')
    .setFooter({ text: '1st M.I. activity tracker' });
}

async function handleMessageCreate(message) {
  try {
    if (!message.guild || message.guild.id !== TARGET_GUILD_ID) return;
    if (message.author?.bot) return;
    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread, ChannelType.AnnouncementThread].includes(message.channel.type)) {
      if (!message.channel?.isTextBased?.()) return;
    }
    const rec = ensureUserDay(message.author.id);
    rec.m += 1;
    rec.mc[message.channelId] = (rec.mc[message.channelId] || 0) + 1;
    markDirty();
  } catch (err) {
    console.error('[STATS] messageCreate:', err.message);
  }
}

async function handleVoiceState(oldState, newState) {
  try {
    const guildId = newState.guild?.id || oldState.guild?.id;
    if (guildId !== TARGET_GUILD_ID) return;
    const member = newState.member || oldState.member;
    if (!member || member.user?.bot) return;

    const uid = member.id;
    const oldCh = oldState.channelId;
    const newCh = newState.channelId;

    if (oldCh === newCh) return;

    if (oldCh && !newCh) {
      closeSession(uid);
    } else if (!oldCh && newCh) {
      openSession(uid, newCh);
    } else if (oldCh && newCh && oldCh !== newCh) {
      closeSession(uid);
      openSession(uid, newCh);
    }
  } catch (err) {
    console.error('[STATS] voiceState:', err.message);
  }
}

async function seedCurrentVoice(client) {
  try {
    const guild = await client.guilds.fetch(TARGET_GUILD_ID);
    await guild.channels.fetch().catch(() => {});
    let n = 0;
    for (const channel of guild.channels.cache.values()) {
      if (!channel.isVoiceBased?.()) continue;
      for (const member of channel.members.values()) {
        if (member.user?.bot) continue;
        if (!store.sessions[member.id]) {
          openSession(member.id, channel.id);
          n++;
        }
      }
    }
    console.log(`[STATS] Seeded ${n} live voice session(s)`);
  } catch (err) {
    console.warn('[STATS] Voice seed skipped:', err.message);
  }
}

function flush() {
  if (!dirty) return;
  pruneOldDays();
  try {
    saveStore();
    dirty = false;
  } catch (err) {
    console.error('[STATS] Save failed:', err.message);
  }
}

async function handleActivityCommand(interaction) {
  if (!interaction.isChatInputCommand()) return false;
  if (!['me', 'userstats', 'top'].includes(interaction.commandName)) return false;

  if (interaction.commandName === 'me') {
    await interaction.reply({ embeds: [statsEmbed(interaction.user)] });
    return true;
  }

  if (interaction.commandName === 'userstats') {
    const user = interaction.options.getUser('user') || interaction.user;
    await interaction.reply({ embeds: [statsEmbed(user)] });
    return true;
  }

  const type = interaction.options.getString('type') || 'messages';
  await interaction.reply({ embeds: [topEmbed(type)] });
  return true;
}

function commandBuilders() {
  return [
    new SlashCommandBuilder()
      .setName('me')
      .setDescription('Your message and voice stats (1d / 7d / 45d)'),
    new SlashCommandBuilder()
      .setName('userstats')
      .setDescription('Look up a member’s message and voice stats')
      .addUserOption((opt) =>
        opt.setName('user').setDescription('Member').setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('top')
      .setDescription('Top members by messages or voice time')
      .addStringOption((opt) =>
        opt
          .setName('type')
          .setDescription('What to rank')
          .setRequired(false)
          .addChoices(
            { name: 'Messages', value: 'messages' },
            { name: 'Voice', value: 'voice' }
          )
      )
  ];
}

async function startActivityStats(client) {
  console.log('[STATS] Activity tracker starting…');
  await seedCurrentVoice(client);
  setInterval(flush, FLUSH_MS);
  process.on('exit', flush);
}

function attachActivityStats(client) {
  client.on(Events.MessageCreate, handleMessageCreate);
  client.on(Events.VoiceStateUpdate, handleVoiceState);
}

module.exports = {
  startActivityStats,
  attachActivityStats,
  handleActivityVoiceState: handleVoiceState,
  handleActivityCommand,
  activityStatsCommandBuilders: commandBuilders
};
