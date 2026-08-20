require('dotenv').config();

// Prefer IPv4 — helps Discord voice on some Railway regions
try {
  const dns = require('dns');
  dns.setDefaultResultOrder('ipv4first');
} catch (e) {}
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  Events,
  MessageFlags,
  PermissionFlagsBits
} = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  entersState,
  VoiceConnectionStatus,
  getVoiceConnection,
  generateDependencyReport
} = require('@discordjs/voice');

// Load DAVE (required for Discord voice E2EE in 2026+)
try {
  require('@snazzah/davey');
  console.log('DAVE protocol library (@snazzah/davey) loaded');
} catch (e) {
  console.warn('DAVE library failed to load:', e.message);
}

// Pure-JS Opus (no native build required on Railway)
try {
  require('opusscript');
  console.log('opusscript loaded');
} catch (e) {
  console.warn('opusscript failed:', e.message);
}
const fs = require('fs');
const path = require('path');
const http = require('http');
// Use bundled ffmpeg for audio playback
try {
  const ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath) {
    process.env.FFMPEG_PATH = ffmpegPath;
    console.log('ffmpeg path set:', ffmpegPath);
  }
} catch (e) {
  console.warn('ffmpeg-static not available:', e.message);
}

// libsodium must be ready before any voice connection
let sodiumReady = Promise.resolve();
try {
  const sodium = require('libsodium-wrappers');
  sodiumReady = sodium.ready.then(() => {
    console.log('libsodium ready for voice encryption');
  });
} catch (e) {
  console.warn('libsodium-wrappers not available:', e.message);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Looking for Troopers module (merged)
const { startLft, handleLftCommand, handleLftVoiceState, lftCommandBuilders } = require('./lft');
const { startTac, handleTacInteraction } = require('./tac');
const { startBuildCert, handleBuildCertInteraction, handleBuildCertCommand, buildCertCommandBuilders } = require('./build-cert');
const {
  startMemberBackup,
  handleMemberUpdate: handleMemberBackupUpdate,
  handleMemberRemove,
  handleMemberAdd: handleMemberBackupAdd,
  handleMemberBackupCommand,
  memberBackupCommandBuilders
} = require('./member-backup');
const {
  startActivityStats,
  attachActivityStats,
  handleActivityCommand,
  activityStatsCommandBuilders
} = require('./activity-stats');

// ========== MAIN SERVER ==========
const TARGET_GUILD_ID = '1256977709884641382';

/** Channels whose threads the bot should track (for app file uploads) */
const FILE_THREAD_PARENT_CHANNELS = [
  '1291511308625117265',
  '1285429568747995136',
  '1284616138965258341',
  '1287139624464154747',
  '1292973652396212236'
];

// ========== RANK TIME-IN-GRADE TRACKING ==========
// Role IDs: fill in when known. SGT is set. Others resolve by name on startup.
const RANK_TRACK_FILE = './data/role-tracking.json';

/** @type {Array<{key:string,label:string,roleId:string|null,nameMatch:RegExp,milestones:number[]}>} */
const RANK_DEFS = [
  // Enlisted
  { key: 'RCT', label: 'Recruit', roleId: '1257038526219030548', nameMatch: /recruit|^rct$/i, milestones: [] },
  { key: 'PVT', label: 'Private', roleId: '1258476905473114183', nameMatch: /^private$|^pvt$/i, milestones: [] },
  { key: 'PFC', label: 'Private First Class', roleId: '1257035301692379326', nameMatch: /private first class|^pfc$/i, milestones: [] },
  { key: 'LCPL', label: 'Lance Corporal', roleId: '1413113229478989957', nameMatch: /lance corporal|^lcpl$/i, milestones: [] },
  { key: 'SPC', label: 'Specialist', roleId: '1259218970465009804', nameMatch: /^specialist$|^spc$/i, milestones: [90] },
  // NCO
  { key: 'CPL', label: 'Corporal', roleId: '1257038928301658183', nameMatch: /^corporal$|^cpl$/i, milestones: [] },
  { key: 'SGT', label: 'Sergeant', roleId: '1257039906950217909', nameMatch: /^sergeant$|^sgt$/i, milestones: [7] },
  // SNCO
  { key: 'SSGT', label: 'Staff Sergeant', roleId: '1257040534871212044', nameMatch: /staff sergeant|^ssgt$/i, milestones: [7] },
  { key: 'GSGT', label: 'Gunnery Sergeant', roleId: '1327041678715912233', nameMatch: /gunnery sergeant|^gsgt$/i, milestones: [7] },
  // SEL
  { key: 'MSGT', label: 'Master Sergeant', roleId: '1257040836558979172', nameMatch: /^master sergeant$|^msgt$/i, milestones: [7] },
  { key: '1SGT', label: 'First Sergeant', roleId: '1413112460474322969', nameMatch: /first sergeant|^1st?\s*sgt$/i, milestones: [90] },
  { key: 'MGSGT', label: 'Master Gunnery Sergeant', roleId: '1413112382930288680', nameMatch: /master gunnery|^mgsgt$/i, milestones: [90] },
  // Commissioned
  { key: 'OC', label: 'Officer Cadet', roleId: '1257040336849469561', nameMatch: /officer cadet|^oc$/i, milestones: [7] },
  { key: '2LT', label: 'Second Lieutenant', roleId: '1257042020107685941', nameMatch: /second lieutenant|^2nd\s*lt$/i, milestones: [7] },
  { key: '1LT', label: 'First Lieutenant', roleId: '1327041339933593632', nameMatch: /first lieutenant|^1st\s*lt$/i, milestones: [7] },
  { key: 'CPT', label: 'Captain', roleId: '1257042314258550815', nameMatch: /^captain$|^cpt$/i, milestones: [] },
  // Division Staff
  { key: 'WO', label: 'Warrant Officer', roleId: '1413112243150782485', nameMatch: /warrant officer|^wo$/i, milestones: [] },
  { key: 'SGTMAJ', label: 'Sergeant Major', roleId: '1258954665043824691', nameMatch: /^sergeant major$|^sgtmaj$/i, milestones: [] },
  { key: 'CSM', label: 'Command Sergeant Major', roleId: '1259321577313533952', nameMatch: /command sergeant major|^csm$/i, milestones: [] },
  { key: 'MAJ', label: 'Major', roleId: '1267625939085561985', nameMatch: /^major$|^maj$/i, milestones: [] },
  // Division Command
  { key: 'LTCOL', label: 'Lieutenant Colonel', roleId: '1370837045391523920', nameMatch: /lieutenant colonel|^lt\.?\s*col$/i, milestones: [] },
  { key: 'COL', label: 'Colonel', roleId: '1256997807584444529', nameMatch: /^colonel$|^col$/i, milestones: [] },
  { key: 'GEN', label: 'General', roleId: '1256996610290880543', nameMatch: /^general$|^gen$/i, milestones: [] }
];

/** Company role → leadership channel + roles to ping in that channel */
const COMPANY_ROUTES = [
  {
    key: 'Demon',
    roleId: '1256994919826985060',
    channelId: '1257064906352623758',
    pingRoleIds: ['1257443553358123110', '1258867174232166400']
  },
  {
    key: 'Nightmare',
    roleId: '1256995385965281364',
    channelId: '1257064980235423847',
    pingRoleIds: ['1257444092431044691', '1258867171358933113']
  },
  {
    key: 'Cerberus',
    roleId: '1256996070316179566',
    channelId: '1257065022262214748',
    pingRoleIds: ['1257444166711902372', '1258867177356922962']
  },
  {
    key: 'Hellfire',
    roleId: '1256996307986415646',
    channelId: '1257065092164620438',
    pingRoleIds: ['1257444253685256313', '1258867158935666688']
  }
];

/** Roles pinged by /ranktest in the channel the command is used in */
const RANK_TEST_PING_ROLES = [
  '1418416362136670388',
  '1257030835542949939'
];

/**
 * If a member has ANY of triggerRoleIds, grant grantRoleId (if they don't already have it).
 * Bot role must be above grantRoleId and have Manage Roles in the server.
 */
const ROLE_GRANT_RULES = [
  {
    triggerRoleIds: ['1317610310705741834', '1319450021426495499'],
    grantRoleId: '1294781406295363705'
  }
];

async function applyRoleGrantRules(member, { reason = 'role grant rule' } = {}) {
  if (!member || member.user?.bot) return { granted: false };
  for (const rule of ROLE_GRANT_RULES) {
    const hasTrigger = rule.triggerRoleIds.some((id) => member.roles.cache.has(id));
    if (!hasTrigger) continue;
    if (member.roles.cache.has(rule.grantRoleId)) continue;
    try {
      await member.roles.add(rule.grantRoleId, reason);
      console.log(`[ROLES] Granted ${rule.grantRoleId} to ${member.user?.tag || member.id} (${reason})`);
      return { granted: true, roleId: rule.grantRoleId };
    } catch (err) {
      console.error(`[ROLES] Failed to grant ${rule.grantRoleId} to ${member.id}:`, err.message);
      return { granted: false, error: err.message };
    }
  }
  return { granted: false };
}

async function syncRoleGrantRules(guild) {
  await guild.members.fetch().catch(() => {});
  let granted = 0;
  let skipped = 0;
  let failed = 0;
  for (const member of guild.members.cache.values()) {
    if (member.user?.bot) continue;
    const result = await applyRoleGrantRules(member, { reason: 'startup /syncroles' });
    if (result.granted) granted++;
    else if (result.error) failed++;
    else skipped++;
  }
  console.log(`[ROLES] Sync complete — granted=${granted} already-ok=${skipped} failed=${failed}`);
  return { granted, skipped, failed };
}


function loadRoleTracking() {
  try {
    if (!fs.existsSync(RANK_TRACK_FILE)) {
      return { notifyChannelId: null, ranks: {}, sergeants: {} };
    }
    const data = JSON.parse(fs.readFileSync(RANK_TRACK_FILE, 'utf8'));
    if (!data.ranks || typeof data.ranks !== 'object') data.ranks = {};
    // Migrate old sergeant-only data
    if (data.sergeants && typeof data.sergeants === 'object') {
      if (!data.ranks.SGT) data.ranks.SGT = {};
      for (const [uid, rec] of Object.entries(data.sergeants)) {
        if (!data.ranks.SGT[uid]) {
          data.ranks.SGT[uid] = {
            gainedAt: rec.gainedAt,
            notified: rec.notifiedWeek ? { '7': true } : {},
            seeded: !!rec.seeded
          };
        }
      }
    }
    return data;
  } catch {
    return { notifyChannelId: null, ranks: {} };
  }
}

function saveRoleTracking(data) {
  const dir = path.dirname(RANK_TRACK_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(RANK_TRACK_FILE, JSON.stringify(data, null, 2), 'utf8');
}

let roleTracking = loadRoleTracking();

/** roleId -> rank key */
const roleIdToRankKey = new Map();

function resolveRankRoleIds(guild) {
  roleIdToRankKey.clear();
  for (const def of RANK_DEFS) {
    let role = null;
    if (def.roleId) {
      role = guild.roles.cache.get(def.roleId) || null;
    }
    if (!role) {
      role =
        guild.roles.cache.find((r) => def.nameMatch.test(r.name.trim())) || null;
      if (role) def.roleId = role.id;
    }
    if (role) {
      roleIdToRankKey.set(role.id, def.key);
      console.log(`[RANK] ${def.key} (${def.label}) → ${role.name} (${role.id})`);
    } else {
      console.warn(`[RANK] Could not resolve role for ${def.key} (${def.label})`);
    }
  }
}

/** Returns the COMPANY_ROUTES entries the user belongs to (company leadership only — no default). */
async function getRankNotifyRoutes(userId) {
  const routes = [];
  try {
    const guild = client.guilds.cache.get(TARGET_GUILD_ID) || await client.guilds.fetch(TARGET_GUILD_ID);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) {
      for (const route of COMPANY_ROUTES) {
        if (member.roles.cache.has(route.roleId)) {
          routes.push(route);
        }
      }
    }
  } catch (err) {
    console.warn('[RANK] getRankNotifyRoutes:', err.message);
  }
  return routes;
}

async function sendRankNotice(userId, content) {
  const routes = await getRankNotifyRoutes(userId);
  if (!routes.length) {
    console.log('[RANK] No notify channels (user has no company role)');
    return false;
  }
  let sent = 0;
  for (const route of routes) {
    try {
      const ch = await client.channels.fetch(route.channelId);
      if (ch) {
        const pings = (route.pingRoleIds || []).map((id) => `<@&${id}>`).join(' ');
        const fullContent = pings ? `${pings}\n${content}` : content;
        await ch.send({ content: fullContent });
        sent++;
      }
    } catch (err) {
      console.error(`[RANK] Send failed to ${route.channelId} (${route.key}):`, err.message);
    }
  }
  return sent > 0;
}

function trackRankGain(rankKey, userId, { seeded = false } = {}) {

  if (!roleTracking.ranks[rankKey]) roleTracking.ranks[rankKey] = {};
  if (roleTracking.ranks[rankKey][userId]) return false;
  roleTracking.ranks[rankKey][userId] = {
    gainedAt: new Date().toISOString(),
    notified: {},
    seeded
  };
  saveRoleTracking(roleTracking);
  console.log(`[RANK] Tracking ${rankKey} for ${userId}${seeded ? ' (seeded)' : ''}`);
  return true;
}

function untrackRank(rankKey, userId) {
  if (roleTracking.ranks[rankKey] && roleTracking.ranks[rankKey][userId]) {
    delete roleTracking.ranks[rankKey][userId];
    saveRoleTracking(roleTracking);
    console.log(`[RANK] Stopped ${rankKey} for ${userId}`);
  }
}

async function checkRankMilestones() {
  const now = Date.now();
  let changed = false;

  for (const def of RANK_DEFS) {
    if (!def.milestones.length) continue;
    const bucket = roleTracking.ranks[def.key] || {};
    for (const [userId, rec] of Object.entries(bucket)) {
      if (!rec.notified) rec.notified = {};
      const gained = new Date(rec.gainedAt).getTime();
      if (Number.isNaN(gained)) continue;
      const daysHeld = Math.floor((now - gained) / (24 * 60 * 60 * 1000));

      for (const milestone of def.milestones) {
        const key = String(milestone);
        if (rec.notified[key]) continue;
        if (daysHeld < milestone) continue;

        const content =
          `⏱️ **${def.label} — ${milestone}-day mark**\n` +
          `<@${userId}> has held **${def.label}** for **${daysHeld} day(s)** ` +
          `(since <t:${Math.floor(gained / 1000)}:f>).`;

        const ok = await sendRankNotice(userId, content);
        if (ok) {
          rec.notified[key] = true;
          changed = true;
          console.log(`[RANK] ${def.key} ${milestone}d notified for ${userId}`);
        } else {
          console.warn(`[RANK] No channel for ${userId} — skipped marking ${def.key} ${milestone}d`);
        }
      }
    }
  }
  if (changed) saveRoleTracking(roleTracking);
}

async function seedExistingRanks() {
  try {
    const guild = await client.guilds.fetch(TARGET_GUILD_ID);
    await guild.members.fetch().catch(() => {});
    resolveRankRoleIds(guild);

    let added = 0;
    for (const def of RANK_DEFS) {
      if (!def.roleId) continue;
      const role = guild.roles.cache.get(def.roleId);
      if (!role) continue;
      for (const [, member] of role.members) {
        if (member.user.bot) continue;
        if (trackRankGain(def.key, member.id, { seeded: true })) added++;
      }
    }
    console.log(`[RANK] Seed complete — ${added} new track entries`);
  } catch (err) {
    console.error('[RANK] Seed failed:', err.message);
  }
}



const PANEL_CHANNEL_ID = '1533983126970433677';
const REPORT_CHANNEL_ID = '1533983132464840765';
// =================================


const EXTRA_GUILD_IDS = ['1352675653798989947'];

// ========== DROPSHIP CATEGORIES (PL snapshot) ==========
const DROPSHIPS = {
  1: {
    name: 'Dropship 1',
    flightDeckId: '1355322836851626056',
    channels: {
      'Platoon Lead': '1296616703827902474',
      'Demon': '1296619397095362570',
      'Nightmare': '1296619817004175401',
      'Cerberus': '1296619836935245876',
      'Hellfire': '1296619861828698264'
    }
  },
  2: {
    name: 'Dropship 2',
    flightDeckId: '1355322865981067284',
    channels: {
      'Platoon Lead': '1296616682525032448',
      'Demon': '1296619115888246814',
      'Nightmare': '1296620348934062122',
      'Cerberus': '1296620554052178082',
      'Hellfire': '1296620786525802568'
    }
  },
  3: {
    name: 'Dropship 3',
    flightDeckId: '1457476382392188981',
    channels: {
      'Platoon Lead': '1457476430819492024',
      'Demon': '1457476467179917393',
      'Nightmare': '1457476507432648766',
      'Cerberus': '1457476552756433151',
      'Hellfire': '1457476572465463566'
    }
  }
};

const SNAPSHOTS_FILE = './data/pl-snapshots.json';
let snapshotsCache = null;

function loadSnapshots() {
  if (snapshotsCache) return snapshotsCache;
  if (!fs.existsSync(SNAPSHOTS_FILE)) {
    snapshotsCache = {};
    return snapshotsCache;
  }
  try {
    snapshotsCache = JSON.parse(fs.readFileSync(SNAPSHOTS_FILE, 'utf8'));
  } catch {
    snapshotsCache = {};
  }
  return snapshotsCache;
}

function saveSnapshots(data) {
  snapshotsCache = data;
  try {
    if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
    fs.writeFileSync(SNAPSHOTS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('saveSnapshots failed:', e.message);
  }
}

async function takeDropshipSnapshot(guild, dropshipNumber, plUserId) {
  const ds = DROPSHIPS[dropshipNumber];
  if (!ds) throw new Error('Invalid dropship');

  // Each squad ONLY lists people currently in THAT voice channel
  const squads = {};
  const allMemberIds = new Set();

  for (const [squadName, channelId] of Object.entries(ds.channels)) {
    const members = [];
    try {
      const ch = await guild.channels.fetch(channelId);
      if (ch && ch.isVoiceBased && ch.isVoiceBased()) {
        // Fresh member list from this channel only
        for (const member of ch.members.values()) {
          if (member.user && !member.user.bot) {
            members.push(member.id);
            allMemberIds.add(member.id);
          }
        }
      } else if (ch && ch.type === ChannelType.GuildVoice) {
        for (const member of ch.members.values()) {
          if (member.user && !member.user.bot) {
            members.push(member.id);
            allMemberIds.add(member.id);
          }
        }
      }
    } catch (e) {
      console.warn(`Snapshot: could not read ${squadName} (${channelId}):`, e.message);
    }
    // Store ONLY this channel's occupants — never copy from other squads
    squads[squadName] = [...new Set(members)];
  }

  // PL id is metadata; do not invent them into a squad list unless they are in that VC
  allMemberIds.add(plUserId);

  return {
    dropship: dropshipNumber,
    dropshipName: ds.name,
    plUserId,
    squads, // { 'Platoon Lead': [...], Demon: [...], ... } each from its own channel
    allMemberIds: [...allMemberIds],
    takenAt: new Date().toISOString()
  };
}

async function resolveMemberLabels(guild, userIds) {
  const labels = new Map();
  const missing = [];
  for (const id of userIds) {
    const cached = guild.members.cache.get(id);
    if (cached) {
      labels.set(id, (cached.displayName || cached.user.username || id).slice(0, 100));
    } else {
      missing.push(id);
    }
  }
  if (missing.length) {
    const results = await Promise.all(
      missing.map(async (id) => {
        try {
          const m = await guild.members.fetch(id);
          return [id, (m.displayName || m.user.username || id).slice(0, 100)];
        } catch {
          return [id, id];
        }
      })
    );
    for (const [id, label] of results) labels.set(id, label);
  }
  return labels;
}

function formatSnapshotLines(snapshot) {
  const lines = [];
  // Who claimed PL (button clicker)
  lines.push(`**Platoon Lead (claimed by):** <@${snapshot.plUserId}>`);

  // Fixed order — each line is ONLY people who were in that channel
  const order = ['Platoon Lead', 'Demon', 'Nightmare', 'Cerberus', 'Hellfire'];
  for (const name of order) {
    const ids = (snapshot.squads && snapshot.squads[name]) ? snapshot.squads[name] : [];
    const mentions = ids.length ? ids.map(id => `<@${id}>`).join(' ') : '—';
    if (name === 'Platoon Lead') {
      lines.push(`**In Platoon Lead VC:** ${mentions}`);
    } else {
      const leadId = snapshot.squadLeads && snapshot.squadLeads[name];
      const leadBit = leadId ? ` | Lead: <@${leadId}>` : '';
      lines.push(`**${name}:** ${mentions}${leadBit}`);
    }
  }
  return lines.join('\n');
}


// Platoon Lead channels: TEXT reminder when 1+ user joins (tags them)
const PLATOON_LEAD_CHANNELS = {
  '1296616703827902474': { name: 'Platoon Lead 1', minMembers: 1, text: true, audio: false },
  '1296616682525032448': { name: 'Platoon Lead 2', minMembers: 1, text: true, audio: false },
  '1457476430819492024': { name: 'Platoon Lead 3', minMembers: 1, text: true, audio: false }
};

// Briefing Rooms: AUDIO (+ text) when 12+ users
const BRIEFING_ROOM_CHANNELS = {
  '1296614834804097115': { name: 'Briefing Room 1', minMembers: 12, text: true, audio: true },
  '1302158623966887946': { name: 'Briefing Room 2', minMembers: 12, text: true, audio: true },
  '1457476407373594886': { name: 'Briefing Room 3', minMembers: 12, text: true, audio: true }
};

const ALL_WATCH_CHANNELS = { ...PLATOON_LEAD_CHANNELS, ...BRIEFING_ROOM_CHANNELS };
const WATCHED_VOICE_CHANNELS = Object.keys(ALL_WATCH_CHANNELS);

const AAR_CHANNEL_LINK = `<#${PANEL_CHANNEL_ID}>`;
const AUDIO_FILE = path.join(__dirname, 'aar-reminder.mp3');

// Track which channels have already triggered (reset when below 12)
const reminderTriggered = new Map();

const STATS_FILE = './data/stats.json';

if (!fs.existsSync('./data')) {
  fs.mkdirSync('./data', { recursive: true });
}

function loadStats() {
  if (!fs.existsSync(STATS_FILE)) {
    return { totalOperations: 0, users: {}, dropships: {} };
  }
  try {
    const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    if (typeof data.totalOperations !== 'number') data.totalOperations = 0;
    if (!data.users) data.users = {};
    if (!data.dropships || typeof data.dropships !== 'object') data.dropships = {};
    return data;
  } catch {
    return { totalOperations: 0, users: {}, dropships: {} };
  }
}

function ensureUserStats(userId) {
  if (!stats.users[userId]) {
    stats.users[userId] = {
      points: 0,
      operations: 0,
      lastDrop: null,
      drops: [],
      plCount: 0,
      slCount: 0
    };
  }
  if (typeof stats.users[userId].plCount !== 'number') stats.users[userId].plCount = 0;
  if (typeof stats.users[userId].slCount !== 'number') stats.users[userId].slCount = 0;
  if (!Array.isArray(stats.users[userId].drops)) stats.users[userId].drops = [];
  return stats.users[userId];
}

function formatDropshipRecord(rec) {
  if (!rec) return 'Dropship not found.';
  const lines = [
    `**Dropship #${rec.number}**`,
    `**When:** <t:${Math.floor(new Date(rec.date).getTime() / 1000)}:f>`,
    `**Mode / Map:** ${rec.mode || '—'} → ${rec.map || '—'}`,
    `**Mission:** ${rec.mission || 'N/A'}`,
    `**Outcome:** ${rec.outcome || '—'} | **Extract:** ${rec.extracted || '—'}`,
    `**Platoon Lead:** ${rec.plUserId ? `<@${rec.plUserId}>` : '—'}`,
  ];
  const squads = rec.squads || {};
  const leads = rec.squadLeads || {};
  const order = ['Platoon Lead', 'Demon', 'Nightmare', 'Cerberus', 'Hellfire'];
  for (const name of order) {
    const ids = squads[name] || [];
    const lead = leads[name] ? ` (SL: <@${leads[name]}>)` : '';
    const people = ids.length ? ids.map((id) => `<@${id}>`).join(' ') : '—';
    lines.push(`**${name}:** ${people}${lead}`);
  }
  if (!Object.keys(squads).length && Array.isArray(rec.users)) {
    lines.push(`**Roster:** ${rec.users.map((id) => `<@${id}>`).join(' ') || '—'}`);
  }
  return lines.join('\n');
}

function saveStats(stats) {
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

let stats = loadStats();
const pending = new Map();

const VICTORY_IMAGE = 'https://i.imgur.com/D4NGqX2.png';
const DEFEAT_IMAGE = 'https://i.imgur.com/uh3NI8g.png';

const GAME_MODES = [
  { id: 'mode_arc', label: 'ARC' },
  { id: 'mode_horde', label: 'HORDE' },
  { id: 'mode_aas', label: 'AAS' },
  { id: 'mode_critical', label: 'CRITICAL STRIKE' }
];

const MAPS = [
  { id: 'map_x11', label: 'X-11' },
  { id: 'map_agni', label: 'Agni Prime' },
  { id: 'map_valaka', label: 'Valaka' },
  { id: 'map_boreas', label: 'Boreas' },
  { id: 'map_sparta', label: 'Sparta' }
];

function buildMapRow() {
  const row = new ActionRowBuilder();
  for (const map of MAPS) {
    row.addComponents(
      new ButtonBuilder().setCustomId(map.id).setLabel(map.label).setStyle(ButtonStyle.Primary)
    );
  }
  return row;
}

function buildOutcomeRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('outcome_success').setLabel('Success').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('outcome_partial').setLabel('Partial').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('outcome_failure').setLabel('Failure').setStyle(ButtonStyle.Danger)
  );
}

function buildExtractRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('extract_yes').setLabel('Yes').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('extract_no').setLabel('No').setStyle(ButtonStyle.Danger)
  );
}

