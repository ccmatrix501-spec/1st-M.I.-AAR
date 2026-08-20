require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  ContainerBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SlashCommandBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThumbnailBuilder,
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
  green: 0x3ba55d,
  red: 0xed4245,
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

function logoThumbnail() {
  return new ThumbnailBuilder()
    .setURL('attachment://1st-mi-logo.png')
    .setDescription('1st Mobile Infantry emblem');
}

function text(content) {
  return new TextDisplayBuilder().setContent(content);
}

function divider(spacing = SeparatorSpacingSize.Small) {
  return new SeparatorBuilder().setDivider(true).setSpacing(spacing);
}

function privacyFooter() {
  return '-# 🛡️ Your answers are private and will only be seen by leadership staff.';
}

function buildPanel({
  step,
  title,
  description,
  body,
  rows = [],
  accent = COLORS.gold,
  footer = privacyFooter(),
}) {
  const container = new ContainerBuilder().setAccentColor(accent);

  const header = new SectionBuilder()
    .addTextDisplayComponents(
      text(
        `### 1ST MOBILE INFANTRY\n` +
        `**RECRUITMENT & ONBOARDING**\n\n` +
        `-# ${step}\n` +
        `## ${title}\n` +
        `${description}`
      )
    )
    .setThumbnailAccessory(logoThumbnail());

  container.addSectionComponents(header);

  if (body) {
    container.addSeparatorComponents(divider());
    container.addTextDisplayComponents(text(body));
  }

  if (rows.length) {
    container.addSeparatorComponents(divider());
    for (const row of rows) container.addActionRowComponents(row);
  }

  if (footer) {
    container.addSeparatorComponents(divider());
    container.addTextDisplayComponents(text(footer));
  }

  return container;
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
    recruitRoleId: null,
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

function configuredEmoji(key, fallback) {
  const value = config.emojis?.[key];
  if (!value) return fallback;

  if (/^\d+$/.test(String(value))) {
    return { id: String(value), name: key };
  }

  return value;
}

function withRecruitRole(customId, recruitRoleId) {
  return recruitRoleId ? `${customId}:${recruitRoleId}` : customId;
}

function resolveRecruitRoleId(session, interactionRoleId) {
  const roleId = interactionRoleId || session.recruitRoleId || config.roles?.recruit || null;
  if (roleId) session.recruitRoleId = String(roleId);
  return session.recruitRoleId;
}

async function awardRecruitRole(member, session) {
  const roleId = resolveRecruitRoleId(session);
  if (!roleId) {
    console.warn('Onboarding completed, but no Recruit role was configured for this panel.');
    return false;
  }

  try {
    if (!member.roles.cache.has(roleId)) await member.roles.add(roleId);
    return true;
  } catch (err) {
    console.warn(`Could not add Recruit role ${roleId}:`, err.message);
    return false;
  }
}

function buttonRows(items, perRow = 2) {
  const rows = [];

  for (let i = 0; i < items.length; i += perRow) {
    const row = new ActionRowBuilder();
    for (const [id, label, emoji, style] of items.slice(i, i + perRow)) {
      const button = new ButtonBuilder()
        .setCustomId(id)
        .setLabel(label)
        .setStyle(style || ButtonStyle.Secondary);

      if (emoji) button.setEmoji(emoji);
      row.addComponents(button);
    }
    rows.push(row);
  }

  return rows;
}

function welcomePanel(recruitRoleId) {
  return buildPanel({
    step: 'ONBOARDING — STEP 1',
    title: 'WHAT ARE YOU HERE FOR?',
    description: 'Please select the option that best describes why you’re here.',
    rows: buttonRows([
      [withRecruitRole('path:starship', recruitRoleId), 'STARSHIP TROOPERS', configuredEmoji('starship', '🪖')],
      [withRecruitRole('path:hllv', recruitRoleId), 'HELL LET LOOSE: VIETNAM', configuredEmoji('hllv', '⚔️')],
      [withRecruitRole('path:ambassador', recruitRoleId), 'AMBASSADOR', configuredEmoji('ambassador', '🤝')],
      [withRecruitRole('path:returning', recruitRoleId), 'RETURNING MEMBER', configuredEmoji('returning', '↩️')],
    ], 2),
  });
}

function regionPanel(recruitRoleId) {
  return buildPanel({
    step: 'ONBOARDING — STEP 2',
    title: 'WHAT REGION ARE YOU FROM?',
    description: 'This helps us connect you with members in your region and keep things running smoothly.',
    rows: buttonRows([
      [withRecruitRole('region:america', recruitRoleId), 'AMERICA', '🌎'],
      [withRecruitRole('region:europe', recruitRoleId), 'EUROPE', '🌍'],
      [withRecruitRole('region:asia', recruitRoleId), 'ASIA', '🌏'],
      [withRecruitRole('region:africa', recruitRoleId), 'AFRICA', '🌍'],
      [withRecruitRole('region:oceania', recruitRoleId), 'OCEANIA', '🇦🇺'],
    ], 3),
  });
}

function platformPanel(recruitRoleId) {
  return buildPanel({
    step: 'ONBOARDING — STEP 3',
    title: 'WHAT PLATFORM DO YOU PLAY ON?',
    description: 'Please select the platform you primarily play on.',
    rows: buttonRows([
      [withRecruitRole('platform:pc', recruitRoleId), 'PC', configuredEmoji('pc', '🖥️')],
      [withRecruitRole('platform:xbox', recruitRoleId), 'XBOX', configuredEmoji('xbox', '🎮')],
      [withRecruitRole('platform:playstation', recruitRoleId), 'PLAYSTATION', configuredEmoji('playstation', '🎮')],
    ], 3),
  });
}

function rulesPanel(session, recruitRoleId) {
  const returningLine = session.path === 'returning'
    ? '\n• Returning members are still subject to current rules regardless of previous rank or status.'
    : '';
  const ambassadorLine = session.path === 'ambassador'
    ? '\n• Ambassadors must act professionally when representing another community.'
    : '';

  return buildPanel({
    step: 'ONBOARDING — STEP 3',
    title: '1ST MOBILE INFANTRY — RULES & CONDUCT',
    description: '**⚠️ YOU MUST ACCEPT THESE RULES TO CONTINUE**',
    body:
      '• Respect all members and leadership.\n' +
      '• No harassment, discrimination, or disruptive behaviour.\n' +
      '• Follow Discord and community rules.\n' +
      '• Do not impersonate staff or misrepresent the 1st M.I.' +
      ambassadorLine +
      returningLine +
      '\n• Leadership decisions regarding access and membership must be respected.\n\n' +
      '**Do you understand and agree to follow the 1st M.I. rules?**',
    rows: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(withRecruitRole('rules:agree', recruitRoleId))
          .setLabel('I AGREE')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(withRecruitRole('rules:decline', recruitRoleId))
          .setLabel('I DO NOT AGREE')
          .setEmoji('❌')
          .setStyle(ButtonStyle.Danger)
      ),
    ],
  });
}

