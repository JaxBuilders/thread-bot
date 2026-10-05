import test from 'node:test';
import assert from 'node:assert/strict';
import { processChannel, eligible, settings, DiscordError, threadTitle } from '../src/core.js';
const config = { cooldown: 60000, archive: 1440 };
function harness(messages, state = { cursor: '1', pending: [], cooldowns: {} }) {
  const threads = new Set(); const created = []; let saved;
  const api = async (path, method) => {
    if (path.includes('/messages?')) return messages.filter(x => BigInt(x.id) > BigInt(state.cursor)).reverse();
    if (path.includes('/messages/') && !method) {
      const message = messages.find(x => x.id === path.split('/')[4]);
      if (!message) throw new DiscordError(404,10008);
      return message;
    }
    if (method === 'POST') { const id = path.split('/')[4]; threads.add(id); created.push(id); return {}; }
    if (method === 'PUT') return null;
    const id = path.split('/')[2];
    if (threads.has(id)) return {};
    throw new DiscordError(404,10003);
  };
  return { state, threads, created, api, save: async value => { saved = structuredClone(value); }, get saved() { return saved; } };
}
const post = (id, author, extra = {}) => ({id, author: {id: author}, type: 0, ...extra});
test('every ordinary message is eligible, including empty attachment and bot posts', () => {
  assert.ok(eligible(post('2','a',{ content:'', attachments:[{}] })));
  assert.ok(eligible(post('3','b',{ author: {id:'b',bot:true} })));
  assert.ok(eligible(post('4','c',{type:19})));
  assert.equal(eligible(post('5','a',{type:18})), false);
});
test('cooldown defers the same author while another author proceeds, then drains', async () => {
  const h = harness([post('2','a'),post('3','a'),post('4','b')]);
  await processChannel('channel',h.state,h.api,h.save,1000,config);
  assert.deepEqual(h.created,['2','4']);
  assert.deepEqual(h.state.pending,[{id:'3',author:'a'}]);
  await processChannel('channel',h.state,h.api,h.save,61000,config);
  assert.deepEqual(h.created,['2','4','3']);
  assert.deepEqual(h.state.pending,[]);
});
test('recovering a created thread does not create it twice', async () => {
  const h=harness([], {cursor:'2',pending:[{id:'2',author:'a'}],cooldowns:{}});
  h.threads.add('2');
  await processChannel('channel',h.state,h.api,h.save,1000,config);
  assert.deepEqual(h.created,[]); assert.deepEqual(h.state.pending,[]);
});
test('rate limits preserve the pending message and propagate retry delay', async () => {
  const h=harness([post('2','a')]);
  const api=async (path,method) => { if(method==='POST') throw new DiscordError(429,0,120); return h.api(path,method); };
  await assert.rejects(processChannel('channel',h.state,api,h.save,1000,config),{status:429,retryAfter:120});
  assert.equal(h.saved.pending[0].id,'2');
});
test('deleted starter is dropped without blocking subsequent posts', async () => {
  const h=harness([post('2','a'),post('3','b')]);
  const api=async(path,method)=>{ if(method==='POST' && path.includes('/messages/2/')) throw new DiscordError(404,10008); return h.api(path,method); };
  await processChannel('channel',h.state,api,h.save,1000,config);
  assert.deepEqual(h.created,['3']); assert.deepEqual(h.state.pending,[]);
});
test('existing threads and system notices are skipped', async()=>{
  const h=harness([post('2','a',{flags:32}),post('3','b',{type:18})]);
  await processChannel('channel',h.state,h.api,h.save,1000,config);
  assert.deepEqual(h.created,[]); assert.equal(h.state.cursor,'3');
});
test('configuration fails closed',()=>{
  assert.throws(()=>settings({DISCORD_TOKEN:'example',CHANNEL_IDS:'invalid'}));
  assert.throws(()=>settings({DISCORD_TOKEN:'example',CHANNEL_IDS:'100000000000000000',COOLDOWN_SECONDS:'-1'}));
});

test('titles use normalized message text and truncate after 32 characters', () => {
  assert.equal(threadTitle({ content: '  A short\nmessage  ' }), 'A short message');
  assert.equal(threadTitle({ content: 'x'.repeat(32) }), 'x'.repeat(32));
  assert.equal(threadTitle({ content: 'x'.repeat(33) }), 'x'.repeat(32) + '...');
  assert.equal(threadTitle({ content: '😀'.repeat(33) }), '😀'.repeat(32) + '...');
});
test('attachment and empty posts have descriptive fallback titles', () => {
  assert.equal(threadTitle({content:'',attachments:[{filename:'sketch.png'}]}), 'Attachment: sketch.png');
  assert.equal(threadTitle({embeds:[{title:'A shared article'}]}), 'A shared article');
  assert.equal(threadTitle({content:'   '}), 'New discussion');
});
test('titles clean Discord mention markup and invisible direction controls', () => {
  assert.equal(threadTitle({content:'Hi <@123456789012345678> <#123456789012345678>'}), 'Hi @user #channel');
  assert.equal(threadTitle({content:'hello\u202E there'}), 'hello there');
});
test('thread creation uses starter text without storing message content', async () => {
  const h=harness([post('2','a',{content:'A new project to share'})]);
  let name;
  const api=async(path,method,body)=>{ if(method==='POST') name=body.name; return h.api(path,method,body); };
  await processChannel('channel',h.state,api,h.save,1000,config);
  assert.equal(name,'A new project to share');
  assert.doesNotMatch(JSON.stringify(h.saved),/A new project/);
});
test('channel title and archive overrides are used, with Unicode names within Discord limits', async () => {
  const h = harness([post('2', 'a', { content: '😀'.repeat(60) })]);
  let body;
  const api = async (path, method, value) => { if (method === 'POST') body = value; return h.api(path, method); };
  await processChannel('channel', h.state, api, h.save, 1000, { ...config, titleChars: 48, archive: 60 });
  assert.equal(body.name, '😀'.repeat(48) + '...');
  assert.ok(body.name.length <= 100);
  assert.equal(body.auto_archive_duration, 60);
});
test('paused channels leave cursors, pending posts and cooldowns untouched and catch up on resume', async () => {
  const h = harness([post('2', 'a')]);
  const original = structuredClone(h.state);
  const fail = async () => assert.fail('Paused channel must not make API requests or save');
  await processChannel('channel', h.state, fail, fail, 1000, { ...config, paused: true });
  assert.deepEqual(h.state, original);
  await processChannel('channel', h.state, h.api, h.save, 1000, { ...config, paused: false });
  assert.deepEqual(h.created, ['2']);
});