// ========== LIVE STATS API + THREAD FILE API ==========
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

async function listThreadsForParent(parentId) {
  const parent = await client.channels.fetch(parentId).catch(() => null);
  if (!parent) return { parentId, error: 'Channel not found or bot cannot see it', threads: [] };

  const threads = [];
  try {
    if (parent.threads) {
      const active = await parent.threads.fetchActive().catch(() => null);
      if (active?.threads) {
        for (const t of active.threads.values()) {
          threads.push({
            id: t.id,
            name: t.name,
            parentId,
            archived: false,
            locked: !!t.locked,
            type: t.type
          });
        }
      }
      // Public archived (recent)
      try {
        const archived = await parent.threads.fetchArchived({ type: 'public', fetchAll: false }).catch(() => null);
        if (archived?.threads) {
          for (const t of archived.threads.values()) {
            if (!threads.find((x) => x.id === t.id)) {
              threads.push({
                id: t.id,
                name: t.name,
                parentId,
                archived: true,
                locked: !!t.locked,
                type: t.type
              });
            }
          }
        }
      } catch (_) {}
    }
  } catch (err) {
    return { parentId, name: parent.name, error: err.message, threads };
  }

  return {
    parentId,
    name: parent.name,
    type: parent.type,
    threads: threads.sort((a, b) => a.name.localeCompare(b.name))
  };
}

