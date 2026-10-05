import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PermissionFlagsBits, MessageFlags } from 'discord.js';
import { command, channelSettings, applyCommand, handleCommand, operationQueue } from '../src/commands.js';
import { StateStore } from '../src/state.js';

const defaults = { channels: ['example'], cooldown: 60000, archive: 1440 };
const state = () => ({ cursor: '2', pending: [{ id: '3', author: 'a' }], cooldowns: { a: 12345 } });
const options = values => ({ getInteger: name => values[name] ?? null });

test('commands persist per-channel settings across restarts without changing queues', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thread-bot-commands-'));
  try {
    const path = join(dir, 'state.json');
    const store = new StateStore(path);
    store.data.channels.example = state();
    store.data.channels.other = state();
    const original = structuredClone(store.data.channels.example);
    applyCommand('configure', options({ cooldown_seconds: 0, title_characters: 48, auto_archive_minutes: 60 }),
      defaults, store.data.channels.example, () => store.save());
    const reopened = new StateStore(path).data.channels;
    assert.deepEqual(reopened.example.settings, { cooldown: 0, titleChars: 48, archive: 60, paused: false });
    assert.deepEqual(reopened.example.pending, original.pending);
    assert.deepEqual(reopened.example.cooldowns, original.cooldowns);
    assert.equal(reopened.example.cursor, original.cursor);
    assert.equal(reopened.other.settings, undefined);
    assert.equal(reopened.example.settings.channels, undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('pause, reset and resume preserve queued work and pause status', () => {
  const value = state();
  applyCommand('pause', options({}), defaults, value, () => {});
  applyCommand('configure', options({ title_characters: 8 }), defaults, value, () => {});
  applyCommand('reset', options({}), defaults, value, () => {});
  assert.deepEqual(value.settings, { paused: true });
  assert.equal(channelSettings(defaults, value).titleChars, 32);
  assert.equal(channelSettings({ ...defaults, cooldown: 120000 }, value).cooldown, 120000);
  applyCommand('resume', options({}), defaults, value, () => {});
  assert.equal(value.settings.paused, false);
  assert.deepEqual(value.pending, state().pending);
});
test('invalid settings and failed persistence do not change live settings', () => {
  const value = state();
  for (const invalid of [{ cooldown_seconds: -1 }, { title_characters: 49 }, { auto_archive_minutes: 5 }]) {
    assert.throws(() => applyCommand('configure', options(invalid), defaults, value, () => {}));
    assert.equal(value.settings, undefined);
  }
  assert.throws(() => applyCommand('pause', options({}), defaults, value, () => { throw new Error('Disk full'); }));
  assert.equal(value.settings, undefined);
  assert.throws(() => channelSettings(defaults, { settings: { paused: 'yes' } }));
});
test('settings and empty configure do not write, and report only behavior and counts', () => {
  const value = state();
  const save = () => assert.fail('Unexpected save');
  assert.match(applyCommand('settings', options({}), defaults, value, save), /Queued posts: 1/);
  assert.match(applyCommand('configure', options({}), defaults, value, save), /Choose at least one/);
  assert.equal(value.settings, undefined);
});
function interaction({ permission = true, guild = true, channelId = 'example' } = {}) {
  const replies = [];
  return {
    replies, commandName: 'threadbot', channelId,
    isChatInputCommand: () => true, inGuild: () => guild,
    memberPermissions: { has: bit => permission && bit === PermissionFlagsBits.ManageGuild },
    options: { getSubcommand: () => 'pause', ...options({}) },
    deferReply: async value => replies.push(value), editReply: async value => replies.push(value),
  };
}
test('permission, guild and watched-channel checks reject unauthorized changes', async () => {
  for (const input of [{ permission: false }, { guild: false }, { channelId: 'other' }]) {
    const request = interaction(input);
    await handleCommand(request, defaults, { save: () => assert.fail('Unexpected save') }, () => assert.fail('Unexpected mutation'));
    assert.deepEqual(request.replies[0], { flags: MessageFlags.Ephemeral });
    assert.equal(request.replies.length, 2);
  }
});
test('authorized command saves through the shared operation queue and replies privately', async () => {
  let saved = 0;
  const store = { data: { channels: { example: state() } }, save: () => saved++ };
  const request = interaction();
  await handleCommand(request, defaults, store, operationQueue());
  assert.equal(saved, 1);
  assert.equal(store.data.channels.example.settings.paused, true);
  assert.deepEqual(request.replies[0], { flags: MessageFlags.Ephemeral });
  assert.match(request.replies[1].content, /paused/);
});
test('settings wait for in-flight processing and queue recovers after failed work', async () => {
  const exclusive = operationQueue();
  const events = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = exclusive(async () => { events.push('scan'); await gate; events.push('completed'); });
  const second = exclusive(() => { events.push('settings'); });
  await Promise.resolve();
  assert.deepEqual(events, ['scan']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['scan', 'completed', 'settings']);
  await assert.rejects(exclusive(() => { throw new Error('Failure'); }));
  assert.equal(await exclusive(() => 'recovered'), 'recovered');
});
test('registration defaults to Manage Server and retains bounded options', () => {
  const body = command.toJSON();
  assert.equal(body.default_member_permissions, PermissionFlagsBits.ManageGuild.toString());
  const configure = body.options.find(option => option.name === 'configure');
  assert.equal(configure.options.find(option => option.name === 'title_characters').max_value, 48);
});
