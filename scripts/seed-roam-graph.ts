// tmp/seed-roam-graph.ts
// Seeds the test Roam graph with realistic data for integration tests.

import dotenv from 'dotenv';
import { initializeGraph, q, createPage, createBlock } from '@roam-research/roam-api-sdk';

dotenv.config();

const graphName = process.env.ROAM_TEST_GRAPH_NAME;
const token = process.env.ROAM_TEST_GRAPH_TOKEN;

if (!graphName || !token) {
  console.error('Missing ROAM_TEST_GRAPH_NAME or ROAM_TEST_GRAPH_TOKEN env vars');
  process.exit(1);
}

const graph = initializeGraph({ graph: graphName, token });

async function findPageUid(title: string): Promise<string | null> {
  const results = await q(
    graph,
    '[:find ?uid :in $ ?title :where [?p :node/title ?title] [?p :block/uid ?uid]]',
    [title],
  );
  if (results.length === 0) return null;
  return (results as string[][])[0][0];
}

async function ensurePage(title: string): Promise<string> {
  const existing = await findPageUid(title);
  if (existing) {
    console.log(`  Page "${title}" already exists (uid: ${existing})`);
    return existing;
  }

  await createPage(graph, { action: 'create-page', page: { title } });
  // Give Roam a moment to index the page
  await new Promise((r) => setTimeout(r, 1000));

  const uid = await findPageUid(title);
  if (!uid) throw new Error(`Failed to create page "${title}"`);
  console.log(`  Created page "${title}" (uid: ${uid})`);
  return uid;
}

async function addBlock(parentUid: string, text: string): Promise<void> {
  await createBlock(graph, {
    action: 'create-block',
    location: { 'parent-uid': parentUid, order: 'last' },
    block: { string: text },
  });
  console.log(`    Added block: "${text}"`);
}

function todayUid(): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const year = now.getUTCFullYear();
  return `${month}-${day}-${year}`;
}

async function seed() {
  console.log(`Seeding Roam graph: ${graphName}\n`);

  // 1. Create pages
  const pages = ['movie recs', 'book list', 'project ideas', 'bodylog', 'quotes'];
  const pageUids: Record<string, string> = {};

  for (const title of pages) {
    pageUids[title] = await ensurePage(title);
  }

  // 2. Add blocks to 'movie recs'
  console.log('\nAdding blocks to "movie recs":');
  await addBlock(pageUids['movie recs'], '[[Terminator 2]] - recommended by [[Bob]]');
  await addBlock(pageUids['movie recs'], '[[Inception]] - saw on a flight');

  // 3. Add blocks to 'bodylog'
  console.log('\nAdding blocks to "bodylog":');
  await addBlock(pageUids['bodylog'], 'weight: 185.5 lbs');
  await addBlock(pageUids['bodylog'], 'ran 5k in 28 min');

  // 4. Create today's daily page and add a #movie-recs tag block
  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const now = new Date();
  const todayTitle = `${MONTHS[now.getUTCMonth()]} ${now.getUTCDate()}, ${now.getUTCFullYear()}`;
  const todayPageUid = todayUid();

  let dailyPageUid: string;
  try {
    dailyPageUid = await ensurePage(todayTitle);
  } catch {
    console.log('  (daily page may already exist)');
    dailyPageUid = todayPageUid; // fallback
  }

  console.log(`Adding #movie-recs block on today's page (uid: ${dailyPageUid}):`);
  try {
    await addBlock(dailyPageUid, '#movie-recs [[The Matrix]] - classic');
  } catch (err) {
    console.warn(`  Warning: Could not add block to today's page: ${err}`);
  }

  console.log('\nSeeding complete!');
}

seed().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
