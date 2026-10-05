import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';

export const command = new SlashCommandBuilder()
  .setName('threadbot').setDescription('Manage automatic threads in this channel')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand(sub => sub.setName('settings').setDescription('Show this channel’s settings and queue size'))
  .addSubcommand(sub => sub.setName('configure').setDescription('Change settings for future threads in this channel')
    .addIntegerOption(option => option.setName('cooldown_seconds').setDescription('Spacing between threads from the same author (0 disables)')
      .setMinValue(0).setMaxValue(86400))
    .addIntegerOption(option => option.setName('title_characters').setDescription('Message characters before an ellipsis')
      .setMinValue(8).setMaxValue(48))
    .addIntegerOption(option => option.setName('auto_archive_minutes').setDescription('Archive new threads after this much inactivity')
      .addChoices({name: '1 hour', value: 60}, {name: '1 day', value: 1440},
        {name: '3 days', value: 4320}, {name: '1 week', value: 10080})))
  .addSubcommand(sub => sub.setName('pause').setDescription('Pause this channel; keep queued and missed posts for later'))
  .addSubcommand(sub => sub.setName('resume').setDescription('Resume this channel and catch up on missed posts'))
  .addSubcommand(sub => sub.setName('reset').setDescription('Restore startup defaults without discarding queued posts'));

export function channelSettings(defaults, state) {
  const config = { ...defaults, titleChars: 32, paused: false, ...state.settings };
  if (!Number.isInteger(config.cooldown) || config.cooldown < 0 || config.cooldown > 86400000
    || ![60, 1440, 4320, 10080].includes(config.archive)
    || !Number.isInteger(config.titleChars) || config.titleChars < 8 || config.titleChars > 48
    || typeof config.paused !== 'boolean') throw new Error('Invalid channel settings');
  return config;
}

function summary(defaults, state) {
  const config = channelSettings(defaults, state);
  return `Threads: ${config.paused ? 'paused' : 'active'}\nCooldown: ${config.cooldown / 1000} seconds`
    + `\nTitle: first ${config.titleChars} characters, then ... if truncated`
    + `\nAuto archive: ${config.archive} minutes\nQueued posts: ${state.pending.length}`;
}

export function applyCommand(subcommand, options, defaults, state, save) {
  if (subcommand === 'settings') return summary(defaults, state);
  const previous = state.settings;
  const next = { ...channelSettings(defaults, state) };
  // Persist only behavior overrides, never startup credentials or channel lists.
  delete next.channels;
  if (subcommand === 'configure') {
    const cooldown = options.getInteger('cooldown_seconds');
    const title = options.getInteger('title_characters');
    const archive = options.getInteger('auto_archive_minutes');
    if (cooldown === null && title === null && archive === null) return 'Choose at least one setting to change.';
    if (cooldown !== null) next.cooldown = cooldown * 1000;
    if (title !== null) next.titleChars = title;
    if (archive !== null) next.archive = archive;
  } else if (subcommand === 'pause') next.paused = true;
  else if (subcommand === 'resume') next.paused = false;
  else if (subcommand === 'reset') {
    next.cooldown = defaults.cooldown;
    next.archive = defaults.archive;
    next.titleChars = 32;
    // Resetting preferences does not unexpectedly resume a paused channel.
  } else throw new Error('Unknown command');
  channelSettings(defaults, { settings: next });
  state.settings = subcommand === 'reset' ? { paused: next.paused }
    : { cooldown: next.cooldown, archive: next.archive, titleChars: next.titleChars, paused: next.paused };
  try { save(); }
  catch (error) {
    if (previous === undefined) delete state.settings;
    else state.settings = previous;
    throw error;
  }
  return `Saved for this channel.\n${summary(defaults, state)}`;
}

export async function handleCommand(interaction, defaults, store, exclusive) {
  if (!interaction.isChatInputCommand() || interaction.commandName !== 'threadbot') return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.editReply('You need Manage Server permission to use these commands.');
    return;
  }
  if (!defaults.channels.includes(interaction.channelId)) {
    await interaction.editReply('Use this command in a text channel already watched by ThreadBot.');
    return;
  }
  const content = await exclusive(() => applyCommand(interaction.options.getSubcommand(), interaction.options,
    defaults, store.data.channels[interaction.channelId], () => store.save()));
  await interaction.editReply({ content, allowedMentions: { parse: [] } });
}

// Settings changes and scans share one queue to avoid racing an in-flight thread.
export function operationQueue() {
  let tail = Promise.resolve();
  return action => {
    const result = tail.then(action);
    tail = result.catch(() => {});
    return result;
  };
}
