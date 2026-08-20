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
  console.error('On Railway: open this service → Variables → add DISCORD_TOKEN → Redeploy.');
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

function logoAttachment() {
  return new AttachmentBuilder(asset('1st-mi-logo.png'), { name: '1st-mi-logo.png' });
}

function emptySession() {
  return {
    path: null,
    region: null,
    platform: null,
    rulesAccepted: false,
    previousName: null,
    community: null,
    experience: null,
    previousRank: null,
  };
}

function getSession(userId) {
  if (!sessions.has(userId)) sessions.set(userId, emptySession());
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

function stepEmbed(stepLabel, title, body) {
  return new EmbedBuilder()
    .setColor(COLORS.gold)
    .setAuthor({ name: stepLabel })
    .setTitle(title)
    .setDescription(body)
    .setThumbnail('attachment://1st-mi-logo.png')
    .setFooter({ text: 'Your answers are private and will only be seen by leadership staff.' });
}

function welcomeEmbed() {
  return stepEmbed(
    'ONBOARDING — STEP 1 OF ?',
    'WHAT ARE YOU HERE FOR?',
    'Please select the option that best describes why you\'re here.'
  );
}

function welcomeComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('path:starship').setLabel('Starship Troopers').setEmoji('🪖').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('path:hllv').setLabel('Hell Let Loose: Vietnam').setEmoji('⚔️').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('path:ambassador').setLabel('Ambassador').setEmoji('🤝').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('path:returning').setLabel('Returning Member').setEmoji('🛡️').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function regionEmbed() {
  return stepEmbed(
    'ONBOARDING — STEP 2 OF ?',
    'WHAT REGION ARE YOU FROM?',
    'This helps us connect you with members in your region and keep things running smoothly.'
  );
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

function platformEmbed() {
  return stepEmbed(
    'ONBOARDING — STEP 3 OF ?',
    'WHAT PLATFORM DO YOU PLAY ON?',
    'Please select the platform you primarily play on so we can connect you with the right members and events.'
  );
}

function platformComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('platform:pc').setLabel('PC').setEmoji('🖥️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('platform:xbox').setLabel('Xbox').setEmoji('🎮').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('platform:playstation').setLabel('PlayStation').setEmoji('🕹️').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function rulesEmbed(session) {
  const returning = session.path === 'returning';
  const extras = returning
    ? [
        '🛡️ Returning members are still subject to current rules regardless of previous rank/status.',
        '⭐ Leadership decisions regarding access and membership must be respected.',
      ]
    : [
        '👥 Ambassadors must act professionally when representing another community.',
        '⭐ Leadership decisions regarding access and membership must be respected.',
      ];

  return stepEmbed(
    'ONBOARDING — STEP 3 OF ?',
    '1ST MOBILE INFANTRY RULES & CONDUCT',
    [
      '🚨 **YOU MUST ACCEPT THESE RULES TO CONTINUE**',
      '',
      '🤝 Respect all members and leadership.',
      '🛡️ No harassment, discrimination, or disruptive behaviour.',
      '📜 Follow Discord and community rules.',
      '👤 Do not impersonate staff or misrepresent the 1st M.I.',
      ...extras,
      '',
      'Do you understand and agree to follow the 1st M.I. rules?',
    ].join('\n')
  );
}

function rulesComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('rules:agree').setLabel('I AGREE').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('rules:decline').setLabel('I DO NOT AGREE').setEmoji('❌').setStyle(ButtonStyle.Danger)
    ),
  ];
}

function experienceEmbed() {
  return stepEmbed(
    'ONBOARDING — STEP 4 OF ?',
    'HOW MUCH EXPERIENCE DO YOU HAVE?',
    'Please select the option that best describes your experience.'
  );
}

function experienceComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('experience:new').setLabel('New Recruit').setEmoji('🪖').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('experience:some').setLabel('Some Experience').setEmoji('🔺').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('experience:veteran').setLabel('Veteran').setEmoji('🎖️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('experience:expert').setLabel('Expert').setEmoji('⭐').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function previousNameEmbed() {
  return stepEmbed(
    'ONBOARDING — STEP 4 OF ?',
    'WHAT WAS YOUR PREVIOUS 1ST M.I. NAME?',
    [
      'Please enter the name or callsign you previously used in the 1st Mobile Infantry.',
      '',
      'This helps our leadership verify your previous membership.',
    ].join('\n')
  );
}

function previousNameComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('open:previousName').setLabel('Enter your previous name').setEmoji('📝').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function communityEmbed() {
  return stepEmbed(
    'ONBOARDING — STEP 4 OF ?',
    'WHAT COMMUNITY DO YOU REPRESENT?',
    [
      'Please enter the name of the community or unit you represent.',
      '',
      'This helps us recognize and work with your community.',
    ].join('\n')
  );
}

function communityComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('open:community').setLabel('Enter community / unit name').setEmoji('📝').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function rankEmbed() {
  return stepEmbed(
    'ONBOARDING — STEP 4 OF ?',
    'WHAT WAS YOUR PREVIOUS RANK OR ROLE?',
    'Please select the option that best describes your previous position.'
  );
}

function rankComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('rank:squad_member').setLabel('Squad Member').setEmoji('🪖').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('rank:squad_lead').setLabel('Squad Lead').setEmoji('🔺').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('rank:platoon_lead').setLabel('Platoon Lead').setEmoji('🎖️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('rank:nco').setLabel('NCO').setEmoji('🛡️').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('rank:officer').setLabel('Officer / Staff').setEmoji('⭐').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function pretty(value) {
  if (!value) return '—';
  return String(value).replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function completeEmbed(session) {
  const lines = [
    `**Path:** ${PATH_LABELS[session.path] || pretty(session.path)}`,
    `**Region:** ${pretty(session.region)}`,
  ];

  if (session.platform) lines.push(`**Platform:** ${pretty(session.platform)}`);
  if (session.experience) lines.push(`**Experience:** ${pretty(session.experience)}`);
  if (session.community) lines.push(`**Community:** ${session.community}`);
  if (session.previousName) lines.push(`**Previous name:** ${session.previousName}`);
  if (session.previousRank) lines.push(`**Previous rank:** ${pretty(session.previousRank)}`);
  if (session.path === 'ambassador' || session.path === 'returning') {
    lines.push(`**Rules accepted:** ${session.rulesAccepted ? 'Yes' : 'No'}`);
  }

  return new EmbedBuilder()
    .setColor(COLORS.green)
    .setAuthor({ name: 'ONBOARDING COMPLETE' })
    .setTitle('TEST ONBOARDING COMPLETE')
    .setDescription(
      [
        'You have reached the end of the currently designed test flow.',
        '',
        ...lines,
        '',
        'More onboarding steps can be added after this point.',
      ].join('\n')
    )
    .setThumbnail('attachment://1st-mi-logo.png')
    .setFooter({ text: 'Your answers are private and will only be seen by leadership staff.' });
}

function restartComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('reset:start').setLabel('Start over').setEmoji('🔄').setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function previousNameModal() {
  return new ModalBuilder()
    .setCustomId('modal:previousName')
    .setTitle('Previous 1st M.I. name')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('previousName')
          .setLabel('Previous name or callsign')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Enter your previous name...')
          .setRequired(true)
          .setMaxLength(80)
      )
    );
}

function communityModal() {
  return new ModalBuilder()
    .setCustomId('modal:community')
    .setTitle('Community / unit name')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('community')
          .setLabel('Community or unit you represent')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Enter community / unit name...')
          .setRequired(true)
          .setMaxLength(80)
      )
    );
}

async function presentOnboarding(interaction, embed, components = []) {
  const payload = {
    embeds: [embed],
    components,
    files: [logoAttachment()],
  };

  const isEphemeral = Boolean(interaction.message?.flags?.has(MessageFlags.Ephemeral));

  if (interaction.isModalSubmit()) {
    try {
      await interaction.update(payload);
      return;
    } catch {
      await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
      return;
    }
  }

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

    if (interaction.isModalSubmit()) {
      const session = getSession(interaction.user.id);
      const [, kind] = interaction.customId.split(':');

      if (kind === 'previousName') {
        session.previousName = interaction.fields.getTextInputValue('previousName').trim();
        await presentOnboarding(interaction, rankEmbed(), rankComponents());
        return;
      }

      if (kind === 'community') {
        session.community = interaction.fields.getTextInputValue('community').trim();
        await presentOnboarding(interaction, completeEmbed(session), restartComponents());
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

    if (group === 'open') {
      if (value === 'previousName') {
        await interaction.showModal(previousNameModal());
        return;
      }
      if (value === 'community') {
        await interaction.showModal(communityModal());
        return;
      }
    }

    if (group === 'path') {
      Object.assign(session, emptySession(), { path: value });
      await replaceCategoryRole(member, config.roles?.paths, value);
      await presentOnboarding(interaction, regionEmbed(), regionComponents());
      return;
    }

    if (group === 'region') {
      session.region = value;
      await replaceCategoryRole(member, config.roles?.regions, value);

      if (session.path === 'starship' || session.path === 'hllv') {
        await presentOnboarding(interaction, platformEmbed(), platformComponents());
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
      await presentOnboarding(interaction, experienceEmbed(), experienceComponents());
      return;
    }

    if (group === 'experience') {
      session.experience = value;
      await replaceCategoryRole(member, config.roles?.experience, value);
      await presentOnboarding(interaction, completeEmbed(session), restartComponents());
      return;
    }

    if (group === 'rank') {
      session.previousRank = value;
      await replaceCategoryRole(member, config.roles?.ranks, value);
      await presentOnboarding(interaction, completeEmbed(session), restartComponents());
      return;
    }

    if (group === 'rules') {
      if (value === 'agree') {
        session.rulesAccepted = true;
        if (session.path === 'returning') {
          await presentOnboarding(interaction, previousNameEmbed(), previousNameComponents());
        } else {
          await presentOnboarding(interaction, communityEmbed(), communityComponents());
        }
      } else {
        session.rulesAccepted = false;
        await presentOnboarding(
          interaction,
          stepEmbed(
            'ONBOARDING PAUSED',
            'RULES NOT ACCEPTED',
            'You must accept the 1st M.I. rules and conduct requirements before continuing.'
          ).setColor(COLORS.red),
          [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('rules:agree').setLabel('I AGREE').setEmoji('✅').setStyle(ButtonStyle.Success)
            ),
          ]
        );
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
