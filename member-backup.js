/**
 * Track member nicknames + roles so admins can restore after a hack / kick / timeout.
 */
const fs = require('fs');
const path = require('path');
const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  EmbedBuilder,
  AuditLogEvent
} = require('discord.js');

const DATA_FILE = path.join(__dirname, 'data', 'member-backup.json');
const MAX_HISTORY = 20;
const TARGET_GUILD_ID = '1256977709884641382';

function loadStore() {
  try {
    if (!fs.existsSync(DATA_FILE)) return { members: {} };
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!data.members || typeof data.members !== 'object') data.members = {};
    return data;
  } catch {
    return { members: {} };
  }
}

function saveStore(store) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
}

let store = loadStore();

function collectRoleIds(member) {
  if (!member?.roles?.cache) return [];
  return [...member.roles.cache.keys()]
    .filter((id) => id !== member.guild.id)
    .sort();
}

function sameRoles(a, b) {
  if (a.length !== b.length) return false;
  return a.every((id, i) => id === b[i]);
}

function snapshotFromMember(member, reason) {
  return {
    nickname: member.nickname || null,
    username: member.user?.username || null,
    displayName: member.displayName || null,
    roleIds: collectRoleIds(member),
    at: new Date().toISOString(),
    reason: reason || 'update'
  };
}

function ensureRecord(userId) {
  if (!store.members[userId]) {
    store.members[userId] = { history: [], current: null };
  }
  if (!Array.isArray(store.members[userId].history)) {
    store.members[userId].history = [];
  }
  return store.members[userId];
}

function pushHistory(rec, snap) {
  const last = rec.history[rec.history.length - 1];
  if (
    last &&
    last.nickname === snap.nickname &&
    sameRoles(last.roleIds || [], snap.roleIds || []) &&
    last.reason === snap.reason
  ) {
    return false;
  }
  rec.history.push(snap);
  if (rec.history.length > MAX_HISTORY) {
    rec.history = rec.history.slice(-MAX_HISTORY);
  }
  return true;
}

function saveMemberState(member, reason) {
  if (!member || member.user?.bot) return false;
  const rec = ensureRecord(member.id);
  const snap = snapshotFromMember(member, reason);
  rec.tag = member.user?.tag || rec.tag || member.id;
  rec.current = snap;
  rec.updatedAt = snap.at;
  const changed = pushHistory(rec, snap);
  saveStore(store);
  return changed;
}

async function handleMemberUpdate(oldMember, newMember) {
  if (!newMember || newMember.guild?.id !== TARGET_GUILD_ID) return;
  if (newMember.user?.bot) return;

  const oldNick = oldMember.nickname || null;
  const newNick = newMember.nickname || null;
  const oldRoles = collectRoleIds(oldMember);
  const newRoles = collectRoleIds(newMember);
  const oldTimeout = oldMember.communicationDisabledUntilTimestamp || null;
  const newTimeout = newMember.communicationDisabledUntilTimestamp || null;
  const timedOut = !oldTimeout && !!newTimeout;

  if (oldNick === newNick && sameRoles(oldRoles, newRoles) && !timedOut) return;

  // Keep the *previous* state first so a role wipe still has the good snapshot.
  if (oldMember.roles?.cache?.size) {
    saveMemberState(oldMember, timedOut ? 'before-timeout' : 'before-update');
  }

  let reason = 'update';
  if (timedOut) reason = 'timeout';
  else if (oldNick !== newNick && !sameRoles(oldRoles, newRoles)) reason = 'nick+roles';
  else if (oldNick !== newNick) reason = 'nick';
  else if (!sameRoles(oldRoles, newRoles)) reason = 'roles';

  saveMemberState(newMember, reason);
}

async function leaveReason(guild, userId) {
  try {
    const kicks = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 5 });
    const kick = kicks.entries.find(
      (e) => e.targetId === userId && Date.now() - e.createdTimestamp < 15000
    );
    if (kick) return `kicked by ${kick.executor?.tag || kick.executorId}`;
  } catch (_) {}
  try {
    const bans = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 5 });
    const ban = bans.entries.find(
      (e) => e.targetId === userId && Date.now() - e.createdTimestamp < 15000
    );
    if (ban) return `banned by ${ban.executor?.tag || ban.executorId}`;
  } catch (_) {}
  return 'left';
}

