/**
 * Build Certification questions editor
 * Same style as Specialisation editors: permanent Edit / Add buttons.
 * Post the panel with /buildpanel in the channel you create.
 */
const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  SlashCommandBuilder,
  PermissionFlagsBits
} = require('discord.js');

const TAC_GUILD_ID = '1256977709884641382';
/** Parent channel for Build Certification (reference only) */
const BUILD_CHANNEL_ID = '1537554338807808010';
/** Thread where the permanent Edit / Add panel lives */
const BUILD_THREAD_ID = '1538606037395968121';
const DATA_PATH = path.join(__dirname, 'data', 'build-certification.json');
const pending = new Map();

/** Full official Build Certification checklist (seed / reload source) */
const DEFAULT_BUILD_CERT = {
  "title": "Build Certification",
  "passScore": 0,
  "totalPoints": 33,
  "sections": [
    {
      "title": "I. Pre-Game Lobby",
      "items": [
        "Builder Candidate asked squad for class preferences.",
        "Builder candidate gave priority to lowest ranked troopers.",
        "Builder candidate formed a squad in accordance with modifiers and the squads preferences. Must include 2nd Engineer.",
        "Builder candidate did NOT overly micro manage squad loadout.",
        "Builder Candidate Informed PL when Squad loadout and all troopers were ready."
      ]
    },
    {
      "title": "II. Start of Game",
      "items": [
        "On Fed Net screen, the Builder Candidate reminded troopers to join correct squad.",
        "Builder Candidate picks spot for squad to meet up outside of dropship. (left/right/center)",
        "Builder Candidate reminded troopers to stock up on health stims.",
        "Builder Candidate Communicated with PL that the squad is ready to move out.",
        "Builder Candidate reiterated command from PL for squad to move out."
      ]
    },
    {
      "title": "III. Early-Game | Ore Stage",
      "items": [
        "Builder Candidate constructed HQ and placed hard ammo near the Mobile HQ. (Cannot place between deposit chambers for spawning reasons).",
        "Builder Candidate ensured the ARC is secure on four sides with robust buildable structures or map provided hard structures, while providing at least two methods of access and egress: ramps, reversed walls, gates or ladders. (see attachment BS3.0-1.8-AC-rev.1)",
        "Builder Candidate placed their own HMG or utilize the M-11E Babar with Ammo outside of build area, with good field of fire - or directed secondary engineer to place theirs (N/A if site does not allow).",
        "Builder Candidate Added a bunker and additional ammo at the bunker entrance.",
        "Builder Candidate expanded the base by starting a second layer perimeter wall 1 build square from the ARC.",
        "Builder Candidate placed 2 field showers or request second engineer to place field shower (Must have 2 field shower)"
      ]
    },
    {
      "title": "IV. Mid-Game | Gas Stage",
      "items": [
        "Builder Candidate successfully placed an electric fence inside the base walls and within 1 build square of ARC. (see attachment BS3.0-1.8-EFL-rev.1)",
        "Builder Candidate completed the second layer perimeter wall and added a third wall layer or a second Bunker (or both).",
        "Builder Candidate placed at least one tower, spotlight, wall, or other structures as \"lightning rods\" outside the core base perimeter and along base structures vulnerable to enemy artillery. (see attachment BS3.0-1.8-LR-rev.1)",
        "Builder Candidate directed secondary engineer to place at least one of their ability resources (short walls, light poles, and/or ammo).",
        "Builder Candidate ensured hard ammo, soft ammo, and medical stims are available throughout the base for the duration of the OP.",
        "Builder Candidate successfully maintained ore reserves (minimum 1000 ore minimum at the start of arc slam) to allow for ammo needs throughout arc slam."
      ]
    },
    {
      "title": "V. ARC Slam & Extraction",
      "items": [
        "Arc survived until extraction timer appears.",
        "Builder Candidate ensured squad was resupplied with hard ammo, healed and assembled at PLs rally point.",
        "Builder Candidate orders squad to move to dropship."
      ]
    },
    {
      "title": "VI. Overall Tasks",
      "items": [
        "Candidate remained calm, cool, and collected for the entire operation. Did not berate squad or other platoon members.",
        "Candidate clearly and quickly communicated with PL when orders were given or questions asked.",
        "Candidate was receptive to feedback."
      ]
    },
    {
      "title": "VII. General Base Layout Review",
      "items": [
        "Builder Candidate has built the base to be easy to move around and able to be easily repaired.",
        "Builder Candidate has built the base to have good lines-of-sight to clear bugs in case of breach.",
        "Builder Candidate has built the base while keeping in mind the natural chokepoints of the FOB that will be focused on by the Bugs.",
        "Tick one box for each build square that is fully enclosed (honeycombed), excluding the Arc square.",
        "Tick one box for each hard structure intentionally utilized by the Builder Candidate as a defense platform to be occupied by a squad instead of base structures."
      ]
    }
  ]
};

