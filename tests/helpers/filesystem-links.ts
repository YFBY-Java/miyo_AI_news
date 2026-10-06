import fs from 'node:fs/promises';
import type { TestContext } from 'node:test';

// Windows junctions exercise realpath containment without requiring Developer Mode.
export async function createDirectoryLink(target: string, link: string) {
  await fs.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
}

export async function createFileLinkOrSkip(context: TestContext, target: string, link: string): Promise<boolean> {
  try {
    await fs.symlink(target, link, 'file');
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(code ?? '')) throw error;
    context.skip(`Windows denied file symbolic-link creation (${code}); enable Developer Mode or run with symlink permission to execute this specific containment scenario.`);
    return false;
  }
}