async function refreshFileThreadCache() {
  console.log('[THREADS] Scanning parent channels for threads…');
  for (const id of FILE_THREAD_PARENT_CHANNELS) {
    try {
      const result = await listThreadsForParent(id);
      if (result.error) {
        console.warn(`[THREADS] ${id}: ${result.error}`);
      } else {
        console.log(`[THREADS] #${result.name || id}: ${result.threads.length} thread(s)`);
      }
    } catch (err) {
      console.warn(`[THREADS] ${id}: ${err.message}`);
    }
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  try {
    if (pathname === '/' || pathname === '/health') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    if (pathname === '/stats') {
      let totalPoints = 0;
      for (const userId in stats.users) {
        totalPoints += stats.users[userId].points || 0;
      }
      let totalMembers = 0;
      try {
        const guild = client.guilds.cache.get(TARGET_GUILD_ID);
        if (guild) {
          totalMembers = guild.memberCount || guild.members?.cache?.size || 0;
        }
      } catch (e) {
        totalMembers = 0;
      }
      res.setHeader('Content-Type', 'application/json');
      // Website checks n.ok && n.totalMembers / n.totalDropships
      res.end(JSON.stringify({
        ok: true,
        source: 'live',
        totalDropships: stats.totalOperations || 0,
        totalPoints: totalPoints,
        totalMembers: totalMembers,
        troopers: totalMembers
      }));
      return;
    }

    // GET /threads — all tracked parent channels
    if (req.method === 'GET' && pathname === '/threads') {
      const results = [];
      for (const id of FILE_THREAD_PARENT_CHANNELS) {
        results.push(await listThreadsForParent(id));
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ channels: results }));
      return;
    }

    // GET /threads/:parentChannelId
    const parentMatch = pathname.match(/^\/threads\/(\d+)$/);
    if (req.method === 'GET' && parentMatch) {
      const result = await listThreadsForParent(parentMatch[1]);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
      return;
    }

    // POST /threads/:threadId/send
    // Body JSON: { content?: string, filename?: string, fileBase64?: string, fileUrl?: string }
    const sendMatch = pathname.match(/^\/threads\/(\d+)\/send$/);
    if (req.method === 'POST' && sendMatch) {
      const threadId = sendMatch[1];
      const body = await readJsonBody(req);
      const thread = await client.channels.fetch(threadId).catch(() => null);
      if (!thread || !thread.isThread?.()) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Thread not found or bot cannot see it' }));
        return;
      }

      // Join if possible (public threads)
      try {
        if (thread.joinable) await thread.join();
      } catch (_) {}

      const payload = { content: body.content ? String(body.content).slice(0, 2000) : undefined };
      const files = [];

      if (body.fileBase64 && body.filename) {
        const buf = Buffer.from(body.fileBase64, 'base64');
        files.push({ attachment: buf, name: String(body.filename).slice(0, 200) });
      } else if (body.fileUrl) {
        const resp = await fetch(body.fileUrl);
        if (!resp.ok) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: `Failed to download fileUrl: ${resp.status}` }));
          return;
        }
        const arr = Buffer.from(await resp.arrayBuffer());
        const name =
          body.filename ||
          String(body.fileUrl).split('/').pop().split('?')[0] ||
          'file.bin';
        files.push({ attachment: arr, name: name.slice(0, 200) });
      }

      if (!payload.content && files.length === 0) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Provide content and/or fileBase64+filename or fileUrl' }));
        return;
      }

      if (files.length) payload.files = files;

      const msg = await thread.send(payload);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        messageId: msg.id,
        threadId: thread.id,
        threadName: thread.name,
        channelId: thread.parentId
      }));
      return;
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (err) {
    console.error('[API]', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err.message || 'Server error' }));
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`API running on port ${PORT} (stats + /threads + /threads/:id/send)`);
});

client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    console.log(generateDependencyReport());
  } catch (e) {}
  if (!fs.existsSync(AUDIO_FILE)) {
    console.warn(`WARNING: Audio file not found at ${AUDIO_FILE}`);
    console.warn('Place aar-reminder.mp3 in the project root for voice reminders.');
  } else {
    console.log('AAR reminder audio file found.');
  }
  // Start Looking for Troopers schedulers
  try {
    startLft(client);
  } catch (e) {
    console.error('Failed to start LFT module:', e);
  }
  // Start Tactical Centre specialisation editor
  try {
    await startTac(client);
  } catch (e) {
    console.error('Failed to start TAC module:', e);
  }
  try {
    await startBuildCert(client);
  } catch (e) {
    console.error('Failed to start BUILD module:', e);
  }
  try {
    await refreshFileThreadCache();
  } catch (e) {
    console.error('Failed to scan file threads:', e);
  }
  try {
    await seedExistingRanks();
    setInterval(() => {
      checkRankMilestones().catch((e) => console.error('[RANK] check error:', e.message));
    }, 60 * 60 * 1000);
    setTimeout(() => {
      checkRankMilestones().catch(() => {});
    }, 15000);
  } catch (e) {
    console.error('Failed to start rank tracking:', e);
  }
  try {
    const guild = await client.guilds.fetch(TARGET_GUILD_ID);
    await syncRoleGrantRules(guild);
  } catch (e) {
    console.error('Failed to sync role grant rules:', e);
  }
  try {
    await startMemberBackup(client);
  } catch (e) {
    console.error('Failed to start member backup:', e);
  }
  try {
    await startActivityStats(client);
  } catch (e) {
    console.error('Failed to start activity stats:', e);
  }
});

attachActivityStats(client);


