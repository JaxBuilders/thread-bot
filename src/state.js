import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
export class StateStore {
  constructor(path) {
    this.path = path;
    try { this.data = JSON.parse(readFileSync(path, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('State file could not be read; refusing to reset progress'); this.data = { channels: {} }; }
    if (!this.data.channels || typeof this.data.channels !== 'object') throw new Error('Invalid state file');
  }
  save() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(`${this.path}.tmp`, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(`${this.path}.tmp`, this.path);
  }
}
