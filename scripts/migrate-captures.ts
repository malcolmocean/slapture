#!/usr/bin/env npx tsx
// scripts/migrate-captures.ts
// Migrates existing captures from flat format to captures/:username/:isodate_:uuid.json

import fs from 'fs';
import path from 'path';

const DATA_DIR = './data';
const CAPTURES_DIR = path.join(DATA_DIR, 'captures');
const DEFAULT_USER = 'default';

interface Capture {
  id: string;
  timestamp: string;
  [key: string]: unknown;
}

function migrate() {
  console.log('Starting capture migration...');

  if (!fs.existsSync(CAPTURES_DIR)) {
    console.log('No captures directory found.');
    return;
  }

  // Create default user directory
  const defaultDir = path.join(CAPTURES_DIR, DEFAULT_USER);
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }

  const entries = fs.readdirSync(CAPTURES_DIR, { withFileTypes: true });
  let migrated = 0;
  let skipped = 0;

  for (const entry of entries) {
    // Only process flat .json files (not directories)
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const oldPath = path.join(CAPTURES_DIR, entry.name);

    try {
      const content = fs.readFileSync(oldPath, 'utf-8');
      const capture: Capture = JSON.parse(content);

      // Format new filename: YYYY-MM-DD_uuid.json
      const isoDate = capture.timestamp.split('T')[0];
      const newFilename = `${isoDate}_${capture.id}.json`;
      const newPath = path.join(defaultDir, newFilename);

      if (fs.existsSync(newPath)) {
        console.log(`  Skipping ${entry.name} (already migrated)`);
        skipped++;
        continue;
      }

      // Move file to new location
      fs.renameSync(oldPath, newPath);
      console.log(`  Migrated: ${entry.name} → ${DEFAULT_USER}/${newFilename}`);
      migrated++;
    } catch (err) {
      console.error(`  Error migrating ${entry.name}:`, err);
    }
  }

  console.log(`\nMigration complete: ${migrated} migrated, ${skipped} skipped`);
}

migrate();