function experiencePanel(recruitRoleId) {
  return buildPanel({
    step: 'ONBOARDING — STEP 4',
    title: 'HOW MUCH EXPERIENCE DO YOU HAVE?',
    description: 'Please select the option that best describes your experience.',
    rows: buttonRows([
      [withRecruitRole('experience:new', recruitRoleId), 'NEW RECRUIT', '🪖'],
      [withRecruitRole('experience:some', recruitRoleId), 'SOME EXPERIENCE', '🔺'],
      [withRecruitRole('experience:veteran', recruitRoleId), 'VETERAN', '🎖️'],
      [withRecruitRole('experience:expert', recruitRoleId), 'EXPERT', '⭐'],
    ], 2),
  });
}

function previousNamePanel(recruitRoleId) {
  return buildPanel({
    step: 'ONBOARDING — STEP 4',
    title: 'WHAT WAS YOUR PREVIOUS 1ST M.I. NAME?',
    description: 'Enter the name or callsign you previously used in the 1st Mobile Infantry.',
    rows: buttonRows([
      [withRecruitRole('open:previousName', recruitRoleId), 'ENTER PREVIOUS NAME', '📝'],
    ], 1),
  });
}

function communityPanel(recruitRoleId) {
  return buildPanel({
    step: 'ONBOARDING — STEP 4',
    title: 'WHAT COMMUNITY DO YOU REPRESENT?',
    description: 'Enter the name of the community or unit you represent.',
    rows: buttonRows([
      [withRecruitRole('open:community', recruitRoleId), 'ENTER COMMUNITY / UNIT NAME', '📝'],
    ], 1),
  });
}