function loadData() {
  if (!fs.existsSync(DATA_PATH)) {
    return JSON.parse(JSON.stringify(DEFAULT_BUILD_CERT));
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_BUILD_CERT));
  }
}

/** True if file is missing, empty, or still the old placeholder */
function needsSeed(data) {
  if (!data || !Array.isArray(data.sections) || data.sections.length === 0) return true;
  const totalItems = data.sections.reduce((n, s) => n + (Array.isArray(s.items) ? s.items.length : 0), 0);
  if (totalItems === 0) return true;
  if (data.sections.length === 1 && (data.sections[0].title || '').includes('General')) return true;
  return false;
}

function ensureSeeded() {
  let data = loadData();
  if (needsSeed(data)) {
    data = JSON.parse(JSON.stringify(DEFAULT_BUILD_CERT));
    saveData(data);
    console.log('[BUILD] Seeded full Build Certification checklist (7 sections, 33 questions)');
  }
  return data;
}

function forceReloadDefaults() {
  const data = JSON.parse(JSON.stringify(DEFAULT_BUILD_CERT));
  saveData(data);
  return data;
}

function saveData(data) {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function listSections() {
  const data = loadData();
  return Array.isArray(data.sections) ? data.sections : [];
}

function getSection(index) {
  const sections = listSections();
  return sections[index] || null;
}

function updateQuestion(sectionIndex, itemIndex, newText) {
  const data = loadData();
  if (!data.sections || !data.sections[sectionIndex]) return false;
  if (!Array.isArray(data.sections[sectionIndex].items)) return false;
  if (itemIndex < 0 || itemIndex >= data.sections[sectionIndex].items.length) return false;
  data.sections[sectionIndex].items[itemIndex] = newText;
  saveData(data);
  return true;
}

function addQuestion(sectionIndex, newText) {
  const data = loadData();
  if (!data.sections || !data.sections[sectionIndex]) return 0;
  if (!Array.isArray(data.sections[sectionIndex].items)) {
    data.sections[sectionIndex].items = [];
  }
  data.sections[sectionIndex].items.push(newText);
  saveData(data);
  return data.sections[sectionIndex].items.length;
}

function addSection(title) {
  const data = loadData();
  if (!Array.isArray(data.sections)) data.sections = [];
  data.sections.push({ title: title || `Section ${data.sections.length + 1}`, items: [] });
  saveData(data);
  return data.sections.length;
}

function buildPanelContent() {
  const sections = listSections();
  const summary =
    sections.length === 0
      ? '_No sections loaded — run `/buildreload`._'
      : sections
          .map((s, i) => `**${i + 1}. ${s.title}** — ${Array.isArray(s.items) ? s.items.length : 0} question(s)`)
          .join('\n');

  return (
    `**Build Certification Editor**\n` +
    `Only the person who clicks a button will see the steps.\n` +
    `**Edit** existing questions, or **Add Question** to a section.\n` +
    `The channel stays clean for everyone else.\n\n` +
    `**Sections:**\n${summary}`
  );
}

function buildPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('build_edit')
      .setLabel('Edit Questions')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('build_add')
      .setLabel('Add Question')
      .setStyle(ButtonStyle.Success)
  );
}

async function postPanel(channel) {
  // Remove previous bot panel messages (limit 20)
  try {
    const messages = await channel.messages.fetch({ limit: 20 });
    for (const msg of messages.values()) {
      if (msg.author.id === channel.client.user.id && msg.content?.includes('Build Certification Editor')) {
        await msg.delete().catch(() => {});
      }
    }
  } catch (_) {}

  await channel.send({
    content: buildPanelContent(),
    components: [buildPanelRow()]
  });
}

