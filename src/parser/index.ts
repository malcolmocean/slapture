// src/parser/index.ts
import { ParseResult } from '../types.js';

export class Parser {
  parse(raw: string): ParseResult {
    const trimmed = raw.trim();

    // Extract parenthetical metadata
    let payload = trimmed;
    const metadata: Record<string, string> = {};

    // Extract (from X) pattern
    const fromMatch = payload.match(/\(from\s+([^)]+)\)/i);
    if (fromMatch) {
      metadata.source = fromMatch[1].trim();
      payload = payload.replace(fromMatch[0], '').trim();
    }

    // Extract other parentheticals as tags
    const tagMatches = payload.matchAll(/\(([^)]+)\)/g);
    const tags: string[] = [];
    for (const match of tagMatches) {
      if (!match[1].toLowerCase().startsWith('from ')) {
        tags.push(match[1].trim());
        payload = payload.replace(match[0], '').trim();
      }
    }
    if (tags.length > 0) {
      metadata.tags = tags.join(',');
    }

    // Clean up multiple spaces
    payload = payload.replace(/\s+/g, ' ').trim();

    // Detect implicit structure
    if (/^\w+\s+[\d.]+\s*(kg|lbs?|lb|g|oz|ml|l|cm|m|ft|in)?$/i.test(payload)) {
      metadata.detectedType = 'measurement';
    }

    return {
      payload,
      metadata,
    };
  }
}
