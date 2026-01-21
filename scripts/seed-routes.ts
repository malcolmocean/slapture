// scripts/seed-routes.ts
import { Storage } from '../src/storage/index.js';
import { Route } from '../src/types.js';

async function seed() {
  const storage = new Storage('./data');

  const routes: Route[] = [
    {
      id: 'route-dump',
      name: 'dump',
      description: 'Dump raw text to a file',
      triggers: [{ type: 'prefix', pattern: 'dump', priority: 10 }],
      schema: null,
      recentItems: [],
      destinationType: 'fs',
      destinationConfig: { filePath: 'dump.txt' },
      transformScript: "fs.appendFileSync(filePath, payload + '\\n')",
      createdAt: new Date().toISOString(),
      createdBy: 'user',
      lastUsed: null,
    },
    {
      id: 'route-note',
      name: 'note',
      description: 'Save notes to JSON file',
      triggers: [{ type: 'prefix', pattern: 'note', priority: 10 }],
      schema: null,
      recentItems: [],
      destinationType: 'fs',
      destinationConfig: { filePath: 'notes.json' },
      transformScript: `
        let data = {};
        if (fs.existsSync(filePath)) {
          data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
        data[timestamp] = payload;
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      `,
      createdAt: new Date().toISOString(),
      createdBy: 'user',
      lastUsed: null,
    },
  ];

  for (const route of routes) {
    await storage.saveRoute(route);
    console.log(`Created route: ${route.name}`);
  }

  // Create default config
  await storage.saveConfig({
    authToken: 'dev-token',
    requireApproval: false,
    approvalGuardPrompt: null,
    mastermindRetryAttempts: 3,
  });
  console.log('Created config');

  console.log('Seeding complete!');
}

seed().catch(console.error);
