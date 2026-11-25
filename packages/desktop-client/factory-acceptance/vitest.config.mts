import { posix } from 'node:path';

import { defineConfig } from 'vite';

import webConfig from '../vite.config.mts';

const workspacePrefix = 'packages/desktop-client/';
const acceptancePrefix = `${workspacePrefix}factory-acceptance/`;

export default defineConfig(async environment => {
  const files = process.env.FACTORY_ACCEPTANCE_FILES?.split('\n') ?? [];
  if (
    files.length === 0 ||
    files.some(
      file =>
        !file.startsWith(acceptancePrefix) ||
        file.endsWith('/') ||
        !/^[\w./-]+$/.test(file) ||
        posix.normalize(file) !== file,
    )
  ) {
    throw new Error(
      'Pass approved file paths in the acceptance folder to run.sh.',
    );
  }

  const config = await webConfig(environment);
  return {
    ...config,
    test: {
      ...config.test,
      include: files.map(file => file.slice(workspacePrefix.length)),
    },
  };
});
