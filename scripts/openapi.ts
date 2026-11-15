import { writeFile } from 'node:fs/promises';
import { createApp } from '../src/app';
async function main() {
  const { app, document } = await createApp(false);
  try {
    await writeFile('openapi.json', JSON.stringify(document, null, 2) + '\n');
  } finally {
    await app.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
