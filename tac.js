/**
 * Tactical Centre — Specialisation questions editor
 * Permanent buttons in Sentinel / Driller / Top Dog / Doughboy threads.
 * Question pick uses buttons (same style as Build Certification), not a dropdown.
 * Edits the Company Specific section only.
 */
const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags
} = require('discord.js');

const TAC_GUILD_ID = '1256977709884641382';

const THREADS = {
  '1537574763936088124': { name: 'Sentinel', company: 'Demon' },
  '1537575040659357706': { name: 'Driller', company: 'Nightmare' },
  '1537575307056390204': { name: 'Top Dog', company: 'Cerberus' },
  '1537575804316287026': { name: 'Doughboy', company: 'Hellfire' }
};

const DATA_PATH = path.join(__dirname, 'data', 'specialisations.json');
const pendingEdits = new Map();

function loadData() {
  if (!fs.existsSync(DATA_PATH)) {
    console.warn('[TAC] specialisations.json not found at', DATA_PATH);
    return {};
  }
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
}

function saveData(data) {
  const dir = path.dirname(DATA_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function getCompanySpecificSection(company) {
  const data = loadData();
  const spec = data[company];
  if (!spec || !Array.isArray(spec.sections)) return null;
  return (
    spec.sections.find((s) => s.title && s.title.includes('Company Specific')) ||
    spec.sections[spec.sections.length - 1] ||
    null
  );
}

function getCompanySpecificItems(company) {
  const section = getCompanySpecificSection(company);
  return section?.items || [];
}

function updateQuestion(company, index, newText) {
  const data = loadData();
  const spec = data[company];
  if (!spec || !Array.isArray(spec.sections)) return false;
  const section =
    spec.sections.find((s) => s.title && s.title.includes('Company Specific')) ||
    spec.sections[spec.sections.length - 1];
  if (!section || !Array.isArray(section.items) || index < 0 || index >= section.items.length) {
    return false;
  }
  section.items[index] = newText;
  saveData(data);
  return true;
}

function addQuestion(company, newText) {
  const data = loadData();
  let spec = data[company];
  if (!spec) {
    data[company] = { sections: [{ title: 'V. Company Specific', items: [] }] };
    spec = data[company];
  }
  if (!Array.isArray(spec.sections)) spec.sections = [];
  let section = spec.sections.find((s) => s.title && s.title.includes('Company Specific'));
  if (!section) {
    section = { title: 'V. Company Specific', items: [] };
    spec.sections.push(section);
  }
  if (!Array.isArray(section.items)) section.items = [];
  section.items.push(newText);
  saveData(data);
  return section.items.length;
}

function friendlyName(company) {
  return Object.values(THREADS).find((t) => t.company === company)?.name || company;
}

async function postPermanentMessage(client, threadId) {
  const thread = await client.channels.fetch(threadId).catch(() => null);
  if (!thread) {
    console.error(`[TAC] Could not fetch thread ${threadId}`);
    return;
  }
  const info = THREADS[threadId];
  if (!info) return;

  try {
    const messages = await thread.messages.fetch({ limit: 30 });
    for (const msg of messages.values()) {
      if (msg.author.id === client.user.id) {
        await msg.delete().catch(() => {});
      }
    }
  } catch (err) {
    console.warn(`[TAC] Could not clean old messages in ${info.name}:`, err.message);
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tac_edit_${info.company}`)
      .setLabel(`Edit ${info.name} Questions`)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`tac_add_${info.company}`)
      .setLabel('Add Question')
      .setStyle(ButtonStyle.Success)
  );

  await thread.send({
    content:
      `**${info.name} Specialization Editor**\n` +
      `Only the person who clicks a button will see the steps.\n` +
      `**Edit** existing Company Specific questions, or **Add** a new one.\n` +
      `The thread stays clean for everyone else.`,
    components: [row]
  });
  console.log(`[TAC] Permanent button posted in ${info.name} thread (${info.company})`);
}

async function handleTacInteraction(interaction) {
  if (!interaction.guildId || interaction.guildId !== TAC_GUILD_ID) return false;

  const cid = interaction.customId || '';
  const isTac =
    (interaction.isButton() && cid.startsWith('tac_')) ||
    (interaction.isModalSubmit() && cid.startsWith('tac_'));
  if (!isTac) return false;

  try {
    // 1. Edit button → question buttons (same style as Build Cert)
    if (interaction.isButton() && cid.startsWith('tac_edit_') && !cid.startsWith('tac_edit_q_')) {
      const company = cid.replace('tac_edit_', '');
      const questions = getCompanySpecificItems(company);
      if (!questions.length) {
        await interaction.reply({
          content: 'No Company Specific questions found for this specialization.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      const section = getCompanySpecificSection(company);
      const sectionTitle = section?.title || 'Company Specific';

      // Buttons: Q1: question text…  (max 5 per row, max 5 rows = 25)
      const rows = [];
      let row = new ActionRowBuilder();
      questions.slice(0, 25).forEach((text, i) => {
        const label = `Q${i + 1}: ${String(text)}`.slice(0, 80);
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`tac_edit_q_${company}_${i}`)
            .setLabel(label)
            .setStyle(ButtonStyle.Secondary)
        );
        if (row.components.length === 5) {
          rows.push(row);
          row = new ActionRowBuilder();
        }
      });
      if (row.components.length) rows.push(row);

      await interaction.reply({
        content: `**${sectionTitle}** — select a question to edit:\n*${friendlyName(company)} Specialization*`,
        components: rows,
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    // 2. Question button → modal
    if (interaction.isButton() && cid.startsWith('tac_edit_q_')) {
      // tac_edit_q_Company_index
      const rest = cid.replace('tac_edit_q_', '');
      const lastUnderscore = rest.lastIndexOf('_');
      const company = rest.slice(0, lastUnderscore);
      const index = parseInt(rest.slice(lastUnderscore + 1), 10);
      const questions = getCompanySpecificItems(company);
      const currentText = questions[index] || '';

      const modal = new ModalBuilder()
        .setCustomId(`tac_modal_${company}_${index}`)
        .setTitle(`Edit Q${index + 1}`.slice(0, 45));

      const input = new TextInputBuilder()
        .setCustomId('new_text')
        .setLabel('Question text')
        .setStyle(TextInputStyle.Paragraph)
        .setValue(String(currentText).slice(0, 1000))
        .setRequired(true)
        .setMaxLength(1000);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return true;
    }

    // 3. Modal → preview
    if (interaction.isModalSubmit() && cid.startsWith('tac_modal_')) {
      const parts = cid.split('_');
      // tac_modal_Company_index
      const company = parts[2];
      const index = parseInt(parts[3], 10);
      const newText = interaction.fields.getTextInputValue('new_text').trim();
      const oldText = getCompanySpecificItems(company)[index] || '';

      const key = `${interaction.user.id}_${company}_${index}`;
      pendingEdits.set(key, newText);
      setTimeout(() => pendingEdits.delete(key), 10 * 60 * 1000);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`tac_confirm_${company}_${index}`)
          .setLabel('Confirm Change')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('tac_cancel_edit')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`Preview — Q${index + 1}`)
            .setColor(0x5865f2)
            .addFields(
              { name: 'Old Text', value: (oldText || '*empty*').slice(0, 1024) },
              { name: 'New Text', value: (newText || '*empty*').slice(0, 1024) }
            )
            .setFooter({ text: 'Only you can see this message' })
        ],
        components: [row],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    // 4. Confirm edit
    if (interaction.isButton() && cid.startsWith('tac_confirm_')) {
      const parts = cid.split('_');
      const company = parts[2];
      const index = parseInt(parts[3], 10);
      const key = `${interaction.user.id}_${company}_${index}`;
      const newText = pendingEdits.get(key);

      if (!newText) {
        await interaction.update({
          content: '⏱️ This edit has expired. Please start again from the permanent button.',
          embeds: [],
          components: []
        });
        return true;
      }

      const success = updateQuestion(company, index, newText);
      pendingEdits.delete(key);

      if (success) {
        await interaction.update({
          content:
            `✅ **Q${index + 1}** updated successfully.\n\n` +
            `Saved to \`data/specialisations.json\`.`,
          embeds: [],
          components: []
        });
        console.log(`[TAC] ${interaction.user.tag} updated ${company} Q${index + 1}`);
      } else {
        await interaction.update({
          content: '❌ Failed to update the question. Please try again.',
          embeds: [],
          components: []
        });
      }
      return true;
    }

    // 5. Add Question button → modal
    if (interaction.isButton() && cid.startsWith('tac_add_') && !cid.startsWith('tac_addconfirm_')) {
      const company = cid.replace('tac_add_', '');
      const name = friendlyName(company);

      const modal = new ModalBuilder()
        .setCustomId(`tac_addmodal_${company}`)
        .setTitle(`Add ${name} Question`.slice(0, 45));

      const input = new TextInputBuilder()
        .setCustomId('new_text')
        .setLabel('New Company Specific question')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Type the new question / criteria…')
        .setRequired(true)
        .setMaxLength(1000);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return true;
    }

    // 6. Add modal → preview
    if (interaction.isModalSubmit() && cid.startsWith('tac_addmodal_')) {
      const company = cid.replace('tac_addmodal_', '');
      const newText = interaction.fields.getTextInputValue('new_text').trim();
      if (!newText) {
        await interaction.reply({
          content: 'Question text cannot be empty.',
          flags: MessageFlags.Ephemeral
        });
        return true;
      }

      const key = `${interaction.user.id}_add_${company}`;
      pendingEdits.set(key, newText);
      setTimeout(() => pendingEdits.delete(key), 10 * 60 * 1000);

      const name = friendlyName(company);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`tac_addconfirm_${company}`)
          .setLabel('Confirm Add')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('tac_cancel_edit')
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`Add question — ${name}`)
            .setColor(0x57f287)
            .addFields({ name: 'New Question', value: newText.slice(0, 1024) })
            .setFooter({ text: 'Only you can see this message' })
        ],
        components: [row],
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    // 7. Confirm add
    if (interaction.isButton() && cid.startsWith('tac_addconfirm_')) {
      const company = cid.replace('tac_addconfirm_', '');
      const key = `${interaction.user.id}_add_${company}`;
      const newText = pendingEdits.get(key);

      if (!newText) {
        await interaction.update({
          content: '⏱️ This add has expired. Please start again from **Add Question**.',
          embeds: [],
          components: []
        });
        return true;
      }

      const count = addQuestion(company, newText);
      pendingEdits.delete(key);

      if (count) {
        await interaction.update({
          content:
            `✅ **New question added** as Company Specific **Q${count}**.\n\n` +
            `${newText.slice(0, 500)}\n\n` +
            `Saved to \`data/specialisations.json\`.`,
          embeds: [],
          components: []
        });
        console.log(`[TAC] ${interaction.user.tag} added ${company} Q${count}`);
      } else {
        await interaction.update({
          content: '❌ Failed to add the question. Please try again.',
          embeds: [],
          components: []
        });
      }
      return true;
    }

    // 8. Cancel
    if (interaction.isButton() && cid === 'tac_cancel_edit') {
      await interaction.update({
        content: 'Cancelled.',
        embeds: [],
        components: []
      });
      return true;
    }
  } catch (err) {
    console.error('[TAC] Interaction error:', err);
    const msg = { content: 'Something went wrong. Please try again.', flags: MessageFlags.Ephemeral };
    try {
      if (interaction.replied || interaction.deferred) await interaction.followUp(msg);
      else await interaction.reply(msg);
    } catch (_) {}
    return true;
  }

  return false;
}

async function startTac(client) {
  console.log('[TAC] Tactical Centre specialisation editor starting…');
  if (!fs.existsSync(DATA_PATH)) {
    console.warn('[TAC] Missing data/specialisations.json — editor will have no questions until file is added');
  } else {
    console.log('[TAC] Loaded specialisations.json');
  }

  for (const threadId of Object.keys(THREADS)) {
    try {
      await postPermanentMessage(client, threadId);
    } catch (err) {
      console.error(`[TAC] Failed to post in thread ${threadId}:`, err.message);
    }
  }
  console.log('[TAC] Ready — threads:', Object.values(THREADS).map((t) => `${t.name}/${t.company}`).join(', '));
}

module.exports = {
  startTac,
  handleTacInteraction
};
