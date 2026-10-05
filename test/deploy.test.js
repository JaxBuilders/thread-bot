import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const script = new URL('../scripts/deploy.sh', import.meta.url).pathname;
function run(mode) {
  const dir=mkdtempSync(join(tmpdir(),'thread-bot-deploy-test-'));
  try {
    const source=join(dir,'source'),app=join(dir,'app'),bin=join(dir,'bin'),log=join(dir,'commands');
    for(const p of [join(source,'src'),join(source,'test'),app,bin])mkdirSync(p,{recursive:true});
    writeFileSync(join(source,'src','bot.js'),'// fixture');
    writeFileSync(join(source,'compose.yaml'),'services: {}');
    writeFileSync(join(app,'compose.yaml'),'services: {}');
    writeFileSync(join(app,'.env'),'PRIVATE=preserved\n');
    writeFileSync(join(bin,'docker'),`#!/bin/bash
printf '%s\\n' "$*" >> "$COMMAND_LOG"
if [[ "$1" == build && "$TEST_MODE" == build_fail ]]; then exit 1; fi
if [[ "$1" == inspect ]]; then
  if [[ "$3" == *Health* ]]; then
    if [[ "$TEST_MODE" == health_fail ]]; then echo unhealthy; else echo healthy; fi
  else echo previous-image; fi
fi
`,{mode:0o755});
    const result=spawnSync('bash',[script,source,'fixture'],{env:{...process.env,PATH:bin+':'+process.env.PATH,APP_DIR:app,COMMAND_LOG:log,TEST_MODE:mode},encoding:'utf8'});
    return {status:result.status,commands:existsSync(log)?readFileSync(log,'utf8'):'',env:readFileSync(join(app,'.env'),'utf8'),promoted:existsSync(join(app,'.deployed-revision')),output:result.stdout+result.stderr};
  } finally {rmSync(dir,{recursive:true,force:true});}
}
test('healthy update promotes revision while preserving private configuration',()=>{
  const result=run('healthy');assert.equal(result.status,0,result.output);assert.equal(result.promoted,true);assert.equal(result.env,'PRIVATE=preserved\n');assert.match(result.commands,/tag thread-bot:fixture thread-bot:current/);
});
test('failed build leaves running bot untouched',()=>{
  const result=run('build_fail');assert.notEqual(result.status,0);assert.equal(result.promoted,false);assert.doesNotMatch(result.commands,/up -d/);
});
test('failed health check restores previous container',()=>{
  const result=run('health_fail');assert.notEqual(result.status,0);assert.equal(result.promoted,false);assert.match(result.output,/restoring previous image/);assert.equal((result.commands.match(/up -d --no-build --force-recreate/g)||[]).length,2);
});