// Shared reminder: text + audio in Briefing Room
async function playAarReminder(channel, memberCount, label = null, options = {}) {
  const channelId = channel.id;
  const roomInfo = ALL_WATCH_CHANNELS[channelId] || BRIEFING_ROOM_CHANNELS[channelId] || PLATOON_LEAD_CHANNELS[channelId];
  const displayName = label || roomInfo?.name || channel.name;
  const doText = options.doText !== false;
  const doAudio = options.doAudio === true || (options.doAudio !== false && roomInfo?.audio === true);
  // Default: text always unless explicitly disabled; audio only if requested/configured
  const shouldText = options.doText !== undefined ? options.doText : true;
  const shouldAudio = options.doAudio !== undefined ? options.doAudio : (roomInfo?.audio === true);

  // Members in the voice channel (for ping)
  const humanMembers = [...channel.members.values()].filter(m => !m.user.bot);
  const pings = humanMembers.map(m => `<@${m.id}>`).join(' ') || '@here';

  let textSent = false;

  // 1) Text reminder + ping people in the VC
  if (shouldText) {
    try {
      await channel.send({
        content:
          `📋 **AAR Reminder` + (label ? ' (TEST)' : '') + `**\n` +
          `${pings}\n` +
          `You are in **${displayName}**.\n` +
          `Please submit the After Action Report here: ${AAR_CHANNEL_LINK}`
      });
      textSent = true;
    } catch (err) {
      console.error('Failed to send text reminder:', err.message);
    }
  }

  // 2) Join and play audio (Briefing Rooms at 12+)
  if (!shouldAudio) {
    return { textSent, audioPlayed: false };
  }

  if (!fs.existsSync(AUDIO_FILE)) {
    console.warn('Skipping audio — aar-reminder.mp3 not found');
    return { textSent, audioPlayed: false };
  }

  let connection = null;
  let left = false;
  const forceLeave = () => {
    if (left) return;
    left = true;
    try {
      if (connection) connection.destroy();
    } catch (e) {}
    try {
      const conn = getVoiceConnection(channel.guild.id);
      if (conn) conn.destroy();
    } catch (e) {}
    console.log(`Left voice channel ${channel.name}`);
  };

  try {
    await sodiumReady;

    const existing = getVoiceConnection(channel.guild.id);
    if (existing) {
      try { existing.destroy(); } catch (e) {}
    }

    const me = channel.guild.members.me;
    if (me) {
      const perms = channel.permissionsFor(me);
      if (perms && (!perms.has('Connect') || !perms.has('Speak'))) {
        return {
          textSent: true,
          audioPlayed: false,
          error: 'Bot needs Connect + Speak permission in this voice channel'
        };
      }
    }

    console.log(`Joining voice channel ${channel.name} (${channel.id})...`);

    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
      debug: true
    });

    connection.on('debug', (m) => console.log('[VOICE DEBUG]', m));

    connection.on('stateChange', (oldState, newState) => {
      console.log(`Voice state: ${oldState.status} -> ${newState.status}`);
    });

    connection.on('error', (err) => {
      console.error('Voice connection error:', err.message);
    });

    const hardLeaveTimer = setTimeout(() => forceLeave(), 45_000);

    let ready = false;
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      ready = true;
      console.log('Voice connection Ready');
    } catch (e) {
      console.warn('Ready wait timed out, current status:', connection.state?.status);
      if (connection.state?.status === VoiceConnectionStatus.Ready) {
        ready = true;
      }
    }

    if (!ready && connection.state?.status !== VoiceConnectionStatus.Ready) {
      clearTimeout(hardLeaveTimer);
      forceLeave();
      return {
        textSent: true,
        audioPlayed: false,
        error: `Voice never became Ready (status=${connection.state?.status}). Bot left the channel.`
      };
    }

    const player = createAudioPlayer();
    const resource = createAudioResource(AUDIO_FILE, { inlineVolume: true });
    if (resource.volume) resource.volume.setVolume(1.0);

    connection.subscribe(player);
    player.play(resource);
    console.log('Audio playback started');

    await new Promise((resolve) => {
      const done = () => {
        player.removeAllListeners();
        resolve();
      };
      player.once(AudioPlayerStatus.Idle, done);
      player.once('error', (err) => {
        console.error('Audio player error:', err.message);
        done();
      });
      setTimeout(done, 30_000);
    });

    clearTimeout(hardLeaveTimer);
    forceLeave();
    return { textSent: true, audioPlayed: true };
  } catch (err) {
    console.error('Failed to join/play audio:', err);
    forceLeave();
    return { textSent: true, audioPlayed: false, error: err.message || String(err) };
  }
}

// ========== VOICE CHANNEL WATCHER ==========
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  try {
    // Check both old and new channel in case of leave/move/join
    const channelsToCheck = new Set();
    if (oldState.channelId && WATCHED_VOICE_CHANNELS.includes(oldState.channelId)) {
      channelsToCheck.add(oldState.channelId);
    }
    if (newState.channelId && WATCHED_VOICE_CHANNELS.includes(newState.channelId)) {
      channelsToCheck.add(newState.channelId);
    }

    for (const channelId of channelsToCheck) {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildVoice) continue;

      const info = ALL_WATCH_CHANNELS[channelId];
      if (!info) continue;

      const memberCount = channel.members.filter(m => !m.user.bot).size;
      const minMembers = info.minMembers || 1;

      // Reset trigger when below threshold
      if (memberCount < minMembers) {
        reminderTriggered.set(channelId, false);
        continue;
      }

      // Already triggered for this session
      if (reminderTriggered.get(channelId)) continue;

      // Threshold hit — trigger once
      reminderTriggered.set(channelId, true);
      console.log(`${info.name || channel.name} hit ${memberCount} members — sending AAR reminder`);
      await playAarReminder(channel, memberCount, null, {
        doText: info.text !== false,
        doAudio: info.audio === true
      });
    }
  } catch (err) {
    console.error('VoiceStateUpdate handler error:', err);
  }

  // Looking for Troopers voice hooks
  try {
    await handleLftVoiceState(oldState, newState);
  } catch (err) {
    console.error('LFT VoiceStateUpdate error:', err);
  }
});


// ========== Rank role add/remove ==========
client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  try {
    if (newMember.guild.id !== TARGET_GUILD_ID) return;

    await applyRoleGrantRules(newMember, { reason: 'has trigger role' });
    await handleMemberBackupUpdate(oldMember, newMember);

    for (const def of RANK_DEFS) {
      if (!def.roleId) continue;
      const had = oldMember.roles.cache.has(def.roleId);
      const has = newMember.roles.cache.has(def.roleId);
      if (!had && has) {
        trackRankGain(def.key, newMember.id);
        if (def.milestones.length) {
          await sendRankNotice(
            newMember.id,
            `📌 <@${newMember.id}> received **${def.label}**. ` +
              `Tracking: ${def.milestones.join(' / ')} day mark(s).`
          );
        }
      } else if (had && !has) {
        untrackRank(def.key, newMember.id);
      }
    }
  } catch (err) {
    console.error('[RANK] GuildMemberUpdate error:', err.message);
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    if (member.guild.id !== TARGET_GUILD_ID) return;
    await applyRoleGrantRules(member, { reason: 'joined with trigger role' });
    await handleMemberBackupAdd(member);
  } catch (err) {
    console.error('[ROLES] GuildMemberAdd error:', err.message);
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  try {
    if (member.guild.id !== TARGET_GUILD_ID) return;
    await handleMemberRemove(member);
  } catch (err) {
    console.error('[BACKUP] GuildMemberRemove error:', err.message);
  }
});


