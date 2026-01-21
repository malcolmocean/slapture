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
    // If explicit route specified, look for exact match
    if (parsed.explicitRoute) {
      const route = this.routes.find(
        r => r.name.toLowerCase() === parsed.explicitRoute?.toLowerCase()
      );

      if (route) {
        return {
          routeId: route.id,
          confidence: 'high',
          reason: `Explicit route match: ${route.name}`,
        };
      }

      return {
        routeId: null,
        confidence: null,
        reason: `No route named "${parsed.explicitRoute}"`,
      };
    }

    // Collect all matching triggers with their routes
    const matches: Array<{ route: Route; trigger: Route['triggers'][0] }> = [];

    for (const route of this.routes) {
      for (const trigger of route.triggers) {
        if (this.triggerMatches(trigger, parsed.payload)) {
          matches.push({ route, trigger });
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

    return {
      routeId: best.route.id,
      confidence,
      reason: `Matched trigger: ${best.trigger.type}:${best.trigger.pattern}${
        matches.length > 1 ? ` (${matches.length} matches, using highest priority)` : ''
      }`,
    };
  }

  private triggerMatches(trigger: Route['triggers'][0], payload: string): boolean {
    switch (trigger.type) {
      case 'prefix':
        return payload.toLowerCase().startsWith(trigger.pattern.toLowerCase());

      case 'regex':
        try {
          const regex = new RegExp(trigger.pattern, 'i');
          return regex.test(payload);
        } catch {
          return false;
        }

      case 'keyword':
        return payload.toLowerCase().includes(trigger.pattern.toLowerCase());

      case 'semantic':
        // Semantic matching would require LLM - skip in dispatcher
        return false;

      default:
        return false;
    }
  }
}