async function handleMemberRemove(member) {
  if (!member || member.guild?.id !== TARGET_GUILD_ID) return;
  if (member.user?.bot) return;
  const reason = await leaveReason(member.guild, member.id);
  saveMemberState(member, reason);
}

async function handleMemberAdd(member) {
  if (!member || member.guild?.id !== TARGET_GUILD_ID) return;
  if (member.user?.bot) return;
  saveMemberState(member, 'rejoin');
}

async function seedCurrentMembers(guild) {
  await guild.members.fetch().catch(() => {});
  let saved = 0;
  for (const member of guild.members.cache.values()) {
    if (member.user?.bot) continue;
    const rec = ensureRecord(member.id);
    if (rec.current) continue;
    saveMemberState(member, 'seed');
    saved++;
  }
  console.log(`[BACKUP] Seeded ${saved} member snapshot(s)`);
  return saved;
}

function formatRoleList(guild, roleIds) {
  if (!roleIds?.length) return '_none_';
  const names = roleIds.map((id) => {
    const role = guild?.roles?.cache?.get(id);
    return role ? `<@&${id}>` : `\`${id}\``;
  });
  const text = names.join(' ');
  return text.length > 1000 ? `${text.slice(0, 1000)}…` : text;
}

function pickRestoreSnapshot(rec, source) {
  const history = rec.history || [];
  if (!history.length && rec.current) return rec.current;
  if (!history.length) return null;

  if (source === 'latest') return history[history.length - 1];
  if (source === 'most_roles') {
    return [...history].sort((a, b) => (b.roleIds?.length || 0) - (a.roleIds?.length || 0))[0];
  }

  // before_leave: snapshot just before kick/leave/timeout, else most roles
  for (let i = history.length - 1; i >= 0; i--) {
    const reason = String(history[i].reason || '');
    if (/kick|ban|left|timeout/i.test(reason)) {
      if (i > 0) return history[i - 1];
    }
  }
  return history[history.length - 1];
}

function lookupEmbed(guild, user, rec) {
  const embed = new EmbedBuilder()
    .setTitle('Member backup')
    .setColor(0x5865F2)
    .setDescription(`${user}`)
    .setFooter({ text: '1st M.I. • Use /restoremember to apply a snapshot' });

  const current = rec?.current;
  if (!current && !rec?.history?.length) {
    embed.addFields({ name: 'Status', value: 'No snapshots yet. They will be saved when nick/roles change, or on leave/timeout.' });
    return embed;
  }

  if (current) {
    embed.addFields(
      { name: 'Last nickname', value: current.nickname || current.displayName || '_none_', inline: true },
      { name: 'Username', value: current.username || '_unknown_', inline: true },
      { name: 'Updated', value: `<t:${Math.floor(new Date(current.at).getTime() / 1000)}:R>`, inline: true },
      { name: `Last roles (${current.roleIds?.length || 0})`, value: formatRoleList(guild, current.roleIds) }
    );
  }

  const recent = (rec.history || []).slice(-8).reverse();
  if (recent.length) {
    const lines = recent.map((snap, idx) => {
      const n = (rec.history.length - idx);
      const nick = snap.nickname || snap.displayName || '_none_';
      return `**#${n}** <t:${Math.floor(new Date(snap.at).getTime() / 1000)}:d> — \`${snap.reason}\` — **${nick}** — ${snap.roleIds?.length || 0} roles`;
    });
    embed.addFields({ name: 'Recent snapshots', value: lines.join('\n').slice(0, 1024) });
  }
  return embed;
}