client.on(Events.InteractionCreate, async interaction => {
  // Skip TAC/LFT for AAR flow — respond as fast as possible
  const cid = interaction.customId || '';
  const isAarFlow =
    (interaction.isButton() &&
      /^(mode_|map_|outcome_|extract_|method_|pl_|ds_)/.test(cid)) ||
    (interaction.isStringSelectMenu() && /^(aar_|pl_)/.test(cid)) ||
    (interaction.isChannelSelectMenu() && cid === 'aar_voice') ||
    (interaction.isUserSelectMenu() && (cid === 'aar_users' || cid.startsWith('ds_pickuser_'))) ||
    (interaction.isModalSubmit() && cid === 'aar_modal');

  if (!isAarFlow) {
    try {
      if (await handleBuildCertInteraction(interaction)) return;
    } catch (err) {
      console.error('BUILD interaction error:', err);
    }
    try {
      if (await handleBuildCertCommand(interaction)) return;
    } catch (err) {
      console.error('BUILD command error:', err);
    }
    try {
      if (await handleTacInteraction(interaction)) return;
    } catch (err) {
      console.error('TAC interaction error:', err);
    }
    try {
      if (await handleLftCommand(interaction)) return;
    } catch (err) {
      console.error('LFT command error:', err);
    }
    try {
      if (await handleMemberBackupCommand(interaction)) return;
    } catch (err) {
      console.error('Member backup command error:', err);
    }
    try {
      if (await handleActivityCommand(interaction)) return;
    } catch (err) {
      console.error('Activity stats command error:', err);
    }
  }


  // ========== /setup ==========
  if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const panelChannel = await client.channels.fetch(PANEL_CHANNEL_ID);
      if (!panelChannel) {
        return interaction.editReply({ content: 'Could not find the panel channel.' });
      }

      const row = new ActionRowBuilder();
      GAME_MODES.forEach(mode => {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(mode.id)
            .setLabel(mode.label)
            .setStyle(ButtonStyle.Primary)
        );
      });

      const panelEmbed = new EmbedBuilder()
        .setTitle('1st M.I. — After Action Report')
        .setDescription('Select the **Game Mode** to start a new After Action Report.')
        .setColor(0x5865F2);

      await panelChannel.send({ embeds: [panelEmbed], components: [row] });

      return interaction.editReply({
        content: `✅ Panel posted in <#${PANEL_CHANNEL_ID}>\nReports go to <#${REPORT_CHANNEL_ID}>`
      });
    } catch (err) {
      console.error(err);
      return interaction.editReply({ content: `Error: ${err.message}` });
    }
  }

  // ========== /drops ==========
  if (interaction.isChatInputCommand() && interaction.commandName === 'drops') {
    const user = interaction.options.getUser('user');
    const userStats = stats.users[user.id] || { points: 0, operations: 0, lastDrop: null, drops: [] };

    const lastDropText = userStats.lastDrop
      ? `<t:${Math.floor(new Date(userStats.lastDrop).getTime() / 1000)}:F>`
      : 'Never';

    const embed = new EmbedBuilder()
      .setTitle('Combat Operation Record')
      .setColor(0x5865F2)
      .setDescription(`**${user}**`)
      .addFields(
        { name: 'Points', value: `**${userStats.points || 0}**`, inline: true },
        { name: 'Total Dropships', value: `**${userStats.operations || 0}**`, inline: true },
        { name: 'Last Dropship', value: lastDropText, inline: true }
      )
      .setThumbnail(user.displayAvatarURL())
      .setFooter({ text: '1st M.I. • Use /droplist for full history' });

    return interaction.reply({ embeds: [embed] });
  }

  // ========== /droplist ==========
  if (interaction.isChatInputCommand() && interaction.commandName === 'droplist') {
    await interaction.deferReply();

    const user = interaction.options.getUser('user');
    const userStats = stats.users[user.id] || { points: 0, operations: 0, lastDrop: null, drops: [] };
    const drops = Array.isArray(userStats.drops) ? userStats.drops : [];

    if (drops.length === 0) {
      return interaction.editReply({
        content: `**${user}** has no detailed dropship history yet.\n(Only dropships made after the history feature was added will appear here.)\n\nTotal recorded dropships: **${userStats.operations || 0}**`
      });
    }

    const sorted = [...drops].reverse();
    const pages = [];
    let current = '';

    sorted.forEach((drop, index) => {
      const num = sorted.length - index;
      const dateText = drop.date
        ? `<t:${Math.floor(new Date(drop.date).getTime() / 1000)}:f>`
        : 'Unknown date';

      const squadText = Array.isArray(drop.squad) && drop.squad.length > 0
        ? drop.squad.map(id => `<@${id}>`).join(' ')
        : 'Not recorded';

      const line =
        `**#${num}** — ${dateText}\n` +
        `• Mode: **${drop.mode || 'N/A'}** | Map: **${drop.map || 'N/A'}**\n` +
        `• Outcome: **${drop.outcome || 'N/A'}** | Extract: **${drop.extracted || 'N/A'}**\n` +
        `• Points: **+${drop.points || 0}** | Mission: ${drop.mission || 'N/A'}\n` +
        `• Squad: ${squadText}\n\n`;

      if ((current + line).length > 3800) {
        pages.push(current);
        current = line;
      } else {
        current += line;
      }
    });
    if (current) pages.push(current);

    const embed = new EmbedBuilder()
      .setTitle(`Dropship History — ${user.username}`)
      .setColor(0x5865F2)
      .setDescription(pages[0])
      .setThumbnail(user.displayAvatarURL())
      .setFooter({
        text: `Showing ${drops.length} recorded dropship(s) • Total ops: ${userStats.operations || 0} • Points: ${userStats.points || 0}`
      });

    await interaction.editReply({ embeds: [embed] });

    for (let i = 1; i < pages.length; i++) {
      const pageEmbed = new EmbedBuilder()
        .setTitle(`Dropship History — ${user.username} (continued)`)
        .setColor(0x5865F2)
        .setDescription(pages[i])
        .setFooter({ text: `Page ${i + 1}/${pages.length}` });
      await interaction.followUp({ embeds: [pageEmbed] });
    }

    return;
  }

  // ========== /pl ==========
  if (interaction.isChatInputCommand() && interaction.commandName === 'pl') {
    const user = interaction.options.getUser('user') || interaction.user;
    const u = stats.users[user.id] || { plCount: 0, drops: [] };
    const plDrops = (u.drops || []).filter((d) => d.wasPL || (d.plUserId && String(d.plUserId) === String(user.id)));
    const count = typeof u.plCount === 'number' ? u.plCount : plDrops.length;
    const recent = plDrops.slice(-15).reverse();
    let list = recent.length
      ? recent.map((d) => `• **#${d.dropshipNumber || '?'}** — ${d.mode || '?'} → ${d.map || '?'} (<t:${Math.floor(new Date(d.date).getTime()/1000)}:d>)`).join('\n')
      : '_No numbered PL records yet (only new AARs after this update)._';

    const embed = new EmbedBuilder()
      .setTitle('Platoon Lead Record')
      .setColor(0x5865F2)
      .setDescription(`${user}`)
      .addFields(
        { name: 'Times as Platoon Lead', value: `**${count}**`, inline: true },
        { name: 'Recent PL dropships', value: list.slice(0, 1024) }
      )
      .setFooter({ text: '1st M.I.' });
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // ========== /sl ==========
  if (interaction.isChatInputCommand() && interaction.commandName === 'sl') {
    const user = interaction.options.getUser('user') || interaction.user;
    const u = stats.users[user.id] || { slCount: 0, drops: [] };
    const slDrops = (u.drops || []).filter((d) => d.wasSL);
    const count = typeof u.slCount === 'number' ? u.slCount : slDrops.length;
    const recent = slDrops.slice(-15).reverse();
    let list = recent.length
      ? recent.map((d) => `• **#${d.dropshipNumber || '?'}** — ${d.squadName || 'Squad'} | ${d.mode || '?'} → ${d.map || '?'} (<t:${Math.floor(new Date(d.date).getTime()/1000)}:d>)`).join('\n')
      : '_No numbered SL records yet (only new AARs after this update)._';

    const embed = new EmbedBuilder()
      .setTitle('Squad Lead Record')
      .setColor(0x57F287)
      .setDescription(`${user}`)
      .addFields(
        { name: 'Times as Squad Lead', value: `**${count}**`, inline: true },
        { name: 'Recent SL dropships', value: list.slice(0, 1024) }
      )
      .setFooter({ text: '1st M.I.' });
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // ========== /dropship ==========
  if (interaction.isChatInputCommand() && interaction.commandName === 'dropship') {
    const num = interaction.options.getInteger('number');
    const rec = stats.dropships && stats.dropships[String(num)];
    if (!rec) {
      return interaction.reply({
        content: `No record for **Dropship #${num}**.\n_(Only dropships completed after numbering was added are stored.)_`,
        flags: MessageFlags.Ephemeral
      });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ds_whole_${num}`)
        .setLabel('Whole Dropship')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`ds_user_${num}`)
        .setLabel('Lookup User')
        .setStyle(ButtonStyle.Secondary)
    );

    const embed = new EmbedBuilder()
      .setTitle(`Dropship #${num}`)
      .setColor(0x5865F2)
      .setDescription(
        `**${rec.mode || '—'} → ${rec.map || '—'}**\n` +
        `PL: ${rec.plUserId ? `<@${rec.plUserId}>` : '—'}\n` +
        `Choose **Whole Dropship** for the full roster, or **Lookup User** to see which squad someone was in.`
      )
      .setFooter({ text: '1st M.I. Dropship Lookup' });

    return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
  }


  // ========== /ranknotify (alias: /sergeantnotify) ==========
  if (interaction.isChatInputCommand() && (interaction.commandName === 'ranknotify' || interaction.commandName === 'sergeantnotify')) {
    const channel = interaction.options.getChannel('channel');
    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
      return interaction.reply({
        content: 'Pick a text (or announcement) channel.',
        flags: MessageFlags.Ephemeral
      });
    }
    roleTracking.notifyChannelId = channel.id;
    saveRoleTracking(roleTracking);
    return interaction.reply({
      content: `✅ Rank time-in-grade notifications will go to ${channel}.`,
      flags: MessageFlags.Ephemeral
    });
  }

  // ========== /syncroles ==========
  if (interaction.isChatInputCommand() && interaction.commandName === 'syncroles') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({
        content: 'You need **Manage Roles** to run this.',
        flags: MessageFlags.Ephemeral
      });
    }
    await interaction.deferReply();
    try {
      const guild = interaction.guild || await client.guilds.fetch(TARGET_GUILD_ID);
      const result = await syncRoleGrantRules(guild);
      return interaction.editReply(
        `✅ Role sync finished.\n` +
          `Granted: **${result.granted}**\n` +
          `Already had it: **${result.skipped}**\n` +
          `Failed: **${result.failed}**`
      );
    } catch (err) {
      return interaction.editReply(`❌ Sync failed: ${err.message}`);
    }
  }

  // ========== /ranklist (alias: /sergeantlist) ==========

  if (interaction.isChatInputCommand() && (interaction.commandName === 'ranklist' || interaction.commandName === 'sergeantlist')) {
    const filter = interaction.options.getString('rank');
    const now = Date.now();

    // If run inside a company leadership channel, only show members of that company
    const companyRoute = COMPANY_ROUTES.find((r) => r.channelId === interaction.channelId) || null;
    let companyMemberIds = null; // null = show everyone
    if (companyRoute) {
      try {
        const guild = interaction.guild || await client.guilds.fetch(TARGET_GUILD_ID);
        await guild.members.fetch().catch(() => {});
        companyMemberIds = new Set(
          guild.members.cache
            .filter((m) => m.roles.cache.has(companyRoute.roleId))
            .map((m) => m.id)
        );
      } catch (err) {
        console.warn('[RANK] ranklist company filter failed:', err.message);
      }
    }

    const chunks = [];
    for (const def of RANK_DEFS) {
      if (filter && def.key !== filter.toUpperCase() && def.label.toLowerCase() !== filter.toLowerCase()) continue;
      const bucket = roleTracking.ranks[def.key] || {};
      let entries = Object.entries(bucket);
      if (companyMemberIds) {
        entries = entries.filter(([id]) => companyMemberIds.has(id));
      }
      if (!entries.length) continue;
      const lines = entries.slice(0, 25).map(([id, rec]) => {
        const gained = new Date(rec.gainedAt).getTime();
        const days = Number.isNaN(gained) ? '?' : Math.floor((now - gained) / (24 * 60 * 60 * 1000));
        const notes = Object.keys(rec.notified || {}).map((d) => `${d}d✓`).join(',') || '…';
        return `• <@${id}> — **${days}**d (${notes})`;
      });
      chunks.push(`**${def.label}** (${entries.length})\n${lines.join('\n')}`);
    }
    if (!chunks.length) {
      const scopeNote = companyRoute
        ? ` for **${companyRoute.key}** in this channel`
        : '';
      return interaction.reply({
        content: `No ranks tracked yet (or no matches${scopeNote}).`
      });
    }

    const scopeHeader = companyRoute
      ? `📍 Filtered to **${companyRoute.key}** (this leadership channel)\n\n`
      : `📍 Showing **all companies** (run inside a leadership channel to filter)\n\n`;
    let body = scopeHeader + chunks.join('\n\n');
    if (body.length > 1900) body = body.slice(0, 1900) + '\n…';
    // Public post — visible to everyone in the channel
    return interaction.reply({ content: body });
  }

  // ========== /ranktest ==========
  if (interaction.isChatInputCommand() && interaction.commandName === 'ranktest') {
    const user = interaction.options.getUser('user');
    if (!user) {
      return interaction.reply({ content: 'Pick a user.', flags: MessageFlags.Ephemeral });
    }

    const companyLines = [];
    try {
      const guild = interaction.guild || await client.guilds.fetch(TARGET_GUILD_ID);
      const member = await guild.members.fetch(user.id).catch(() => null);
      if (member) {
        for (const route of COMPANY_ROUTES) {
          if (member.roles.cache.has(route.roleId)) {
            const pings = (route.pingRoleIds || []).map((id) => `<@&${id}>`).join(' ');
            companyLines.push(
              `• **${route.key}** → <#${route.channelId}>\n  pings: ${pings || '_none_'}`
            );
          }
        }
      }
    } catch (_) {}

    const roleMentions = RANK_TEST_PING_ROLES.map((id) => `<@&${id}>`).join(' ');
    const companyText = companyLines.length
      ? companyLines.join('\n')
      : '_No company roles on this user — live pings would go nowhere._';

    const content =
      `🧪 **Rank notify test** for <@${user.id}>\n` +
      `Would route to:\n${companyText}\n\n` +
      `${roleMentions}`;

    // Public in the channel where the command is run (so role pings fire)
    await interaction.reply({ content });
    return;
  }



  // ========== /1stmidrops ==========
  if (interaction.isChatInputCommand() && interaction.commandName === '1stmidrops') {
    const totalDrops = stats.totalOperations || 0;
    let totalPoints = 0;
    for (const userId in stats.users) {
      totalPoints += stats.users[userId].points || 0;
    }

    const embed = new EmbedBuilder()
      .setTitle('1st M.I. — Server Dropship Record')
      .setColor(0x5865F2)
      .addFields(
        { name: 'Total Dropships', value: `**${totalDrops}**`, inline: true },
        { name: 'Total Points Awarded', value: `**${totalPoints}**`, inline: true }
      )
      .setFooter({ text: '1st M.I.' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // ========== /servermembers ==========
  if (interaction.isChatInputCommand() && interaction.commandName === 'servermembers') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const guild = await client.guilds.fetch(TARGET_GUILD_ID);
      await guild.members.fetch();

      const entries = Object.entries(stats.users || {});
      if (entries.length === 0) {
        return interaction.editReply({ content: 'No members currently have any stats recorded.' });
      }

      entries.sort((a, b) => (b[1].points || 0) - (a[1].points || 0));

      let description = '';
      for (const [userId, data] of entries) {
        description += `<@${userId}> — **${data.points || 0}** pts | **${data.operations || 0}** drops\n`;
      }
      if (description.length > 4000) {
        description = description.substring(0, 4000) + '\n... (list truncated)';
      }

      const embed = new EmbedBuilder()
        .setTitle('1st M.I. — All Member Stats')
        .setDescription(description)
        .setColor(0x5865F2)
        .setFooter({ text: `Members with stats: ${entries.length}` });

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      return interaction.editReply({ content: `Error: ${err.message}` });
    }
  }

  // ========== /setstats ==========
  if (interaction.isChatInputCommand() && interaction.commandName === 'setstats') {
    const user = interaction.options.getUser('user');
    const points = interaction.options.getInteger('points');
    const operations = interaction.options.getInteger('operations');

    if (!stats.users[user.id]) {
      stats.users[user.id] = { points: 0, operations: 0, lastDrop: null, drops: [] };
    }

    if (points !== null) stats.users[user.id].points = points;
    if (operations !== null) stats.users[user.id].operations = operations;

    saveStats(stats);

    const embed = new EmbedBuilder()
      .setTitle('Member Stats Updated')
      .setColor(0x57F287)
      .setDescription(`Updated **${user}**`)
      .addFields(
        { name: 'Points', value: `**${stats.users[user.id].points}**`, inline: true },
        { name: 'Dropships', value: `**${stats.users[user.id].operations}**`, inline: true }
      );

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // ========== /settotal ==========
  if (interaction.isChatInputCommand() && interaction.commandName === 'settotal') {
    const total = interaction.options.getInteger('total');
    stats.totalOperations = total;
    saveStats(stats);

    const embed = new EmbedBuilder()
      .setTitle('Server Total Updated')
      .setColor(0x57F287)
      .setDescription(`Server **Total Dropships** has been set to **${total}**`);

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // ========== /setall ==========
  if (interaction.isChatInputCommand() && interaction.commandName === 'setall') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const points = interaction.options.getInteger('points');
    const operations = interaction.options.getInteger('operations');

    try {
      const guild = await client.guilds.fetch(TARGET_GUILD_ID);
      await guild.members.fetch();

      let count = 0;
      guild.members.cache.forEach(member => {
        if (member.user.bot) return;

        if (!stats.users[member.id]) {
          stats.users[member.id] = { points: 0, operations: 0, lastDrop: null, drops: [] };
        }

        if (points !== null) stats.users[member.id].points = points;
        if (operations !== null) stats.users[member.id].operations = operations;
        count++;
      });

      saveStats(stats);

      const embed = new EmbedBuilder()
        .setTitle('All Member Stats Updated')
        .setColor(0x57F287)
        .setDescription(`Updated **${count}** members from the main server (including offline)`)
        .addFields(
          { name: 'Points set to', value: points !== null ? `**${points}**` : 'Unchanged', inline: true },
          { name: 'Dropships set to', value: operations !== null ? `**${operations}**` : 'Unchanged', inline: true }
        );

      return interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error(err);
      return interaction.editReply({ content: `Error: ${err.message}` });
    }
  }

  // ========== /undolast ==========
  if (interaction.isChatInputCommand() && interaction.commandName === 'undolast') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.editReply({ content: 'You need **Manage Server** permission to use this command.' });
    }

    if (!stats.lastReport) {
      return interaction.editReply({ content: 'There is no last report to undo.\n(Only works for reports made after this feature was added.)' });
    }

    const last = stats.lastReport;

    last.users.forEach(userId => {
      if (stats.users[userId]) {
        stats.users[userId].points = Math.max(0, (stats.users[userId].points || 0) - last.pointsPerPerson);
        stats.users[userId].operations = Math.max(0, (stats.users[userId].operations || 0) - 1);

        if (last.previousLastDrops && Object.prototype.hasOwnProperty.call(last.previousLastDrops, userId)) {
          stats.users[userId].lastDrop = last.previousLastDrops[userId];
        } else if (stats.users[userId].operations === 0) {
          stats.users[userId].lastDrop = null;
        }

        if (Array.isArray(stats.users[userId].drops) && last.timestamp) {
          stats.users[userId].drops = stats.users[userId].drops.filter(d => d.date !== last.timestamp);
        }
      }
    });

    if (typeof stats.totalOperations === 'number') {
      stats.totalOperations = Math.max(0, stats.totalOperations - 1);
    }

    try {
      const ch = await client.channels.fetch(REPORT_CHANNEL_ID);
      if (ch && last.messageIds && last.messageIds.length > 0) {
        for (const msgId of last.messageIds) {
          try {
            const msg = await ch.messages.fetch(msgId);
            await msg.delete();
          } catch (e) {}
        }
      }
    } catch (err) {
      console.error('Failed to delete report messages:', err);
    }

    delete stats.lastReport;
    saveStats(stats);

    return interaction.editReply({
      content: '✅ Last report has been undone.\n• Points and dropships reverted\n• Last Dropship restored\n• Drop history entry removed\n• Report messages deleted (if possible)'
    });
  }


  // ========== /testreminder ==========
  if (interaction.isChatInputCommand() && interaction.commandName === 'testreminder') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Prefer explicit channel option, else the VC the user is in
    let channel = interaction.options.getChannel('channel');

    if (!channel) {
      const member = interaction.member;
      if (member.voice && member.voice.channel) {
        channel = member.voice.channel;
      }
    }

    if (!channel || channel.type !== ChannelType.GuildVoice) {
      return interaction.editReply({
        content: 'Join a **Platoon Lead** voice channel first, or pass one with the `channel` option.\n' +
          'Example: `/testreminder channel:#Platoon-Lead-1`'
      });
    }

    if (!WATCHED_VOICE_CHANNELS.includes(channel.id)) {
      return interaction.editReply({
        content: `**${channel.name}** is not a watched channel.\n` +
          `Use Platoon Lead 1–3 or Briefing Room 1–3.`
      });
    }

    const memberCount = channel.members.filter(m => !m.user.bot).size;
    if (memberCount < 1) {
      return interaction.editReply({ content: 'There is no one in that voice channel to test with.' });
    }

    const info = ALL_WATCH_CHANNELS[channel.id] || {};
    const result = await playAarReminder(channel, memberCount, `${channel.name} (TEST)`, {
      doText: true,
      doAudio: true  // force audio on test so you can verify
    });

    return interaction.editReply({
      content:
        `✅ **Test reminder fired for ${channel.name}**\n` +
        `• Members in channel: **${memberCount}**\n` +
        `• Text reminder: ${result.textSent ? 'sent in channel' : 'failed'}\n` +
        `• Audio: ${result.audioPlayed ? 'playing now' : (result.error ? `failed — ${result.error}` : 'skipped (no aar-reminder.mp3)')}`
    });
  }


  // ========== /plpanel ==========
  if (interaction.isChatInputCommand() && interaction.commandName === 'plpanel') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const results = [];
    for (const [num, ds] of Object.entries(DROPSHIPS)) {
      try {
        const ch = await client.channels.fetch(ds.flightDeckId);
        if (!ch) {
          results.push(`Dropship ${num}: channel not found`);
          continue;
        }
        const embed = new EmbedBuilder()
          .setTitle(`${ds.name} — Platoon Lead`)
          .setDescription(
            'If you are the **Platoon Lead** for this dropship, click the button below.\n' +
            'This saves a snapshot of who is in:\n' +
            '• Platoon Lead\n• Demon\n• Nightmare\n• Cerberus\n• Hellfire\n\n' +
            'When you file the AAR you can assign squad leads from that roster, or pick Voice/Manual instead.'
          )
          .setColor(0x5865F2);

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`pl_claim_${num}`)
            .setLabel(`Yes — I'm PL for ${ds.name}`)
            .setStyle(ButtonStyle.Success)
        );

        await ch.send({ embeds: [embed], components: [row] });
        results.push(`Dropship ${num}: panel posted in <#${ds.flightDeckId}>`);
      } catch (err) {
        results.push(`Dropship ${num}: ${err.message}`);
      }
    }
    return interaction.editReply({ content: results.join('\n') });
  }

  // ========== PL Claim button ==========
  // Saves VC roster only. Squad leads are chosen later during AAR.
  if (interaction.isButton() && interaction.customId.startsWith('pl_claim_')) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch (e) {
      console.error('PL claim defer failed:', e.message);
      return;
    }

    const num = Number(interaction.customId.replace('pl_claim_', ''));
    if (!DROPSHIPS[num]) {
      return interaction.editReply({ content: 'Invalid dropship.' });
    }

    try {
      const snapshot = await takeDropshipSnapshot(interaction.guild, num, interaction.user.id);
      snapshot.squadLeads = {};
      if (!fs.existsSync('./data')) fs.mkdirSync('./data', { recursive: true });
      const snapshots = loadSnapshots();
      snapshots[interaction.user.id] = snapshot;
      saveSnapshots(snapshots);

      const rosterPreview = formatSnapshotLines(snapshot);
      const publicContent =
        `📋 **${snapshot.dropshipName} — PL set**\n` +
        rosterPreview +
        `\n_Snapshot saved for <@${interaction.user.id}>. Squad leads are chosen when they file the AAR._`;

      try {
        if (interaction.channel) await interaction.channel.send({ content: publicContent });
      } catch (err) {
        console.error('Failed to post PL public log:', err.message);
      }

      return interaction.editReply({
        content:
          `✅ You are PL for **${snapshot.dropshipName}**. VC snapshot saved.\n` +
          rosterPreview +
          `\n\nWhen you run the AAR you can:\n` +
          `• Assign squad leads from this roster, or\n` +
          `• Ignore the snapshot and pick a Voice Channel / people manually`
      });
    } catch (err) {
      console.error('PL claim failed:', err);
      try {
        await interaction.editReply({ content: `Failed to snapshot: ${err.message}` });
      } catch (_) {}
    }
    return;
  }

  // ========== Dropship lookup buttons ==========
  if (interaction.isButton() && interaction.customId.startsWith('ds_whole_')) {
    const num = interaction.customId.replace('ds_whole_', '');
    const rec = stats.dropships && stats.dropships[String(num)];
    if (!rec) {
      return interaction.reply({ content: `Dropship #${num} not found.`, flags: MessageFlags.Ephemeral });
    }
    const embed = new EmbedBuilder()
      .setTitle(`Dropship #${num} — Full Roster`)
      .setColor(0x5865F2)
      .setDescription(formatDropshipRecord(rec).slice(0, 4096))
      .setFooter({ text: '1st M.I.' });
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (interaction.isButton() && interaction.customId.startsWith('ds_user_')) {
    const num = interaction.customId.replace('ds_user_', '');
    const rec = stats.dropships && stats.dropships[String(num)];
    if (!rec) {
      return interaction.reply({ content: `Dropship #${num} not found.`, flags: MessageFlags.Ephemeral });
    }
    const userSelect = new UserSelectMenuBuilder()
      .setCustomId(`ds_pickuser_${num}`)
      .setPlaceholder('Select a user from this dropship')
      .setMinValues(1)
      .setMaxValues(1);
    return interaction.reply({
      content: `**Dropship #${num}** — select a user to see their squad and PL:`,
      components: [new ActionRowBuilder().addComponents(userSelect)],
      flags: MessageFlags.Ephemeral
    });
  }

  if (interaction.isUserSelectMenu() && interaction.customId.startsWith('ds_pickuser_')) {
    const num = interaction.customId.replace('ds_pickuser_', '');
    const rec = stats.dropships && stats.dropships[String(num)];
    const userId = interaction.values[0];
    if (!rec) {
      return interaction.reply({ content: `Dropship #${num} not found.`, flags: MessageFlags.Ephemeral });
    }

    let squadName = null;
    let squadMembers = [];
    const squads = rec.squads || {};
    for (const [name, ids] of Object.entries(squads)) {
      if (Array.isArray(ids) && ids.map(String).includes(String(userId))) {
        squadName = name;
        squadMembers = ids.map(String);
        break;
      }
    }
    const inRoster = Array.isArray(rec.users) && rec.users.map(String).includes(String(userId));
    const wasPL = rec.plUserId && String(rec.plUserId) === String(userId);
    const leadOf = [];
    for (const [name, id] of Object.entries(rec.squadLeads || {})) {
      if (id && String(id) === String(userId)) leadOf.push(name);
    }

    // Squad lead for the squad this user was in
    const squadLeadId = squadName && rec.squadLeads ? rec.squadLeads[squadName] : null;

    let squadPeopleText = '—';
    if (squadMembers.length) {
      squadPeopleText = squadMembers
        .map((id) => {
          const tags = [];
          if (String(id) === String(userId)) tags.push('you');
          if (squadLeadId && String(id) === String(squadLeadId)) tags.push('SL');
          if (rec.plUserId && String(id) === String(rec.plUserId)) tags.push('PL');
          const suffix = tags.length ? ` (${tags.join(', ')})` : '';
          return `• <@${id}>${suffix}`;
        })
        .join('\n');
    } else if (inRoster && Array.isArray(rec.users)) {
      // No squad breakdown (voice/manual AAR) — show full dropship roster
      squadPeopleText =
        '_No squad channels saved for this dropship. Full roster:_\n' +
        rec.users.map((id) => `• <@${id}>`).join('\n');
    } else if (!inRoster) {
      squadPeopleText = 'User was not found on this dropship roster.';
    }

    const embed = new EmbedBuilder()
      .setTitle(`Dropship #${num} — User Lookup`)
      .setColor(0x5865F2)
      .setDescription(`Looking up <@${userId}>`)
      .addFields(
        { name: 'Mode / Map', value: `${rec.mode || '—'} → ${rec.map || '—'}`, inline: true },
        { name: 'Dropship PL', value: rec.plUserId ? `<@${rec.plUserId}>` : '—', inline: true },
        { name: 'This user was PL?', value: wasPL ? 'Yes' : 'No', inline: true },
        {
          name: 'Their squad',
          value: squadName || (inRoster ? 'No squad breakdown (voice/manual report)' : 'Not on this dropship'),
          inline: true
        },
        {
          name: 'Squad Lead',
          value: squadLeadId ? `<@${squadLeadId}>` : (leadOf.length ? leadOf.join(', ') : '—'),
          inline: true
        },
        {
          name: 'Squad Lead of',
          value: leadOf.length ? leadOf.join(', ') : '—',
          inline: true
        },
        {
          name: squadName ? `Who was in ${squadName}` : 'Squad / roster',
          value: squadPeopleText.slice(0, 1024)
        }
      )
      .setFooter({ text: '1st M.I.' });

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  // ========== Game Mode ==========
  if (interaction.isButton() && interaction.customId.startsWith('mode_')) {
    const selected = GAME_MODES.find(m => m.id === interaction.customId);
    if (!selected) return;

    pending.set(interaction.user.id, {
      mode: selected.label,
      map: null,
      users: [],
      outcome: null,
      extracted: null
    });

    await interaction.reply({
      content: `**${selected.label}** — Choose Map:`,
      components: [buildMapRow()],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  // ========== Map ==========
  if (interaction.isButton() && interaction.customId.startsWith('map_')) {
    const data = pending.get(interaction.user.id);
    if (!data) return interaction.reply({ content: 'Session expired.', flags: MessageFlags.Ephemeral });

    data.map = MAPS.find(m => m.id === interaction.customId).label;

    const snapshots = loadSnapshots();
    const snap = snapshots[interaction.user.id];
    let squadPeople = 0;
    if (snap && snap.squads) {
      for (const [name, ids] of Object.entries(snap.squads)) {
        if (name === 'Platoon Lead') continue;
        squadPeople += Array.isArray(ids) ? ids.length : 0;
      }
    }
    const hasUsefulSnap = !!(snap && squadPeople > 0);

    if (hasUsefulSnap) {
      data.availableSnapshot = snap;
      data.aarSquadLeads = { ...(snap.squadLeads || {}) };

      // Acknowledge click immediately so Discord does not spin
      await interaction.deferUpdate();

      const squadNames = ['Demon', 'Nightmare', 'Cerberus', 'Hellfire'];
      const rows = [];

      for (const name of squadNames) {
        const optional = name === 'Cerberus';
        const inChannel = snap.squads[name] || [];
        const select = new StringSelectMenuBuilder()
          .setCustomId(`aar_squadlead_${name}`)
          .setMinValues(0)
          .setMaxValues(1);

        if (inChannel.length === 0) {
          select
            .setPlaceholder(`${name}: nobody in snapshot`)
            .setDisabled(true)
            .addOptions(
              new StringSelectMenuOptionBuilder()
                .setLabel('Nobody in snapshot')
                .setValue('none')
                .setDescription(`No one was in ${name}`)
            );
        } else {
          select.setPlaceholder(
            optional ? `${name} Squad Lead (optional)` : `${name} Squad Lead`
          );
          const ids = inChannel.slice(0, 25);
          const labels = await resolveMemberLabels(interaction.guild, ids);
          for (const userId of ids) {
            select.addOptions(
              new StringSelectMenuOptionBuilder()
                .setLabel(labels.get(userId) || userId)
                .setValue(userId)
                .setDescription(`From ${name} snapshot`)
            );
          }
        }
        rows.push(new ActionRowBuilder().addComponents(select));
      }

      // Bottom row: continue with snapshot OR pick voice/manual instead
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('method_snapshot')
            .setLabel('Continue with Snapshot')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('method_voice')
            .setLabel('Voice Channel instead')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('method_manual')
            .setLabel('Select People instead')
            .setStyle(ButtonStyle.Secondary)
        )
      );

      await interaction.editReply({
        content:
          `**${data.mode} → ${data.map}**\n` +
          `✅ Latest PL snapshot (**${snap.dropshipName}**)\n` +
          `${formatSnapshotLines(snap)}\n\n` +
          `Select **Squad Leads** from people who were in each squad (optional for empty squads).\n` +
          `Or use the buttons at the bottom to **skip the snapshot** and pick a Voice Channel / people instead.`,
        components: rows
      });
      return;
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('method_voice').setLabel('Select Voice Channel').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('method_manual').setLabel('Select People Manually').setStyle(ButtonStyle.Secondary)
    );

    await interaction.update({
      content:
        `**${data.mode} → ${data.map}**\n` +
        `How do you want to select the squad?\n` +
        `_(No useful PL snapshot — claim PL on a Flight Deck when people are in the squad VCs)_`,
      components: [row]
    });
    return;
  }

  // ========== AAR Squad Lead select (from snapshot during AAR) ==========
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('aar_squadlead_')) {
    const data = pending.get(interaction.user.id);
    if (!data) {
      return interaction.reply({ content: 'Session expired.', flags: MessageFlags.Ephemeral });
    }
    const squadName = interaction.customId.replace('aar_squadlead_', '');
    let selected = interaction.values[0] || null;
    if (selected === 'none') selected = null;

    const snap = data.availableSnapshot || data.snapshot;
    const allowed = (snap && snap.squads && snap.squads[squadName]) ? snap.squads[squadName] : [];
    if (selected && !allowed.includes(selected)) {
      return interaction.reply({
        content: `That user was not in **${squadName}** in the snapshot.`,
        flags: MessageFlags.Ephemeral
      });
    }

    if (!data.aarSquadLeads) data.aarSquadLeads = {};
    data.aarSquadLeads[squadName] = selected;
    pending.set(interaction.user.id, data);

    const leadsSummary = ['Demon', 'Nightmare', 'Cerberus', 'Hellfire']
      .map(n => `**${n}:** ${data.aarSquadLeads[n] ? `<@${data.aarSquadLeads[n]}>` : '_not set_'}`)
      .join('\n');

    await interaction.reply({
      content:
        `Updated **${squadName}** Squad Lead.\n\nCurrent leads:\n${leadsSummary}\n\n` +
        `Click **Continue with Snapshot** when ready, or use Voice/Manual instead.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  // ========== Method: Use PL Snapshot ==========
  if (interaction.isButton() && interaction.customId === 'method_snapshot') {
    const data = pending.get(interaction.user.id);
    if (!data) return interaction.reply({ content: 'Session expired.', flags: MessageFlags.Ephemeral });

    const snap = data.availableSnapshot || loadSnapshots()[interaction.user.id];
    if (!snap) {
      return interaction.update({
        content: 'No PL snapshot found. Pick Voice Channel or Select People Manually.',
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('method_voice').setLabel('Select Voice Channel').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('method_manual').setLabel('Select People Manually').setStyle(ButtonStyle.Secondary)
          )
        ]
      });
    }

    // Attach squad leads chosen during this AAR step
    snap.squadLeads = { ...(data.aarSquadLeads || snap.squadLeads || {}) };
    data.users = [...new Set([...(snap.allMemberIds || []), ...Object.values(snap.squadLeads).filter(Boolean)])];
    data.snapshot = snap;
    data.plUserId = snap.plUserId;
    delete data.availableSnapshot;

    const row = buildOutcomeRow();
    const changeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('method_voice').setLabel('Change: Voice Channel').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('method_manual').setLabel('Change: Select Manually').setStyle(ButtonStyle.Secondary)
    );

    await interaction.update({
      content:
        `**${data.mode} → ${data.map}**\n` +
        `✅ Using PL snapshot (**${snap.dropshipName}**)\n` +
        `${formatSnapshotLines(snap)}\n\n` +
        `Choose Outcome (or change squad):`,
      components: [row, changeRow]
    });
    return;
  }

  // ========== Method: Voice ==========
  if (interaction.isButton() && interaction.customId === 'method_voice') {
    const data = pending.get(interaction.user.id);
    if (!data) return interaction.reply({ content: 'Session expired.', flags: MessageFlags.Ephemeral });
    // User chose not to use snapshot roster
    delete data.snapshot;
    delete data.availableSnapshot;

    const channelSelect = new ChannelSelectMenuBuilder()
      .setCustomId('aar_voice')
      .setPlaceholder('Select the Voice Channel')
      .addChannelTypes(ChannelType.GuildVoice);

    await interaction.update({
      content: `**${data.mode} → ${data.map}**\nSelect the Voice Channel:`,
      components: [new ActionRowBuilder().addComponents(channelSelect)]
    });
    return;
  }

  // ========== Method: Manual ==========
  if (interaction.isButton() && interaction.customId === 'method_manual') {
    const data = pending.get(interaction.user.id);
    if (!data) return interaction.reply({ content: 'Session expired.', flags: MessageFlags.Ephemeral });
    // User chose not to use snapshot roster
    delete data.snapshot;
    delete data.availableSnapshot;

    const userSelect = new UserSelectMenuBuilder()
      .setCustomId('aar_users')
      .setPlaceholder('Select squad members')
      .setMinValues(1)
      .setMaxValues(25);

    await interaction.update({
      content: `**${data.mode} → ${data.map}**\nSelect the people:`,
      components: [new ActionRowBuilder().addComponents(userSelect)]
    });
    return;
  }

  // ========== Voice Channel Selected ==========
  if (interaction.isChannelSelectMenu() && interaction.customId === 'aar_voice') {
    const data = pending.get(interaction.user.id);
    if (!data) return interaction.reply({ content: 'Session expired.', flags: MessageFlags.Ephemeral });

    const voiceChannel = await interaction.guild.channels.fetch(interaction.values[0]).catch(() => null);
    if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
      return interaction.update({ content: 'Invalid voice channel.', components: [] });
    }

    const membersInVC = [...voiceChannel.members.keys()];
    if (membersInVC.length === 0) {
      return interaction.update({
        content: `No one is in **${voiceChannel.name}**.`,
        components: []
      });
    }

    data.users = membersInVC;

    const row = buildOutcomeRow();

    const memberMentions = membersInVC.map(id => `<@${id}>`).join(' ');

    await interaction.update({
      content: `**${data.mode} → ${data.map}**\nSquad from **${voiceChannel.name}**:\n${memberMentions}\n\nChoose Outcome:`,
      components: [row]
    });
    return;
  }

  // ========== Manual Users Selected ==========
  if (interaction.isUserSelectMenu() && interaction.customId === 'aar_users') {
    const data = pending.get(interaction.user.id);
    if (!data) return interaction.reply({ content: 'Session expired.', flags: MessageFlags.Ephemeral });

    data.users = interaction.values;

    const row = buildOutcomeRow();

    await interaction.update({
      content: `**${data.mode} → ${data.map}**\nChoose Outcome:`,
      components: [row]
    });
    return;
  }

  // ========== Outcome ==========
  if (interaction.isButton() && interaction.customId.startsWith('outcome_')) {
    const data = pending.get(interaction.user.id);
    if (!data) return interaction.reply({ content: 'Session expired.', flags: MessageFlags.Ephemeral });

    if (interaction.customId === 'outcome_success') data.outcome = 'Success';
    if (interaction.customId === 'outcome_partial') data.outcome = 'Partial';
    if (interaction.customId === 'outcome_failure') data.outcome = 'Failure';

    const row = buildExtractRow();

    await interaction.update({
      content: `**${data.mode} → ${data.map} → ${data.outcome}**\nWas it a full extract?`,
      components: [row]
    });
    return;
  }

  // ========== Extraction ==========
  if (interaction.isButton() && (interaction.customId === 'extract_yes' || interaction.customId === 'extract_no')) {
    const data = pending.get(interaction.user.id);
    if (!data) return interaction.reply({ content: 'Session expired.', flags: MessageFlags.Ephemeral });

    data.extracted = interaction.customId === 'extract_yes' ? 'Yes' : 'No';
    await showModal(interaction, data);
    return;
  }

  // ========== Modal Submit ==========
  if (interaction.isModalSubmit() && interaction.customId === 'aar_modal') {
    const data = pending.get(interaction.user.id);
    if (!data) return interaction.reply({ content: 'Session expired.', flags: MessageFlags.Ephemeral });

    const mission = interaction.fields.getTextInputValue('mission') || 'N/A';
    const notes = interaction.fields.getTextInputValue('notes') || 'None';

    const pointsPerPerson = data.extracted === 'Yes' ? 3 : 1;
    const now = new Date().toISOString();

    if (typeof stats.totalOperations !== 'number') stats.totalOperations = 0;
    if (!stats.dropships) stats.dropships = {};
    stats.totalOperations += 1;
    const dropshipNumber = stats.totalOperations;

    const previousLastDrops = {};
    const snap = data.snapshot || null;
    const plUserId = data.plUserId || (snap && snap.plUserId) || null;
    const squadLeads = (snap && snap.squadLeads) ? { ...snap.squadLeads } : { ...(data.aarSquadLeads || {}) };
    const squads = (snap && snap.squads) ? { ...snap.squads } : {};

    // Build PL/SL sets for counting
    const slIds = new Set(Object.values(squadLeads).filter(Boolean).map(String));

    data.users.forEach(userId => {
      const u = ensureUserStats(userId);
      previousLastDrops[userId] = u.lastDrop || null;

      u.points += pointsPerPerson;
      u.operations += 1;
      u.lastDrop = now;

      const wasPL = plUserId && String(plUserId) === String(userId);
      const wasSL = slIds.has(String(userId));
      if (wasPL) u.plCount = (u.plCount || 0) + 1;
      if (wasSL) u.slCount = (u.slCount || 0) + 1;

      // Which squad was this user in?
      let squadName = null;
      for (const [name, ids] of Object.entries(squads)) {
        if (Array.isArray(ids) && ids.map(String).includes(String(userId))) {
          squadName = name;
          break;
        }
      }

      u.drops.push({
        date: now,
        dropshipNumber,
        mode: data.mode,
        map: data.map,
        mission: mission,
        outcome: data.outcome,
        extracted: data.extracted,
        points: pointsPerPerson,
        notes: notes,
        squad: [...data.users],
        plUserId: plUserId || null,
        wasPL: !!wasPL,
        wasSL: !!wasSL,
        squadName
      });
    });

    // Count PL even if PL not in data.users list
    if (plUserId) {
      const pl = ensureUserStats(plUserId);
      if (!data.users.map(String).includes(String(plUserId))) {
        // already counted above if in users; only if not in list
        pl.plCount = (pl.plCount || 0) + 1;
      }
    }

    const dropshipRecord = {
      number: dropshipNumber,
      date: now,
      mode: data.mode,
      map: data.map,
      mission,
      outcome: data.outcome,
      extracted: data.extracted,
      pointsPerPerson,
      notes,
      users: [...data.users],
      plUserId: plUserId || null,
      squadLeads,
      squads,
      reportedBy: interaction.user.id
    };
    stats.dropships[String(dropshipNumber)] = dropshipRecord;

    stats.lastReport = {
      users: [...data.users],
      pointsPerPerson: pointsPerPerson,
      messageIds: [],
      timestamp: now,
      previousLastDrops: previousLastDrops,
      dropshipNumber
    };

    saveStats(stats);

    const userMentions = data.users.map(id => `<@${id}>`).join(' ');
    const pointsText = data.extracted === 'Yes' ? '+3 points each' : '+1 point each';
    const reportImage = data.extracted === 'Yes' ? VICTORY_IMAGE : DEFEAT_IMAGE;
    const embedColor = data.extracted === 'Yes' ? 0x57F287 : 0xED4245;

    const reportEmbed = new EmbedBuilder()
      .setTitle(`After Action Report — Dropship #${dropshipNumber}`)
      .setColor(embedColor)
      .setImage(reportImage)
      .addFields(
        { name: 'Dropship #', value: `**${dropshipNumber}**`, inline: true },
        { name: 'Game Mode', value: data.mode, inline: true },
        { name: 'Map', value: data.map, inline: true },
        { name: 'Mission', value: mission, inline: true },
        { name: 'Outcome', value: data.outcome, inline: true },
        { name: 'Full Extract?', value: data.extracted, inline: true },
        { name: 'Points Awarded', value: pointsText, inline: true },
        { name: 'Squad', value: data.snapshot ? '_See Dropship / PL Roster below_' : (userMentions || '—') },
        ...(data.snapshot ? [
          { name: 'Dropship / PL Roster', value: formatSnapshotLines(data.snapshot).slice(0, 1024) }
        ] : []),
        { name: 'Notes / Debrief', value: notes }
      )
      .setFooter({ text: `Reported by ${interaction.user.tag}` })
      .setTimestamp();

    let totalPoints = 0;
    for (const userId in stats.users) {
      totalPoints += stats.users[userId].points || 0;
    }

    const totalEmbed = new EmbedBuilder()
      .setTitle('1st M.I. — Server Dropship Record')
      .setColor(0x5865F2)
      .addFields(
        { name: 'Total Dropships', value: `**${stats.totalOperations}**`, inline: true },
        { name: 'Total Points Awarded', value: `**${totalPoints}**`, inline: true }
      )
      .setFooter({ text: '1st M.I.' })
      .setTimestamp();

    try {
      const ch = await client.channels.fetch(REPORT_CHANNEL_ID);
      if (ch) {
        const reportMsg = await ch.send({ embeds: [reportEmbed] });
        const totalMsg = await ch.send({ embeds: [totalEmbed] });

        stats.lastReport.messageIds = [reportMsg.id, totalMsg.id];
        saveStats(stats);
      }
    } catch (err) {
      console.error('Failed to send report:', err);
    }

    await interaction.reply({
      content: 'Report submitted.',
      flags: MessageFlags.Ephemeral
    });

    setTimeout(async () => {
      try { await interaction.deleteReply(); } catch (e) {}
    }, 2000);

    pending.delete(interaction.user.id);
  }
});

async function showModal(interaction, data) {
  const modal = new ModalBuilder()
    .setCustomId('aar_modal')
    .setTitle(`AAR — ${data.mode}`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('mission')
        .setLabel('Mission / Operation Name (optional)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('notes')
        .setLabel('Notes / Casualties / Debrief')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
    )
  );

  await interaction.showModal(modal);
}

// Register commands on MAIN server + extra servers
client.on(Events.ClientReady, async () => {
  const commandList = [
    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Post the AAR panel in the questions channel'),

    new SlashCommandBuilder()
      .setName('drops')
      .setDescription('Check points and total dropships of a member')
      .addUserOption(opt => opt.setName('user').setDescription('Member').setRequired(true)),

    new SlashCommandBuilder()
      .setName('pl')
      .setDescription('How many times a member has been Platoon Lead')
      .addUserOption(opt => opt.setName('user').setDescription('Member (default: you)').setRequired(false)),

    new SlashCommandBuilder()
      .setName('sl')
      .setDescription('How many times a member has been Squad Lead')
      .addUserOption(opt => opt.setName('user').setDescription('Member (default: you)').setRequired(false)),

    new SlashCommandBuilder()
      .setName('dropship')
      .setDescription('Look up a numbered dropship roster / user placement')
      .addIntegerOption(opt =>
        opt.setName('number').setDescription('Dropship number from the AAR').setRequired(true).setMinValue(1)
      ),

    new SlashCommandBuilder()
      .setName('droplist')
      .setDescription('Show the full dropship history of a member')
      .addUserOption(opt => opt.setName('user').setDescription('Member').setRequired(true)),

    new SlashCommandBuilder()
      .setName('1stmidrops')
      .setDescription('Show total dropships for the entire server'),

    new SlashCommandBuilder()
      .setName('servermembers')
      .setDescription('List all members who have points/dropships'),

    new SlashCommandBuilder()
      .setName('setstats')
      .setDescription("Manually set a member's points and dropships")
      .addUserOption(opt => opt.setName('user').setDescription('The member').setRequired(true))
      .addIntegerOption(opt => opt.setName('points').setDescription('New points value').setRequired(false))
      .addIntegerOption(opt => opt.setName('operations').setDescription('New dropships value').setRequired(false)),

    new SlashCommandBuilder()
      .setName('settotal')
      .setDescription('Set the server Total Dropships number')
      .addIntegerOption(opt => opt.setName('total').setDescription('New total dropships').setRequired(true)),

    new SlashCommandBuilder()
      .setName('setall')
      .setDescription('Set Points and Dropships for EVERYONE in the main server')
      .addIntegerOption(opt => opt.setName('points').setDescription('Points to set for everyone').setRequired(false))
      .addIntegerOption(opt => opt.setName('operations').setDescription('Dropships to set for everyone').setRequired(false)),

    new SlashCommandBuilder()
      .setName('undolast')
      .setDescription('Undo the last After Action Report (Admin only)'),

    new SlashCommandBuilder()
      .setName('testreminder')
      .setDescription('TEST: fire AAR reminder on a watched voice channel')
      .addChannelOption(opt =>
        opt.setName('channel')
          .setDescription('Channel to test (or join one and omit this)')
          .addChannelTypes(ChannelType.GuildVoice)
          .setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName('plpanel')
      .setDescription('Post Platoon Lead claim buttons in all Flight Deck chats'),

    new SlashCommandBuilder()
      .setName('ranknotify')
      .setDescription('Set the channel for rank time-in-grade notifications')
      .addChannelOption(opt =>
        opt.setName('channel')
          .setDescription('Text channel for rank alerts')
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('ranklist')
      .setDescription('List tracked ranks and days held')
      .addStringOption(opt =>
        opt.setName('rank')
          .setDescription('Optional rank key filter e.g. SGT, SSGT, MSGT')
          .setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName('ranktest')
      .setDescription('Test rank ping routing for a user (pings roles in this channel)')
      .addUserOption(opt =>
        opt.setName('user')
          .setDescription('User to test')
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('sergeantnotify')
      .setDescription('Alias of /ranknotify')
      .addChannelOption(opt =>
        opt.setName('channel')
          .setDescription('Text channel for rank alerts')
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName('sergeantlist')
      .setDescription('Alias of /ranklist'),

    new SlashCommandBuilder()
      .setName('syncroles')
      .setDescription('Grant linked roles to everyone who already has a trigger role')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    ...memberBackupCommandBuilders(),
    ...activityStatsCommandBuilders(),
    ...lftCommandBuilders(),
    ...buildCertCommandBuilders()
  ];

  const guildIds = [TARGET_GUILD_ID, ...EXTRA_GUILD_IDS];

  for (const guildId of guildIds) {
    try {
      const guild = await client.guilds.fetch(guildId);
      await guild.commands.set(commandList);
      console.log(`Slash commands registered for guild ${guildId}`);
    } catch (err) {
      console.error(`Failed to register commands for guild ${guildId}:`, err.message);
    }
  }
});

client.login(process.env.TOKEN || process.env.DISCORD_TOKEN);
