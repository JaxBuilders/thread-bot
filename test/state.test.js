import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from '../src/state.js';
test('queue and cooldown survive reopening the state file',()=>{
  const dir=mkdtempSync(join(tmpdir(),'thread-bot-test-'));
  try {
    const path=join(dir,'nested','state.json'); const store=new StateStore(path);
    store.data.channels.example={cursor:'2',pending:[{id:'3',author:'a'}],cooldowns:{a:12345}};
    store.save();
    assert.deepEqual(new StateStore(path).data,store.data);
    assert.equal(statSync(path).mode & 0o777,0o600);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('corrupt state fails closed rather than dropping pending work',()=>{
  const dir=mkdtempSync(join(tmpdir(),'thread-bot-test-'));
  try {const path=join(dir,'state.json');writeFileSync(path,'broken');assert.throws(()=>new StateStore(path));}
  finally {rmSync(dir,{recursive:true,force:true});}
});
