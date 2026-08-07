require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
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
const fs = require('fs');
const http = require('http');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// ========== MAIN SERVER ==========
const TARGET_GUILD_ID = '1256977709884641382';
const PANEL_CHANNEL_ID = '1533983126970433677';
const REPORT_CHANNEL_ID = '1533983132464840765';
// =================================

const EXTRA_GUILD_IDS = ['1352675653798989947'];

const STATS_FILE = './data/stats.json';

if (!fs.existsSync('./data')) {
  fs.mkdirSync('./data', { recursive: true });
}

function loadStats() {
  if (!fs.existsSync(STATS_FILE)) {
    return { totalOperations: 0, users: {} };
  }
  try {
    const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    if (typeof data.totalOperations !== 'number') data.totalOperations = 0;
    if (!data.users) data.users = {};
    return data;
  } catch {
    return { totalOperations: 0, users: {} };
  }
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

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/' || req.url === '/health') {
    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (req.url === '/stats') {
    let totalPoints = 0;
    for (const userId in stats.users) {
      totalPoints += stats.users[userId].points || 0;
    }
    res.end(JSON.stringify({
      totalDropships: stats.totalOperations || 0,
      totalPoints: totalPoints
    }));
  } else {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Stats API running on port ${PORT}`);
});

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {

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

    // Show newest first
    const sorted = [...drops].reverse();
    const pages = [];
    let current = '';

    sorted.forEach((drop, index) => {
      const num = sorted.length - index;
      const dateText = drop.date
        ? `<t:${Math.floor(new Date(drop.date).getTime() / 1000)}:f>`
        : 'Unknown date';

      const line =
        `**#${num}** — ${dateText}\n` +
        `• Mode: **${drop.mode || 'N/A'}** | Map: **${drop.map || 'N/A'}**\n` +
        `• Outcome: **${drop.outcome || 'N/A'}** | Extract: **${drop.extracted || 'N/A'}**\n` +
        `• Points: **+${drop.points || 0}** | Mission: ${drop.mission || 'N/A'}\n\n`;

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

    // If more pages, send them as follow-ups
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

        // Restore previous Last Dropship date
        if (last.previousLastDrops && Object.prototype.hasOwnProperty.call(last.previousLastDrops, userId)) {
          stats.users[userId].lastDrop = last.previousLastDrops[userId];
        } else if (stats.users[userId].operations === 0) {
          stats.users[userId].lastDrop = null;
        }

        // Remove the matching drop from history
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

    const row = new ActionRowBuilder();
    MAPS.forEach(map => {
      row.addComponents(new ButtonBuilder().setCustomId(map.id).setLabel(map.label).setStyle(ButtonStyle.Primary));
    });

    await interaction.reply({
      content: `**${selected.label}** — Choose Map:`,
      components: [row],
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  // ========== Map ==========
  if (interaction.isButton() && interaction.customId.startsWith('map_')) {
    const data = pending.get(interaction.user.id);
    if (!data) return interaction.reply({ content: 'Session expired.', flags: MessageFlags.Ephemeral });

    data.map = MAPS.find(m => m.id === interaction.customId).label;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('method_voice').setLabel('Select Voice Channel').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('method_manual').setLabel('Select People Manually').setStyle(ButtonStyle.Secondary)
    );

    await interaction.update({
      content: `**${data.mode} → ${data.map}**\nHow do you want to select the squad?`,
      components: [row]
    });
    return;
  }

  // ========== Method: Voice ==========
  if (interaction.isButton() && interaction.customId === 'method_voice') {
    const data = pending.get(interaction.user.id);
    if (!data) return interaction.reply({ content: 'Session expired.', flags: MessageFlags.Ephemeral });

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

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('outcome_success').setLabel('Success').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('outcome_partial').setLabel('Partial').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('outcome_failure').setLabel('Failure').setStyle(ButtonStyle.Danger)
    );

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

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('outcome_success').setLabel('Success').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('outcome_partial').setLabel('Partial').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('outcome_failure').setLabel('Failure').setStyle(ButtonStyle.Danger)
    );

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

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('extract_yes').setLabel('Yes').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('extract_no').setLabel('No').setStyle(ButtonStyle.Danger)
    );

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
    stats.totalOperations += 1;

    const previousLastDrops = {};

    data.users.forEach(userId => {
      if (!stats.users[userId]) {
        stats.users[userId] = { points: 0, operations: 0, lastDrop: null, drops: [] };
      }
      if (!Array.isArray(stats.users[userId].drops)) {
        stats.users[userId].drops = [];
      }

      previousLastDrops[userId] = stats.users[userId].lastDrop || null;

      stats.users[userId].points += pointsPerPerson;
      stats.users[userId].operations += 1;
      stats.users[userId].lastDrop = now;

      // Add to detailed history
      stats.users[userId].drops.push({
        date: now,
        mode: data.mode,
        map: data.map,
        mission: mission,
        outcome: data.outcome,
        extracted: data.extracted,
        points: pointsPerPerson,
        notes: notes
      });
    });

    stats.lastReport = {
      users: [...data.users],
      pointsPerPerson: pointsPerPerson,
      messageIds: [],
      timestamp: now,
      previousLastDrops: previousLastDrops
    };

    saveStats(stats);

    const userMentions = data.users.map(id => `<@${id}>`).join(' ');
    const pointsText = data.extracted === 'Yes' ? '+3 points each' : '+1 point each';
    const reportImage = data.extracted === 'Yes' ? VICTORY_IMAGE : DEFEAT_IMAGE;
    const embedColor = data.extracted === 'Yes' ? 0x57F287 : 0xED4245;

    const reportEmbed = new EmbedBuilder()
      .setTitle(`After Action Report — ${data.mode}`)
      .setColor(embedColor)
      .setImage(reportImage)
      .addFields(
        { name: 'Game Mode', value: data.mode, inline: true },
        { name: 'Map', value: data.map, inline: true },
        { name: 'Mission', value: mission, inline: true },
        { name: 'Outcome', value: data.outcome, inline: true },
        { name: 'Full Extract?', value: data.extracted, inline: true },
        { name: 'Points Awarded', value: pointsText, inline: true },
        { name: 'Squad', value: userMentions },
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
      .setDescription('Undo the last After Action Report (Admin only)')
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

client.login(process.env.TOKEN);
