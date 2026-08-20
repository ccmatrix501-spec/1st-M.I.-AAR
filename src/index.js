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

function hasCard(name) {
  return fs.existsSync(cardFile(name));
}

function cardAttachment(name) {
  if (hasCard(name)) {
    return new AttachmentBuilder(cardFile(name), { name });
  }
  return new AttachmentBuilder(asset('1st-mi-logo.png'), { name: '1st-mi-logo.png' });
}

function cardEmbed(name, extraDescription) {
  if (hasCard(name)) {
    const embed = new EmbedBuilder()
      .setColor(COLORS.dark)
      .setImage(`attachment://${name}`)
      .setFooter({ text: 'Your answers are private and will only be seen by leadership staff.' });
    if (extraDescription) embed.setDescription(extraDescription);
    return embed;
  }

  return new EmbedBuilder()
    .setColor(COLORS.gold)
    .setTitle(name.replace('.png', '').toUpperCase())
    .setDescription(extraDescription || 'Upload assets/cards to the GitHub repo, then redeploy.')
    .setThumbnail('attachment://1st-mi-logo.png');
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

function configuredEmoji(key, fallback) {
  const value = config.emojis?.[key];
  if (!value) return fallback;

  // Allow either a normal/custom emoji string or just a Discord custom emoji ID.
  if (/^\d+$/.test(String(value))) {
    return { id: String(value), name: key };
  }

  return value;
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

function welcomeEmbed() {
  return cardEmbed('step1.png');
}

function welcomeComponents() {
  return buttonRows([
    ['path:starship', 'STARSHIP TROOPERS', configuredEmoji('starship', '🪖')],
    ['path:hllv', 'HELL LET LOOSE: VIETNAM', configuredEmoji('hllv', '⚔️')],
    ['path:ambassador', 'AMBASSADOR', configuredEmoji('ambassador', '🤝')],
    ['path:returning', 'RETURNING MEMBER', configuredEmoji('returning', '↩️')],
  ], 2);
}

function regionEmbed() {
  return cardEmbed('step2.png');
}

function regionComponents() {
  return buttonRows([
    ['region:america', 'AMERICA', '🌎'],
    ['region:europe', 'EUROPE', '🌍'],
    ['region:asia', 'ASIA', '🌏'],
    ['region:africa', 'AFRICA', '🌍'],
    ['region:oceania', 'OCEANIA', '🇦🇺'],
  ], 3);
}

function platformEmbed() {
  return cardEmbed('step3-platform.png');
}

function platformComponents() {
  return buttonRows([
    ['platform:pc', 'PC', configuredEmoji('pc', '🖥️')],
    ['platform:xbox', 'XBOX', configuredEmoji('xbox', '🎮')],
    ['platform:playstation', 'PLAYSTATION', configuredEmoji('playstation', '🎮')],
  ], 3);
}

function rulesEmbed(session) {
  return cardEmbed(session.path === 'returning' ? 'step3-rules-returning.png' : 'step3-rules-ambassador.png');
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
  return cardEmbed('step4-experience.png');
}

function experienceComponents() {
  return buttonRows([
    ['experience:new', 'NEW RECRUIT', '🪖'],
    ['experience:some', 'SOME EXPERIENCE', '🔺'],
    ['experience:veteran', 'VETERAN', '🎖️'],
    ['experience:expert', 'EXPERT', '⭐'],
  ], 2);
}

function previousNameEmbed() {
  return cardEmbed('step4-name.png');
}

function previousNameComponents() {
  return buttonRows([
    ['open:previousName', 'ENTER YOUR PREVIOUS NAME', '📝'],
  ], 1);
}

function communityEmbed() {
  return cardEmbed('step4-community.png');
}

function communityComponents() {
  return buttonRows([
    ['open:community', 'ENTER COMMUNITY / UNIT NAME', '📝'],
  ], 1);
}

function rankEmbed() {
  return cardEmbed('step4-rank.png');
}

function rankComponents() {
  return buttonRows([
    ['rank:squad_member', 'SQUAD MEMBER', '🪖'],
    ['rank:squad_lead', 'SQUAD LEAD', '🔺'],
    ['rank:platoon_lead', 'PLATOON LEAD', '🎖️'],
    ['rank:nco', 'NCO', '🛡️'],
    ['rank:officer', 'OFFICER / STAFF', '⭐'],
  ], 2);
}

function pretty(value) {
  if (!value) return '\u2014';
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
  return cardEmbed('complete.png', lines.join('\n'));
}

function restartComponents() {
  return buttonRows([
    ['reset:start', 'START OVER', '🔄'],
  ], 1);
}

function pausedEmbed() {
  return cardEmbed('paused.png');
}

function currentCardName(embed) {
  return embed?.data?.image?.url?.replace('attachment://', '') || 'step1.png';
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
  const cardName = currentCardName(embed);
  const payload = {
    embeds: [embed],
    components,
    files: [cardAttachment(cardName)],
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
          files: [cardAttachment('step1.png')],
        });
        return;
      }

      if (interaction.commandName === 'reset-onboarding') {
        sessions.delete(interaction.user.id);
        await interaction.reply({
          content: 'Your test onboarding session has been reset.',
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
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
          pausedEmbed(),
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
