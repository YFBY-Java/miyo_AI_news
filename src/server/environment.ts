import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';

export function loadProjectEnvironment(root: string, env: NodeJS.ProcessEnv = process.env) {
  for (const name of ['.env.local', '.env']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    for (const [key, value] of Object.entries(parse(fs.readFileSync(file)))) {
      if (env[key] === undefined) env[key] = value;
    }
  }
  return env;
}
