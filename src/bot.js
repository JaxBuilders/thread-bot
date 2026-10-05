import { Client, Events, GatewayIntentBits, ActivityType, ChannelType, PermissionFlagsBits } from 'discord.js';
import { writeFileSync } from 'node:fs';
import { settings, snowflake, processChannel } from './core.js';
import { StateStore } from './state.js';

const log = (event, error) => console.log(JSON.stringify({ event, ...(error ? { code: Number(error.code) || 0, status: Number(error.status) || 0 } : {}) }));
const config = settings(process.env);
const store = new StateStore(process.env.STATE_PATH || './data/state.json');
for (const channel of config.channels) {
  store.data.channels[channel] ??= { cursor: snowflake(Date.now()), pending: [], cooldowns: {} };
}
store.save();
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  presence: { status: 'online', activities: [{ name: 'for new posts', type: ActivityType.Watching }] } });
const api = (path, method = 'GET', body) => client.rest[method.toLowerCase()](path, body === undefined ? {} : { body });
let busy = false;
let lastScan = 0;
let lastReady = Date.now();
let lastSuccess = 0;
let stopping = false;
async function scan() {
  if (busy || stopping || !client.isReady()) return;
  busy = true;
  let healthy = true;
  try {
    for (const channel of config.channels) {
      try {
        await processChannel(channel, store.data.channels[channel], api, async () => store.save(), Date.now(), config);
      } catch (error) { healthy = false; log('channel_processing_failed', error); }
    }
    lastScan = Date.now();
    if (healthy) lastSuccess = lastScan;
    client.user.setPresence({status: healthy ? 'online' : 'idle', activities: [{name: healthy ? 'for new posts' : 'Check bot logs',type: ActivityType.Watching}]});
  } finally { busy = false; }
}
client.on(Events.ClientReady, async () => {
  log('gateway_ready');
  const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads, PermissionFlagsBits.SendMessagesInThreads];
  try {
    for (const id of config.channels) {
      const channel = await client.channels.fetch(id);
      if (channel?.type !== ChannelType.GuildText || !channel.permissionsFor(client.user)?.has(required)) throw new Error('Invalid channel or missing permissions');
    }
    await scan();
  } catch (error) { log('channel_setup_failed',error); await shutdown(1); }
});
client.on(Events.MessageCreate, message => { if (config.channels.includes(message.channelId)) void scan().catch(error => log('scan_failed',error)); });
client.on(Events.Error, error => log('gateway_error',error));
client.on(Events.ShardError, error => log('gateway_shard_error',error));
client.on(Events.ShardDisconnect, () => log('gateway_disconnected'));
client.on(Events.ShardResume, () => { log('gateway_resumed'); void scan().catch(error => log('scan_failed',error)); });
const timer = setInterval(() => {
  const now = Date.now();
  if (client.isReady()) lastReady = now;
  if (now - lastReady > 180000) { log('gateway_watchdog_restart'); void shutdown(1); return; }
  // Drain cooldown queues promptly; scan history periodically for missed events.
  const pending = Object.values(store.data.channels).some(state => state.pending.length);
  if (pending || now - lastScan > 60000) void scan().catch(error => log('scan_failed',error));
  try { writeFileSync(process.env.HEALTH_PATH || '/tmp/thread-bot-health.json', JSON.stringify({ ready: client.isReady(), lastSuccess }), {mode:0o600}); }
  catch { log('health_write_failed'); }
}, 5000);
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  client.destroy();
  // Give an in-flight request time to persist its completion before exiting.
  const deadline = Date.now() + 15000;
  while (busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve,100));
  store.save();
  process.exit(code);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
process.on('unhandledRejection', error => { log('unexpected_failure',error); void shutdown(1); });
client.login(process.env.DISCORD_TOKEN).catch(error => { log('login_failed',error); void shutdown(1); });
