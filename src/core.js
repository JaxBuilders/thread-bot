export function settings(env) {
  const channels = [...new Set((env.CHANNEL_IDS || '').split(',').map(x => x.trim()).filter(Boolean))];
  const cooldown = Number(env.COOLDOWN_SECONDS ?? 60);
  const archive = Number(env.AUTO_ARCHIVE_MINUTES ?? 1440);
  if (!env.DISCORD_TOKEN || !channels.length || channels.length > 3 || channels.some(x => !/^\d{17,20}$/.test(x))) throw new Error('Invalid private configuration');
  if (!Number.isInteger(cooldown) || cooldown < 0 || cooldown > 86400 || ![60,1440,4320,10080].includes(archive)) throw new Error('Invalid timing configuration');
  return { channels, cooldown: cooldown * 1000, archive };
}
export function snowflake(time) {
  return ((BigInt(time) - 1420070400000n) << 22n).toString();
}
export function chronological(messages) {
  return [...messages].sort((a,b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);
}
export function eligible(message) {
  // Normal posts and replies, including bots, webhooks and attachment-only posts.
  // Discord-generated system notices (including thread notices) are excluded.
  return [0,19].includes(message.type) && message.author?.id;
}
export class DiscordError extends Error {
  constructor(status, code, retryAfter = 0) {
    super(`Discord request failed (${status}, ${code || 0})`);
    this.status = status; this.code = code; this.retryAfter = retryAfter;
  }
}
export async function processChannel(channel, state, api, save, now, config) {
  state.pending ??= [];
  state.cooldowns ??= {};
  // One page per run bounds requests; fetching after a cursor returns the next page.
  // Stop ingesting while a backlog is large; the cursor keeps remaining posts recoverable.
  if (state.pending.length < 200) {
    const messages = chronological(await api(`/channels/${channel}/messages?after=${state.cursor}&limit=100`));
    for (const message of messages) {
      if (eligible(message) && !(message.flags & 32)) state.pending.push({ id: message.id, author: message.author.id });
      state.cursor = message.id;
    }
    await save(state);
  }
  let completed = 0;
  for (const item of [...state.pending]) {
    if (completed >= 5) break;
    if ((state.cooldowns[item.author] || 0) > now) continue;
    try {
      // Thread IDs equal their starter message IDs, providing crash-safe deduplication.
      let existing;
      try { existing = await api(`/channels/${item.id}`); }
      catch (error) { if (error.status !== 404) throw error; }
      if (!existing) {
        try {
          await api(`/channels/${channel}/messages/${item.id}/threads`, 'POST', {
            name: `Discussion ${item.id.slice(-6)}`, auto_archive_duration: config.archive
          });
        } catch (error) {
          if (error.code === 10008) {
            state.pending = state.pending.filter(x => x.id !== item.id);
            await save(state); continue;
          }
          if (error.code !== 160004) throw error;
        }
      }
      await api(`/channels/${item.id}/thread-members/${item.author}`, 'PUT');
      state.pending = state.pending.filter(x => x.id !== item.id);
      state.cooldowns[item.author] = now + config.cooldown;
      completed++;
      await save(state);
    } catch (error) {
      if (error.status === 429) throw error;
      // Leave this post queued for a later run. Never log message bodies or IDs.
      throw error;
    }
  }
  for (const [author, until] of Object.entries(state.cooldowns)) if (until <= now) delete state.cooldowns[author];
  await save(state);
  return completed;
}