function rankPanel(recruitRoleId) {
  return buildPanel({
    step: 'ONBOARDING — STEP 5',
    title: 'WHAT WAS YOUR PREVIOUS RANK OR ROLE?',
    description: 'Please select the option that best describes your previous position.',
    rows: buttonRows([
      [withRecruitRole('rank:squad_member', recruitRoleId), 'SQUAD MEMBER', '🪖'],
      [withRecruitRole('rank:squad_lead', recruitRoleId), 'SQUAD LEAD', '🔺'],
      [withRecruitRole('rank:platoon_lead', recruitRoleId), 'PLATOON LEAD', '🎖️'],
      [withRecruitRole('rank:nco', recruitRoleId), 'NCO', '🛡️'],
      [withRecruitRole('rank:officer', recruitRoleId), 'OFFICER / STAFF', '⭐'],
    ], 2),
  });
}

function pretty(value) {
  if (!value) return '—';
  return String(value).replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function completePanel(session, recruitRoleAssigned) {
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

  const statusText = recruitRoleAssigned
    ? 'You have been assigned the Recruit role. Welcome to the 1st Mobile Infantry.'
    : 'Your onboarding is complete, but the bot could not assign the configured Recruit role. Please contact leadership.';

  return buildPanel({
    step: 'ONBOARDING COMPLETE',
    title: '✅ ONBOARDING COMPLETE',
    description: 'Thank you for completing the onboarding process.',
    body: `### STATUS: RECRUIT\n${statusText}\n\n${lines.join('\n')}`,
    rows: [],
    accent: recruitRoleAssigned ? COLORS.green : COLORS.gold,
    footer: null,
  });
}

function pausedPanel(recruitRoleId) {
  return buildPanel({
    step: 'ONBOARDING PAUSED',
    title: 'RULES NOT ACCEPTED',
    description: 'You must accept the 1st M.I. Rules & Conduct before you can continue onboarding.',
    body: 'If you are ready to continue, select **I AGREE** below.',
    rows: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(withRecruitRole('rules:agree', recruitRoleId))
          .setLabel('I AGREE')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Success)
      ),
    ],
    accent: COLORS.red,
  });
}

