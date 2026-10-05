import { DurableObject } from 'cloudflare:workers';
import { settings, snowflake, discordClient, processChannel } from './core.js';

export class Poller extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.ctx = ctx; this.env = env; this.running = null; }
  async poll(time) {
    // Overlapping cron deliveries share the same run instead of creating duplicates.
    if (this.running) return this.running;
    this.running = this.run(time);
    try { return await this.running; } finally { this.running = null; }
  }
  async run(time) {
    const config = settings(this.env);
    const api = discordClient(this.env.DISCORD_TOKEN);
    const now = Date.now();
    if ((await this.ctx.storage.get('retryAt') || 0) > now) return;
    for (const channel of config.channels) {
      const key = `channel:${channel}`;
      let state = await this.ctx.storage.get(key);
      if (!state) {
        // Start at activation time; do not mass-thread an existing channel's history.
        state = { cursor: snowflake(time), pending: [], cooldowns: {} };
        await this.ctx.storage.put(key, state);
        continue;
      }
      try {
        const count = await processChannel(channel, state, api, value => this.ctx.storage.put(key, value), now, config);
        console.log(JSON.stringify({ event: 'poll_complete', threads: count }));
      } catch (error) {
        console.error(JSON.stringify({ event: 'poll_failed', status: error.status || 0, code: error.code || 0 }));
        if (error.status === 429) {
          await this.ctx.storage.put('retryAt', now + Math.max(60000, error.retryAfter * 1000));
          break;
        }
      }
    }
  }
}
export default {
  async scheduled(controller, env) {
    await env.POLLER.get(env.POLLER.idFromName('poller')).poll(controller.scheduledTime);
  },
  fetch() { return new Response('Not found', { status: 404 }); }
};
