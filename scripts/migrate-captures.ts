#!/usr/bin/env npx tsx
// scripts/migrate-captures.ts
// Migrates captures to full ISO timestamp format: captures/:username/:isotimestamp_:uuid.json
// Handles both flat format and old date-only format

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

function formatTimestamp(timestamp: string): string {
  // Convert 2026-01-22T14:56:54.098Z to 2026-01-22T14-56-54-098Z
  return timestamp.replace(/:/g, '-').replace(/\./g, '-');
}

function migrate() {
  console.log('Starting capture migration to full ISO timestamp format...');

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

  // Step 1: Migrate flat files (legacy format: uuid.json)
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const oldPath = path.join(CAPTURES_DIR, entry.name);

    try {
      const content = fs.readFileSync(oldPath, 'utf-8');
      const capture: Capture = JSON.parse(content);

      const safeTimestamp = formatTimestamp(capture.timestamp);
      const newFilename = `${safeTimestamp}_${capture.id}.json`;
      const newPath = path.join(defaultDir, newFilename);

      if (fs.existsSync(newPath)) {
        console.log(`  Skipping ${entry.name} (already migrated)`);
        skipped++;
        continue;
      }

      fs.renameSync(oldPath, newPath);
      console.log(`  Migrated: ${entry.name} → ${DEFAULT_USER}/${newFilename}`);
      migrated++;
    } catch (err) {
      console.error(`  Error migrating ${entry.name}:`, err);
    }
  }

  // Step 2: Migrate files in user directories with old date-only format
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const userDir = path.join(CAPTURES_DIR, entry.name);
    const userFiles = fs.readdirSync(userDir).filter(f => f.endsWith('.json'));

    for (const filename of userFiles) {
      // Check if it's old format: YYYY-MM-DD_uuid.json (not full timestamp)
      // Old format: 2026-01-22_uuid.json (10 chars before _)
      // New format: 2026-01-22T14-56-54-098Z_uuid.json (24 chars before _)
      const underscoreIdx = filename.indexOf('_');
      if (underscoreIdx === 10) {
        // Old date-only format, needs migration
        const oldPath = path.join(userDir, filename);

        try {
          const content = fs.readFileSync(oldPath, 'utf-8');
          const capture: Capture = JSON.parse(content);

          const safeTimestamp = formatTimestamp(capture.timestamp);
          const newFilename = `${safeTimestamp}_${capture.id}.json`;
          const newPath = path.join(userDir, newFilename);

          if (oldPath === newPath) {
            skipped++;
            continue;
          }

          if (fs.existsSync(newPath)) {
            console.log(`  Skipping ${filename} (already migrated)`);
            // Remove the old file since new one exists
            fs.unlinkSync(oldPath);
            skipped++;
            continue;
          }

          fs.renameSync(oldPath, newPath);
          console.log(`  Migrated: ${entry.name}/${filename} → ${newFilename}`);
          migrated++;
        } catch (err) {
          console.error(`  Error migrating ${entry.name}/${filename}:`, err);
        }
      } else {
        skipped++;
      }
    }
  }

  console.log(`\nMigration complete: ${migrated} migrated, ${skipped} skipped`);
}

migrate();