function previousNameModal(recruitRoleId) {
  return new ModalBuilder()
    .setCustomId(withRecruitRole('modal:previousName', recruitRoleId))
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

function communityModal(recruitRoleId) {
  return new ModalBuilder()
    .setCustomId(withRecruitRole('modal:community', recruitRoleId))
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

function v2Payload(container, ephemeral = false) {
  return {
    components: [container],
    files: [logoAttachment()],
    flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
  };
}

async function presentOnboarding(interaction, container) {
  const isEphemeral = Boolean(interaction.message?.flags?.has(MessageFlags.Ephemeral));

  if (interaction.isModalSubmit()) {
    try {
      await interaction.update(v2Payload(container, false));
      return;
    } catch {
      await interaction.reply(v2Payload(container, true));
      return;
    }
  }

  if (interaction.isButton() && isEphemeral) {
    await interaction.update(v2Payload(container, false));
    return;
  }

  if (interaction.isButton()) {
    await interaction.reply(v2Payload(container, true));
    return;
  }

  await interaction.reply(v2Payload(container, false));
}

const commands = [
  new SlashCommandBuilder()
    .setName('onboarding-panel')
    .setDescription('Post the 1st M.I. onboarding panel')
    .addRoleOption(option =>
      option
        .setName('recruit-role')
        .setDescription('Role members receive after completing onboarding')
        .setRequired(true)
    )
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
  console.log(`Target server: ${guildId}`);

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
          content: 'This test bot is locked to the configured server.',
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'onboarding-panel') {
        const recruitRole = interaction.options.getRole('recruit-role', true);

        if (recruitRole.managed) {
          await interaction.reply({
            content: 'That role is managed by Discord/integration and cannot be assigned by the bot. Please choose your normal Recruit role.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const botMember = interaction.guild?.members?.me;
        if (botMember && recruitRole.position >= botMember.roles.highest.position) {
          await interaction.reply({
            content: `I cannot assign ${recruitRole} because it is at or above my highest role. Move the bot role above the Recruit role, then post the panel again.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        await interaction.reply(v2Payload(welcomePanel(recruitRole.id), false));
        return;
      }

      if (interaction.commandName === 'reset-onboarding') {
        sessions.delete(interaction.user.id);
        await interaction.reply({
          content: 'Your onboarding session has been reset.',
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      const session = getSession(interaction.user.id);
      const [, kind, interactionRoleId] = interaction.customId.split(':');
      resolveRecruitRoleId(session, interactionRoleId);

      if (kind === 'previousName') {
        session.previousName = interaction.fields.getTextInputValue('previousName').trim();
        await presentOnboarding(interaction, rankPanel(session.recruitRoleId));
        return;
      }

      if (kind === 'community') {
        session.community = interaction.fields.getTextInputValue('community').trim();
        const assigned = await awardRecruitRole(interaction.member, session);
        await presentOnboarding(interaction, completePanel(session, assigned));
        return;
      }
    }

    if (!interaction.isButton()) return;

    const member = interaction.member;
    const session = getSession(interaction.user.id);
    const [group, value, interactionRoleId] = interaction.customId.split(':');
    resolveRecruitRoleId(session, interactionRoleId);

    if (group === 'open') {
      if (value === 'previousName') {
        await interaction.showModal(previousNameModal(session.recruitRoleId));
        return;
      }
      if (value === 'community') {
        await interaction.showModal(communityModal(session.recruitRoleId));
        return;
      }
    }

    if (group === 'path') {
      const recruitRoleId = session.recruitRoleId;
      Object.assign(session, emptySession(), { path: value, recruitRoleId });
      await replaceCategoryRole(member, config.roles?.paths, value);
      await presentOnboarding(interaction, regionPanel(session.recruitRoleId));
      return;
    }

    if (group === 'region') {
      session.region = value;
      await replaceCategoryRole(member, config.roles?.regions, value);

      if (session.path === 'starship' || session.path === 'hllv') {
        await presentOnboarding(interaction, platformPanel(session.recruitRoleId));
      } else if (session.path === 'ambassador' || session.path === 'returning') {
        await presentOnboarding(interaction, rulesPanel(session, session.recruitRoleId));
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
      await presentOnboarding(interaction, experiencePanel(session.recruitRoleId));
      return;
    }

    if (group === 'experience') {
      session.experience = value;
      await replaceCategoryRole(member, config.roles?.experience, value);
      const assigned = await awardRecruitRole(interaction.member, session);
      await presentOnboarding(interaction, completePanel(session, assigned));
      return;
    }

    if (group === 'rank') {
      session.previousRank = value;
      await replaceCategoryRole(member, config.roles?.ranks, value);
      const assigned = await awardRecruitRole(interaction.member, session);
      await presentOnboarding(interaction, completePanel(session, assigned));
      return;
    }

    if (group === 'rules') {
      if (value === 'agree') {
        session.rulesAccepted = true;
        if (session.path === 'returning') {
          await presentOnboarding(interaction, previousNamePanel(session.recruitRoleId));
        } else {
          await presentOnboarding(interaction, communityPanel(session.recruitRoleId));
        }
      } else {
        session.rulesAccepted = false;
        await presentOnboarding(interaction, pausedPanel(session.recruitRoleId));
      }
      return;
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      const payload = {
        content: 'Something went wrong while processing that onboarding step. Check the bot console for details.',
        flags: MessageFlags.Ephemeral,
      };
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
      }
    }
  }
});

client.login(token);
