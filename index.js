// ========== /servermembers ==========
if (interaction.isChatInputCommand() && interaction.commandName === 'servermembers') {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const guild = await client.guilds.fetch('1256977709884641382');
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
      .setTitle('1st M.I. — All Member Stats (Main Server)')
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
    stats.users[user.id] = { points: 0, operations: 0, lastDrop: null };
  }

  if (points !== null) stats.users[user.id].points = points;
  if (operations !== null) stats.users[user.id].operations = operations;

  saveStats(stats);

  const embed = new EmbedBuilder()
    .setTitle('Member Stats Updated (Main Server)')
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
    .setTitle('Server Total Updated (Main Server)')
    .setColor(0x57F287)
    .setDescription(`Server **Total Dropships** has been set to **${total}**`);

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// ========== /setall (targets MAIN SERVER) ==========
if (interaction.isChatInputCommand() && interaction.commandName === 'setall') {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const points = interaction.options.getInteger('points');
  const operations = interaction.options.getInteger('operations');

  try {
    // Always fetch members from the MAIN server
    const guild = await client.guilds.fetch('1256977709884641382');
    await guild.members.fetch();

    let count = 0;

    guild.members.cache.forEach(member => {
      if (member.user.bot) return;

      if (!stats.users[member.id]) {
        stats.users[member.id] = { points: 0, operations: 0, lastDrop: null };
      }

      if (points !== null) stats.users[member.id].points = points;
      if (operations !== null) stats.users[member.id].operations = operations;

      count++;
    });

    saveStats(stats);

    const embed = new EmbedBuilder()
      .setTitle('All Member Stats Updated (Main Server)')
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
