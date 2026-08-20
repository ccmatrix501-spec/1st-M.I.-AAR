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
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');
const DEFAULT_GUILD_ID = '1352675653798989947';

if (!fs.existsSync(CONFIG_PATH)) {
  console.error('Missing config.json. Copy config.example.json to config.json first.');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const token = process.env.DISCORD_TOKEN;
const guildId = process.env.GUILD_ID || config.guildId || DEFAULT_GUILD_ID;

if (!token) {
  console.error('Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// Test-build session storage. Keyed by Discord user ID.
const sessions = new Map();

const COLORS = {
  gold: 0x9c7b3e,
  dark: 0x111315,
  green: 0x2f7d32,
  red: 0xa23232,
};

function asset(name) {
  return path.join(ROOT, 'assets', name);
}

function logoAttachment() {
  return new AttachmentBuilder(asset('1st-mi-logo.png'), { name: '1st-mi-logo.png' });
}

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, {
      path: null,
      region: null,
      platform: null,
      rulesAccepted: false,
    });
  }
  return sessions.get(userId);
}

async function replaceCategoryRole(member, roleMap, selectedKey) {
  if (!member || typeof member.roles?.add !== 'function') return;

  const ids = Object.values(roleMap || {}).filter(Boolean);
  const removable = ids.filter(id => member.roles.cache.has(id));

  for (const id of removable) {
    try {
      await member.roles.remove(id);
    } catch (err) {
      console.warn(`Could not remove role ${id}:`, err.message);
    }
  }

  const roleId = roleMap?.[selectedKey];
  if (roleId) {
    try {
      await member.roles.add(roleId);
    } catch (err) {
      console.warn(`Could not add role ${roleId}:`, err.message);
    }
  }
}

function baseEmbed() {
  return new EmbedBuilder()
    .setColor(COLORS.gold)
    .setFooter({ text: 'Your onboarding responses are visible only to you and leadership staff.' })
    .setTimestamp();
}

function welcomeEmbed() {
  return baseEmbed()
    .setTitle('WELCOME, RECRUIT. — 1ST MOBILE INFANTRY')
    .setDescription(
      [
        'Before you gain full access to the unit, we need to get a few details from you.',
        '',
        '**WHAT ARE YOU HERE FOR?**',
        'Choose the option that best describes why you are joining the server.',
      ].join('\n')
    )
    .setThumbnail('attachment://1st-mi-logo.png');
}

function welcomeComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('path:starship')
        .setLabel('Starship Troopers')
        .setEmoji('🪐')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('path:hllv')
        .setLabel('Hell Let Loose: Vietnam')
        .setEmoji('⚔️')
        .setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('path:ambassador')
        .setLabel('Ambassador')
        .setEmoji('🤝')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('path:returning')
        .setLabel('Returning Member')
        .setEmoji('🛡️')
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function regionEmbed(session) {
  const selected = session.path ? session.path.toUpperCase() : 'NOT SET';
  return baseEmbed()
    .setTitle('ONBOARDING — STEP 2')
    .setDescription(
      [
        `**Selected path:** ${selected}`,
        '',
        '# WHAT REGION ARE YOU FROM?',
        'This helps us connect you with members in your region and organize events and communications.',
      ].join('\n')
    )
    .setThumbnail('attachment://1st-mi-logo.png');
}

function regionComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('region:america').setLabel('America').setEmoji('🌎').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('region:europe').setLabel('Europe').setEmoji('🌍').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('region:asia').setLabel('Asia').setEmoji('🌏').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('region:africa').setLabel('Africa').setEmoji('🌍').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('region:oceania').setLabel('Oceania').setEmoji('🇦🇺').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function platformEmbed(session) {
  const game = session.path === 'starship' ? 'Starship Troopers' : 'Hell Let Loose: Vietnam';
  return baseEmbed()
    .setTitle('ONBOARDING — STEP 3')
    .setDescription(
      [
        `**${game}**`,
        '',
        '# WHAT PLATFORM DO YOU PLAY ON?',
        'Please select the platform you primarily play on.',
      ].join('\n')
    )
    .setThumbnail('attachment://1st-mi-logo.png');
}

function platformComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('platform:pc').setLabel('PC').setEmoji('🖥️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('platform:xbox').setLabel('Xbox').setEmoji('🎮').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('platform:playstation').setLabel('PlayStation').setEmoji('🎮').setStyle(ButtonStyle.Primary)
    ),
  ];
}

function rulesEmbed(session) {
  const who = session.path === 'ambassador' ? 'AMBASSADOR' : 'RETURNING MEMBER';
  return baseEmbed()
    .setTitle('ONBOARDING — STEP 3 | RULES & CONDUCT')
    .setDescription(
      [
        `**PATH: ${who}**`,
        '',
        '⚠️ **YOU MUST ACCEPT THESE RULES TO CONTINUE**',
        '',
        '• Respect all members and leadership.',
        '• No harassment, discrimination, or disruptive behaviour.',
        '• Follow Discord and community rules.',
        '• Do not impersonate staff or misrepresent the 1st M.I.',
        '• Ambassadors must act professionally when representing another community.',
        '• Returning members are subject to current rules regardless of previous rank or status.',
        '• Leadership decisions regarding access and membership must be respected.',
        '',
        '**Do you understand and agree to follow the 1st M.I. rules?**',
      ].join('\n')
    )
    .setThumbnail('attachment://1st-mi-logo.png');
}

function rulesComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('rules:agree').setLabel('I Agree').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('rules:decline').setLabel('I Do Not Agree').setEmoji('✖️').setStyle(ButtonStyle.Danger)
    ),
  ];
}

function completeEmbed(session) {
  const pretty = value => value ? value.replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase()) : '—';

  return baseEmbed()
    .setColor(COLORS.green)
    .setTitle('TEST ONBOARDING COMPLETE')
    .setDescription(
      [
        'You have reached the end of the currently designed test flow.',
        '',
        `**Path:** ${pretty(session.path)}`,
        `**Region:** ${pretty(session.region)}`,
        `**Platform:** ${pretty(session.platform)}`,
        `**Rules accepted:** ${session.rulesAccepted ? 'Yes' : 'N/A'}`,
        '',
        'More onboarding steps can be added after this point.',
      ].join('\n')
    );
}

function restartComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('reset:start').setLabel('Start over').setEmoji('🔄').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

async function presentOnboarding(interaction, embed, components = []) {
  const payload = {
    embeds: [embed],
    components,
    files: [logoAttachment()],
  };

  const isEphemeral = Boolean(interaction.message?.flags?.has(MessageFlags.Ephemeral));

  if (interaction.isButton() && isEphemeral) {
    await interaction.update(payload);
    return;
  }

  if (interaction.isButton()) {
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply(payload);
}

const commands = [
  new SlashCommandBuilder()
    .setName('onboarding-panel')
    .setDescription('Post the 1st M.I. onboarding test panel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('reset-onboarding')
    .setDescription('Reset your own test onboarding session'),
].map(c => c.toJSON());

async function registerCommands(applicationId) {
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: commands });
  console.log(`Registered slash commands for guild ${guildId}`);
}

client.once(Events.ClientReady, async readyClient => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  console.log(`Target test server: ${guildId}`);

  const guild = readyClient.guilds.cache.get(guildId);
  if (!guild) {
    console.warn(`Bot is online, but not in guild ${guildId}. Invite it to that server, then restart.`);
    console.warn(
      `Invite URL: https://discord.com/oauth2/authorize?client_id=${readyClient.user.id}&scope=bot%20applications.commands&permissions=268446720`
    );
  } else {
    console.log(`Connected to ${guild.name} (${guild.id})`);
  }

  try {
    await registerCommands(readyClient.application.id);
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.guildId && interaction.guildId !== guildId) {
      if (interaction.isRepliable()) {
        await interaction.reply({
          content: 'This test bot is locked to the personal test server.',
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'onboarding-panel') {
        await interaction.reply({
          content: '**1st M.I. Recruitment Bot** — Select an option below to begin.',
          embeds: [welcomeEmbed()],
          components: welcomeComponents(),
          files: [logoAttachment()],
        });
        return;
      }

      if (interaction.commandName === 'reset-onboarding') {
        sessions.delete(interaction.user.id);
        await interaction.reply({
          content: 'Your test onboarding session has been reset.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    if (!interaction.isButton()) return;

    const member = interaction.member;
    const session = getSession(interaction.user.id);
    const [group, value] = interaction.customId.split(':');

    if (group === 'reset') {
      sessions.delete(interaction.user.id);
      await presentOnboarding(interaction, welcomeEmbed(), welcomeComponents());
      return;
    }

    if (group === 'path') {
      session.path = value;
      session.region = null;
      session.platform = null;
      session.rulesAccepted = false;
      await replaceCategoryRole(member, config.roles?.paths, value);
      await presentOnboarding(interaction, regionEmbed(session), regionComponents());
      return;
    }

    if (group === 'region') {
      session.region = value;
      await replaceCategoryRole(member, config.roles?.regions, value);

      if (session.path === 'starship' || session.path === 'hllv') {
        await presentOnboarding(interaction, platformEmbed(session), platformComponents());
      } else if (session.path === 'ambassador' || session.path === 'returning') {
        await presentOnboarding(interaction, rulesEmbed(session), rulesComponents());
      } else {
        await interaction.reply({
          content: 'Please restart onboarding and choose a path first.',
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (group === 'platform') {
      session.platform = value;
      await replaceCategoryRole(member, config.roles?.platforms, value);
      await presentOnboarding(interaction, completeEmbed(session), restartComponents());
      return;
    }

    if (group === 'rules') {
      if (value === 'agree') {
        session.rulesAccepted = true;
        await presentOnboarding(interaction, completeEmbed(session), restartComponents());
      } else {
        session.rulesAccepted = false;
        const denied = baseEmbed()
          .setColor(COLORS.red)
          .setTitle('ONBOARDING PAUSED')
          .setDescription('You must accept the 1st M.I. rules and conduct requirements before continuing.');
        await presentOnboarding(interaction, denied, [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('rules:agree').setLabel('I Agree').setEmoji('✅').setStyle(ButtonStyle.Success)
          ),
        ]);
      }
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      const msg = 'Something went wrong while processing that onboarding step. Check the bot console for details.';
      const payload = { content: msg, flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  }
});

client.login(token);