async function restoreSnapshot(member, snap) {
  const result = { nick: false, rolesAdded: 0, rolesSkipped: 0, errors: [] };
  if (!member || !snap) return result;

  if (snap.nickname && member.nickname !== snap.nickname) {
    try {
      await member.setNickname(snap.nickname, 'restoremember backup');
      result.nick = true;
    } catch (err) {
      result.errors.push(`nickname: ${err.message}`);
    }
  }

  const me = member.guild.members.me;
  const myPos = me?.roles?.highest?.position ?? 0;

  for (const roleId of snap.roleIds || []) {
    if (member.roles.cache.has(roleId)) continue;
    const role = member.guild.roles.cache.get(roleId);
    if (!role) {
      result.rolesSkipped++;
      continue;
    }
    if (role.managed) {
      result.rolesSkipped++;
      continue;
    }
    if (role.position >= myPos) {
      result.rolesSkipped++;
      result.errors.push(`cannot add ${role.name} (higher than bot)`);
      continue;
    }
    try {
      await member.roles.add(role, 'restoremember backup');
      result.rolesAdded++;
    } catch (err) {
      result.errors.push(`${role.name}: ${err.message}`);
    }
  }
  return result;
}

function commandBuilders() {
  return [
    new SlashCommandBuilder()
      .setName('memberlookup')
      .setDescription('Look up a member’s saved nickname and roles')
      .addUserOption((opt) =>
        opt.setName('user').setDescription('Member to look up').setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),
    new SlashCommandBuilder()
      .setName('restoremember')
      .setDescription('Restore a member’s saved nickname and roles')
      .addUserOption((opt) =>
        opt.setName('user').setDescription('Member to restore').setRequired(true)
      )
      .addStringOption((opt) =>
        opt
          .setName('source')
          .setDescription('Which snapshot to use')
          .setRequired(false)
          .addChoices(
            { name: 'Before kick / timeout (default)', value: 'before_leave' },
            { name: 'Most roles', value: 'most_roles' },
            { name: 'Latest snapshot', value: 'latest' }
          )
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  ];
}

async function handleMemberBackupCommand(interaction) {
  if (!interaction.isChatInputCommand()) return false;
  if (!['memberlookup', 'restoremember'].includes(interaction.commandName)) return false;

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
    await interaction.reply({
      content: 'You need **Manage Roles** to use this.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const user = interaction.options.getUser('user');
  const rec = store.members[user.id];

  if (interaction.commandName === 'memberlookup') {
    const embed = lookupEmbed(interaction.guild, user, rec);
    await interaction.reply({ embeds: [embed] });
    return true;
  }

  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) {
    await interaction.reply({
      content:
        `${user} is not in the server right now.\n` +
        `Use \`/memberlookup\` to see their last nick/roles, then run \`/restoremember\` after they rejoin.`,
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (!rec?.history?.length && !rec?.current) {
    await interaction.reply({
      content: `No backup saved for ${user} yet.`,
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const source = interaction.options.getString('source') || 'before_leave';
  const snap = pickRestoreSnapshot(rec, source);
  if (!snap) {
    await interaction.reply({ content: 'No usable snapshot found.', flags: MessageFlags.Ephemeral });
    return true;
  }

  await interaction.deferReply();
  const result = await restoreSnapshot(member, snap);
  const nick = snap.nickname || snap.displayName || '_none_';
  const errText = result.errors.length ? `\n${result.errors.slice(0, 8).join('\n')}` : '';
  await interaction.editReply(
    `✅ Restored **${source}** snapshot for ${user}\n` +
      `• Snapshot: <t:${Math.floor(new Date(snap.at).getTime() / 1000)}:f> (\`${snap.reason}\`)\n` +
      `• Nickname: **${nick}**${result.nick ? ' (updated)' : ''}\n` +
      `• Roles added: **${result.rolesAdded}** · skipped: **${result.rolesSkipped}**` +
      errText
  );
  return true;
}

async function startMemberBackup(client) {
  console.log('[BACKUP] Member nickname/role backup starting…');
  try {
    const guild = await client.guilds.fetch(TARGET_GUILD_ID);
    await seedCurrentMembers(guild);
  } catch (err) {
    console.warn('[BACKUP] Seed skipped:', err.message);
  }
}

module.exports = {
  startMemberBackup,
  handleMemberUpdate: handleMemberUpdate,
  handleMemberRemove,
  handleMemberAdd,
  handleMemberBackupCommand,
  memberBackupCommandBuilders: commandBuilders
};