function sectionSelect(customId, placeholder) {
  const sections = listSections();
  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setMinValues(1)
    .setMaxValues(1);

  if (!sections.length) {
    select
      .setDisabled(true)
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('No sections yet')
          .setValue('none')
          .setDescription('Use Add Section first')
      );
    return select;
  }

  sections.slice(0, 25).forEach((s, i) => {
    const count = Array.isArray(s.items) ? s.items.length : 0;
    select.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(`${i + 1}. ${(s.title || 'Section').slice(0, 80)}`)
        .setValue(String(i))
        .setDescription(`${count} question(s)`.slice(0, 100))
    );
  });
  return select;
}

async function handleBuildCertInteraction(interaction) {
  const cid = interaction.customId || '';
  const isBuild =
    (interaction.isButton() && cid.startsWith('build_')) ||
    (interaction.isStringSelectMenu() && cid.startsWith('build_')) ||
    (interaction.isModalSubmit() && cid.startsWith('build_'));
  if (!isBuild) return false;

  // Optional: restrict to main guild
  if (interaction.guildId && interaction.guildId !== TAC_GUILD_ID) {
    // still allow if they want multi-server later
  }

  try {
    // ---- Edit: pick section (buttons for each section) ----
    if (interaction.isButton() && cid === 'build_edit') {
      const sections = listSections();
      if (!sections.length) {
        await interaction.reply({
          content: 'No sections yet. Use **Add Section** first.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      // Discord: max 5 buttons per row, max 5 rows
      const rows = [];
      let row = new ActionRowBuilder();
      sections.slice(0, 25).forEach((s, i) => {
        const count = Array.isArray(s.items) ? s.items.length : 0;
        const label = `${i + 1}. ${s.title || 'Section'}`.slice(0, 80);
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`build_edit_sec_${i}`)
            .setLabel(label)
            .setStyle(ButtonStyle.Primary)
        );
        if (row.components.length === 5) {
          rows.push(row);
          row = new ActionRowBuilder();
        }
      });
      if (row.components.length) rows.push(row);

      await interaction.reply({
        content: '**Edit Build Certification** — choose a section:',
        components: rows,
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    // ---- Edit: section button → pick question ----
    if (interaction.isButton() && cid.startsWith('build_edit_sec_')) {
      const sectionIndex = parseInt(cid.replace('build_edit_sec_', ''), 10);
      const section = getSection(sectionIndex);
      if (!section) {
        await interaction.update({ content: 'Section not found.', components: [] });
        return true;
      }
      const items = Array.isArray(section.items) ? section.items : [];
      if (!items.length) {
        await interaction.update({
          content: `**${section.title}** has no questions yet. Use **Add Question**.`,
          components: []
        });
        return true;
      }

      // Prefer question buttons when few; select menu if many (Discord 25 max options/buttons)
      if (items.length <= 25) {
        const rows = [];
        let row = new ActionRowBuilder();
        items.forEach((text, i) => {
          const label = `Q${i + 1}: ${String(text)}`.slice(0, 80);
          row.addComponents(
            new ButtonBuilder()
              .setCustomId(`build_edit_qi_${sectionIndex}_${i}`)
              .setLabel(label)
              .setStyle(ButtonStyle.Secondary)
          );
          if (row.components.length === 5) {
            rows.push(row);
            row = new ActionRowBuilder();
          }
        });
        if (row.components.length) rows.push(row);

        // Discord max 5 rows — if more questions, fall back to select
        if (rows.length <= 5) {
          await interaction.update({
            content: `**${section.title}** — select a question to edit:`,
            components: rows
          });
          return true;
        }
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId(`build_edit_q_${sectionIndex}`)
        .setPlaceholder('Select question to edit')
        .setMinValues(1)
        .setMaxValues(1);

      items.slice(0, 25).forEach((text, i) => {
        select.addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel(`Q${i + 1}`.slice(0, 100))
            .setValue(String(i))
            .setDescription(String(text).slice(0, 100))
        );
      });

      await interaction.update({
        content: `**${section.title}** — select a question to edit:`,
        components: [new ActionRowBuilder().addComponents(select)]
      });
      return true;
    }

    // ---- Edit: question button → modal ----
    if (interaction.isButton() && cid.startsWith('build_edit_qi_')) {
      const rest = cid.replace('build_edit_qi_', '');
      const parts = rest.split('_');
      const sectionIndex = parseInt(parts[0], 10);
      const itemIndex = parseInt(parts[1], 10);
      const section = getSection(sectionIndex);
      const current = section?.items?.[itemIndex] || '';

      const modal = new ModalBuilder()
        .setCustomId(`build_editmodal_${sectionIndex}_${itemIndex}`)
        .setTitle(`Edit Q${itemIndex + 1}`.slice(0, 45));

      const input = new TextInputBuilder()
        .setCustomId('new_text')
        .setLabel('Question text')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000)
        .setValue(String(current).slice(0, 1000));

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return true;
    }

    // ---- Edit: pick question in section (select menu fallback) ----
    if (interaction.isStringSelectMenu() && cid === 'build_edit_section') {
      // legacy no-op path if any old messages exist
      const sectionIndex = parseInt(interaction.values[0], 10);
      const section = getSection(sectionIndex);
      if (!section) {
        await interaction.update({ content: 'Section not found.', components: [] });
        return true;
      }
      const items = Array.isArray(section.items) ? section.items : [];
      if (!items.length) {
        await interaction.update({
          content: `**${section.title}** has no questions yet. Use **Add Question**.`,
          components: []
        });
        return true;
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId(`build_edit_q_${sectionIndex}`)
        .setPlaceholder('Select question to edit')
        .setMinValues(1)
        .setMaxValues(1);

      items.slice(0, 25).forEach((text, i) => {
        select.addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel(`Q${i + 1}`.slice(0, 100))
            .setValue(String(i))
            .setDescription(String(text).slice(0, 100))
        );
      });

      await interaction.update({
        content: `**${section.title}** — select a question to edit:`,
        components: [new ActionRowBuilder().addComponents(select)]
      });
      return true;
    }

    // ---- Edit: show modal for question ----
    if (interaction.isStringSelectMenu() && cid.startsWith('build_edit_q_')) {
      const sectionIndex = parseInt(cid.replace('build_edit_q_', ''), 10);
      const itemIndex = parseInt(interaction.values[0], 10);
      const section = getSection(sectionIndex);
      const current = section?.items?.[itemIndex] || '';

      const modal = new ModalBuilder()
        .setCustomId(`build_editmodal_${sectionIndex}_${itemIndex}`)
        .setTitle(`Edit Q${itemIndex + 1}`.slice(0, 45));

      const input = new TextInputBuilder()
        .setCustomId('new_text')
        .setLabel('Question text')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000)
        .setValue(String(current).slice(0, 1000));

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return true;
    }

    // ---- Edit modal submit ----
    if (interaction.isModalSubmit() && cid.startsWith('build_editmodal_')) {
      const parts = cid.replace('build_editmodal_', '').split('_');
      const sectionIndex = parseInt(parts[0], 10);
      const itemIndex = parseInt(parts[1], 10);
      const newText = interaction.fields.getTextInputValue('new_text').trim();
      if (!newText) {
        await interaction.reply({ content: 'Text cannot be empty.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const key = `${interaction.user.id}_edit_${sectionIndex}_${itemIndex}`;
      pending.set(key, newText);
      setTimeout(() => pending.delete(key), 10 * 60 * 1000);

      const section = getSection(sectionIndex);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`build_confirm_edit_${sectionIndex}_${itemIndex}`)
          .setLabel('Confirm Edit')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('build_cancel')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('Confirm edit')
            .setColor(0x5865f2)
            .addFields(
              { name: 'Section', value: section?.title || String(sectionIndex) },
              { name: 'Question', value: `Q${itemIndex + 1}` },
              { name: 'New text', value: newText.slice(0, 1024) }
            )
        ],
        components: [row],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    // ---- Confirm edit ----
    if (interaction.isButton() && cid.startsWith('build_confirm_edit_')) {
      const parts = cid.replace('build_confirm_edit_', '').split('_');
      const sectionIndex = parseInt(parts[0], 10);
      const itemIndex = parseInt(parts[1], 10);
      const key = `${interaction.user.id}_edit_${sectionIndex}_${itemIndex}`;
      const newText = pending.get(key);
      if (!newText) {
        await interaction.update({ content: '⏱️ Expired — start again.', embeds: [], components: [] });
        return true;
      }
      const ok = updateQuestion(sectionIndex, itemIndex, newText);
      pending.delete(key);
      await interaction.update({
        content: ok
          ? `✅ Updated **Q${itemIndex + 1}** in section ${sectionIndex + 1}.`
          : '❌ Failed to update.',
        embeds: [],
        components: []
      });
      return true;
    }

    // ---- Add Question: pick section (buttons) ----
    if (interaction.isButton() && cid === 'build_add') {
      const sections = listSections();
      if (!sections.length) {
        await interaction.reply({
          content: 'No sections yet. Use **Add Section** first.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      const rows = [];
      let row = new ActionRowBuilder();
      sections.slice(0, 25).forEach((s, i) => {
        const label = `${i + 1}. ${s.title || 'Section'}`.slice(0, 80);
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`build_add_sec_${i}`)
            .setLabel(label)
            .setStyle(ButtonStyle.Success)
        );
        if (row.components.length === 5) {
          rows.push(row);
          row = new ActionRowBuilder();
        }
      });
      if (row.components.length) rows.push(row);

      await interaction.reply({
        content: '**Add Question** — choose a section:',
        components: rows,
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    // ---- Add: section button → modal ----
    if (interaction.isButton() && cid.startsWith('build_add_sec_')) {
      const sectionIndex = parseInt(cid.replace('build_add_sec_', ''), 10);
      const section = getSection(sectionIndex);
      if (!section) {
        await interaction.update({ content: 'Section not found.', components: [] });
        return true;
      }
      const modal = new ModalBuilder()
        .setCustomId(`build_addmodal_${sectionIndex}`)
        .setTitle(`Add to ${String(section.title || 'Section').slice(0, 30)}`);

      const input = new TextInputBuilder()
        .setCustomId('new_text')
        .setLabel('New question text')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000)
        .setPlaceholder('Type the new Build Certification question…');

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return true;
    }

    // ---- Add: section chosen via old select → modal ----
    if (interaction.isStringSelectMenu() && cid === 'build_add_section') {
      const sectionIndex = parseInt(interaction.values[0], 10);
      const section = getSection(sectionIndex);
      if (!section) {
        await interaction.update({ content: 'Section not found.', components: [] });
        return true;
      }
      const modal = new ModalBuilder()
        .setCustomId(`build_addmodal_${sectionIndex}`)
        .setTitle(`Add to ${String(section.title || 'Section').slice(0, 30)}`);

      const input = new TextInputBuilder()
        .setCustomId('new_text')
        .setLabel('New question text')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000)
        .setPlaceholder('Type the new Build Certification question…');

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return true;
    }

    // ---- Add modal → confirm ----
    if (interaction.isModalSubmit() && cid.startsWith('build_addmodal_')) {
      const sectionIndex = parseInt(cid.replace('build_addmodal_', ''), 10);
      const newText = interaction.fields.getTextInputValue('new_text').trim();
      if (!newText) {
        await interaction.reply({ content: 'Text cannot be empty.', flags: MessageFlags.Ephemeral });
        return true;
      }
      const key = `${interaction.user.id}_add_${sectionIndex}`;
      pending.set(key, newText);
      setTimeout(() => pending.delete(key), 10 * 60 * 1000);

      const section = getSection(sectionIndex);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`build_confirm_add_${sectionIndex}`)
          .setLabel('Confirm Add')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('build_cancel')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('Confirm new question')
            .setColor(0x57f287)
            .addFields(
              { name: 'Section', value: section?.title || String(sectionIndex) },
              { name: 'New question', value: newText.slice(0, 1024) }
            )
        ],
        components: [row],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    // ---- Confirm add ----
    if (interaction.isButton() && cid.startsWith('build_confirm_add_')) {
      const sectionIndex = parseInt(cid.replace('build_confirm_add_', ''), 10);
      const key = `${interaction.user.id}_add_${sectionIndex}`;
      const newText = pending.get(key);
      if (!newText) {
        await interaction.update({ content: '⏱️ Expired — start again.', embeds: [], components: [] });
        return true;
      }
      const count = addQuestion(sectionIndex, newText);
      pending.delete(key);
      const section = getSection(sectionIndex);
      await interaction.update({
        content: count
          ? `✅ Added as **Q${count}** in **${section?.title || 'section'}**.`
          : '❌ Failed to add.',
        embeds: [],
        components: []
      });
      return true;
    }

    // ---- Add Section ----
    if (interaction.isButton() && cid === 'build_addsection') {
      const modal = new ModalBuilder()
        .setCustomId('build_sectionmodal')
        .setTitle('Add Build Certification Section');

      const input = new TextInputBuilder()
        .setCustomId('section_title')
        .setLabel('Section title')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100)
        .setPlaceholder('e.g. V. Advanced Building');

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return true;
    }

    if (interaction.isModalSubmit() && cid === 'build_sectionmodal') {
      const title = interaction.fields.getTextInputValue('section_title').trim();
      if (!title) {
        await interaction.reply({ content: 'Title cannot be empty.', flags: MessageFlags.Ephemeral });
        return true;
      }
      const n = addSection(title);
      await interaction.reply({
        content: `✅ Section **${title}** added (section #${n}).\nRe-run \`/buildpanel\` in the channel if you want the public panel summary refreshed.`,
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    // ---- Cancel ----
    if (interaction.isButton() && cid === 'build_cancel') {
      await interaction.update({ content: 'Cancelled.', embeds: [], components: [] });
      return true;
    }
  } catch (err) {
    console.error('[BUILD] interaction error:', err);
    try {
      const msg = { content: 'Something went wrong. Try again.', flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
      else await interaction.reply(msg);
    } catch (_) {}
    return true;
  }

  return false;
}

function buildCertCommandBuilders() {
  return [
    new SlashCommandBuilder()
      .setName('buildpanel')
      .setDescription('Post the Build Certification editor panel in this channel'),
    new SlashCommandBuilder()
      .setName('buildreload')
      .setDescription('Force-reload the official Build Certification questions (overwrites data file)')
  ];
}

async function handleBuildCertCommand(interaction) {
  if (!interaction.isChatInputCommand()) return false;
  if (interaction.commandName !== 'buildpanel' && interaction.commandName !== 'buildreload') {
    return false;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (interaction.commandName === 'buildreload') {
    try {
      const data = forceReloadDefaults();
      const total = data.sections.reduce((n, s) => n + (s.items?.length || 0), 0);
      try {
        const thread = await interaction.client.channels.fetch(BUILD_THREAD_ID);
        if (thread) await postPanel(thread);
      } catch (e) {
        console.warn('[BUILD] panel refresh after reload failed:', e.message);
      }
      await interaction.editReply({
        content:
          `✅ Reloaded official Build Certification checklist.\n` +
          `**${data.sections.length} sections**, **${total} questions**.\n` +
          `Panel refreshed in the Build Certification thread.`
      });
    } catch (err) {
      console.error('[BUILD] reload failed:', err);
      await interaction.editReply({ content: `Failed: ${err.message}` });
    }
    return true;
  }

  try {
    await postPanel(interaction.channel);
    await interaction.editReply({
      content: `✅ Build Certification panel posted in ${interaction.channel}.`
    });
  } catch (err) {
    console.error('[BUILD] panel post failed:', err);
    await interaction.editReply({ content: `Failed: ${err.message}` });
  }
  return true;
}

async function startBuildCert(client) {
  console.log('[BUILD] Build Certification editor starting…');
  ensureSeeded();
  const sections = listSections();
  const total = sections.reduce((n, s) => n + (Array.isArray(s.items) ? s.items.length : 0), 0);
  console.log(`[BUILD] Loaded ${sections.length} section(s), ${total} question(s)`);

  try {
    const thread = await client.channels.fetch(BUILD_THREAD_ID);
    if (!thread) {
      console.error('[BUILD] Could not fetch thread', BUILD_THREAD_ID);
      return;
    }
    await postPanel(thread);
    console.log(`[BUILD] Permanent panel posted in thread ${BUILD_THREAD_ID}`);
  } catch (err) {
    console.error('[BUILD] Failed to post permanent panel:', err.message);
    console.log('[BUILD] You can still use /buildpanel in the thread manually');
  }
}

module.exports = {
  startBuildCert,
  handleBuildCertInteraction,
  handleBuildCertCommand,
  buildCertCommandBuilders
};
