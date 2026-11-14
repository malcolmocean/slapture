// src/dispatcher/index.ts
import { Route, ParseResult, DispatchResult } from '../types.js';

export class Dispatcher {
  private routes: Route[];

  constructor(routes: Route[]) {
    this.routes = routes;
  }

  updateRoutes(routes: Route[]): void {
    this.routes = routes;
  }

  dispatch(parsed: ParseResult): DispatchResult {
    // Collect all matching triggers with their routes
    const matchTarget = parsed.payload;
    const matches: Array<{ route: Route; trigger: Route['triggers'][0]; match: RegExpMatchArray }> = [];

    for (const route of this.routes) {
      for (const trigger of route.triggers) {
        const match = this.triggerMatch(trigger, matchTarget);
        if (match) {
          matches.push({ route, trigger, match });
        }
      }
    }

    if (matches.length === 0) {
      return {
        routeId: null,
        confidence: null,
        reason: 'No matching triggers found',
      };
    }

    // Sort by priority (highest first)
    matches.sort((a, b) => b.trigger.priority - a.trigger.priority);

    const best = matches[0];
    const confidence = matches.length === 1 ? 'medium' : 'low';

    // Extract named fields if trigger defines captures
    let extractedFields: Record<string, string> | undefined;
    if (best.trigger.captures) {
      extractedFields = {};
      for (const [fieldName, groupIndex] of Object.entries(best.trigger.captures)) {
        const value = best.match[groupIndex];
        if (value !== undefined) {
          extractedFields[fieldName] = value;
        }
      }
    }

    return {
      routeId: best.route.id,
      confidence,
      reason: `Matched trigger: ${best.trigger.type}:${best.trigger.pattern}${
        matches.length > 1 ? ` (${matches.length} matches, using highest priority)` : ''
      }`,
      matchedTrigger: best.trigger,
      extractedFields,
    };
  }

  private triggerMatch(trigger: Route['triggers'][0], payload: string): RegExpMatchArray | null {
    if (trigger.type !== 'regex') {
      return null;
    }

    try {
      const regex = new RegExp(trigger.pattern, 'i');
      return payload.match(regex);
    } catch {
      return null;
    }
  }
}
