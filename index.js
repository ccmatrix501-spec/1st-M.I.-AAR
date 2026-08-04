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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// ========== YOUR SERVER ==========
const TARGET_GUILD_ID = '1256977709884641382';
// ================================

const CONFIG_FILE = './config.json';
const STATS_FILE = './stats.json';

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    return { panelChannelId: null, reportChannelId: null };
  }
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

let config = loadConfig();

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
const DEFEAT_IMAGE  = 'https://i.imgur.com/uh3NI8g.png';

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

client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {

  // ========== /setup ==========
  if (interaction.isChatInputCommand() && interaction.commandName === 'setup') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const guild = await client.guilds.fetch(TARGET_GUILD_ID);
      if (!guild) return interaction.editReply({ content: 'Could not find the target server.' });

      const me = await guild.members.fetchMe();
      if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.editReply({ content: 'I need **Manage Channels** permission.' });
      }

      let panelChannel = config.panelChannelId ? await client.channels.fetch(config.panelChannelId).catch(() => null) : null;
      if (!panelChannel) {
        panelChannel = await guild.channels.create({
          name: 'aar-panel',
          type: ChannelType.GuildText,
          permissionOverwrites: [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageMessages] }
          ]
        });
        config.panelChannelId = panelChannel.id;
      }

      let reportChannel = config.reportChannelId ? await client.channels.fetch(config.reportChannelId).catch(() => null) : null;
      if (!reportChannel) {
        reportChannel = await guild.channels.create({
          name: 'after-action-reports',
          type: ChannelType.GuildText,
          permissionOverwrites: [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] }
          ]
        });
        config.reportChannelId = reportChannel.id;
      }

      saveConfig(config);

      const row = new ActionRowBuilder();
      GAME_MODES.forEach(mode => {
        row.addComponents(new ButtonBuilder().setCustomId(mode.id).setLabel(mode.label).setStyle(ButtonStyle.Primary));
      });

      const panelEmbed = new EmbedBuilder()
        .setTitle('1st M.I. — After Action Report')
        .setDescription('Select the **Game Mode** to start a new After Action Report.')
        .setColor(0x5865F2);

      await panelChannel.send({ embeds: [panelEmbed], components: [row] });

      return interaction.editReply({
        content: `✅ Setup complete!\nPanel: ${panelChannel}\nReports: ${reportChannel}`
      });

    } catch (err) {
      console.error(err);
      return interaction.editReply({ content: `Error: ${err.message}` });
    }
  }

  // ========== /drops ==========
  if (interaction.isChatInputCommand() && interaction.commandName === 'drops') {
    const user = interaction.options.getUser('user');
    const userStats = stats.users[user.id] || { points: 0, operations: 0, lastDrop: null };

    const lastDropText = userStats.lastDrop
      ? `<t:${Math.floor(new Date(userStats.lastDrop).getTime() / 1000)}:F>`
      : 'Never';

    const embed = new EmbedBuilder()
      .setTitle('Combat Operation Record')
      .setColor(0x5865F2)
      .setDescription(`**${user}**`)
      .addFields(
        { name: 'Points', value: `**${userStats.points}**`, inline: true },
        { name: 'Total Dropships', value: `**${userStats.operations}**`, inline: true },
        { name: 'Last Dropship', value: lastDropText, inline: true }
      )
      .setThumbnail(user.displayAvatarURL())
      .setFooter({ text: '1st M.I.' });

    return interaction.reply({ embeds: [embed] });
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

    // Show Voice Channel selector
    const channelSelect = new ChannelSelectMenuBuilder()
      .setCustomId('aar_voice')
      .setPlaceholder('Select the Voice Channel the squad is in')
      .addChannelTypes(ChannelType.GuildVoice);

    await interaction.update({
      content: `**${data.mode} → ${data.map}**\nSelect the Voice Channel:`,
      components: [new ActionRowBuilder().addComponents(channelSelect)]
    });
    return;
  }

  // ========== Voice Channel Selected ==========
  if (interaction.isChannelSelectMenu() && interaction.customId === 'aar_voice') {
    const data = pending.get(interaction.user.id);
    if (!data) return interaction.reply({ content: 'Session expired.', flags: MessageFlags.Ephemeral });

    const voiceChannelId = interaction.values[0];
    const voiceChannel = await interaction.guild.channels.fetch(voiceChannelId).catch(() => null);

    if (!voiceChannel || voiceChannel.type !== ChannelType.GuildVoice) {
      return interaction.update({
        content: 'Invalid voice channel selected. Please try again.',
        components: []
      });
    }

    // Get members currently in the voice channel
    const membersInVC = [...voiceChannel.members.keys()];

    if (membersInVC.length === 0) {
      return interaction.update({
        content: `No one is currently in **${voiceChannel.name}**.\nPlease join the voice channel and try again.`,
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
      content: `**${data.mode} → ${data.map}**\nSquad detected in **${voiceChannel.name}**:\n${memberMentions}\n\nChoose Outcome:`,
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
      new ButtonBuilder().setCustomId('extract_yes').setLabel('Full Extraction').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('extract_no').setLabel('No Extraction').setStyle(ButtonStyle.Danger)
    );

    await interaction.update({
      content: `**${data.mode} → ${data.map} → ${data.outcome}**\nExtraction:`,
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

    const mission = interaction.fields.getTextInputValue('mission');
    const notes = interaction.fields.getTextInputValue('notes') || 'None';

    // Full Extraction = 3 points
    const pointsPerPerson = data.extracted === 'Yes' ? 3 : 1;
    const now = new Date().toISOString();

    if (typeof stats.totalOperations !== 'number') stats.totalOperations = 0;
    stats.totalOperations += 1;

    data.users.forEach(userId => {
      if (!stats.users[userId]) {
        stats.users[userId] = { points: 0, operations: 0, lastDrop: null };
      }
      stats.users[userId].points += pointsPerPerson;
      stats.users[userId].operations += 1;
      stats.users[userId].lastDrop = now;
    });
    saveStats(stats);

    const userMentions = data.users.map(id => `<@${id}>`).join(' ');
    const pointsText = data.extracted === 'Yes' ? '+3 points each' : '+1 point each';
    const reportImage = data.extracted === 'Yes' ? VICTORY_IMAGE : DEFEAT_IMAGE;
    const embedColor = data.extracted === 'Yes' ? 0x57F287 : 0xED4245;

    const embed = new EmbedBuilder()
      .setTitle(`After Action Report — ${data.mode}`)
      .setColor(embedColor)
      .setImage(reportImage)
      .addFields(
        { name: 'Game Mode', value: data.mode, inline: true },
        { name: 'Map', value: data.map, inline: true },
        { name: 'Mission', value: mission, inline: true },
        { name: 'Outcome', value: data.outcome, inline: true },
        { name: 'Everyone Extracted?', value: data.extracted, inline: true },
        { name: 'Points Awarded', value: pointsText, inline: true },
        { name: 'Squad', value: userMentions },
        { name: 'Notes / Debrief', value: notes }
      )
      .setFooter({ text: `Reported by ${interaction.user.tag}` })
      .setTimestamp();

    try {
      if (config.reportChannelId) {
        const ch = await client.channels.fetch(config.reportChannelId);
        if (ch) await ch.send({ embeds: [embed] });
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
        .setLabel('Mission / Operation Name')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
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

client.on(Events.ClientReady, async () => {
  await client.application.commands.set([
    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Create private AAR panel + report channels'),

    new SlashCommandBuilder()
      .setName('drops')
      .setDescription('Check points and total dropships of a member')
      .addUserOption(opt => opt.setName('user').setDescription('Member').setRequired(true)),

    new SlashCommandBuilder()
      .setName('1stmidrops')
      .setDescription('Show total dropships for the entire server')
  ]);
  console.log('Slash commands registered');
});

client.login(process.env.TOKEN);
