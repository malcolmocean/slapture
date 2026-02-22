// src/hygiene/index.ts
//
// Route hygiene signal handling for Phase 4.
// Triggered when validation returns doubtful/reject, or when user corrects a route.

import {
  Route,
  RouteTrigger,
  ValidationConfidence,
  getTriggerStats,
} from '../types.js';
import type { StorageInterface } from '../storage/interface.js';

/**
 * A hygiene signal that indicates a route or trigger may need review.
 */
export interface HygieneSignal {
  id: string;
  timestamp: string;
  routeId: string;
  routeName: string;
  triggerPattern: string | null;  // null if signal is about the route itself
  signalType: 'validation_doubtful' | 'validation_reject' | 'user_correction' | 'mastermind_manual_route';
  captureId: string;
  input: string;
  details: string;
}

/**
 * Computed hygiene statistics for a route's triggers.
 */
export interface TriggerHygieneStats {
  pattern: string;
  status: 'draft' | 'live';
  totalFires: number;
  lastFired: string | null;
  validationDistribution: Record<ValidationConfidence, number>;
  rejectRate: number;  // (doubtful + reject) / totalFires
  isStale: boolean;    // hasn't fired in a long time
  isRedundant: boolean; // always fires with another trigger
}

export interface RouteHygieneReport {
  routeId: string;
  routeName: string;
  triggerStats: TriggerHygieneStats[];
  recentSignals: HygieneSignal[];
  recommendations: string[];
}

export class RouteHygiene {
  private storage: StorageInterface;

  constructor(storage: StorageInterface) {
    this.storage = storage;
  }

  /**
   * Record a hygiene signal for later analysis.
   */
  async recordSignal(signal: Omit<HygieneSignal, 'id' | 'timestamp'>): Promise<HygieneSignal> {
    const fullSignal: HygieneSignal = {
      ...signal,
      id: `hygiene-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
    };

    await this.storage.appendHygieneSignal(fullSignal);
    console.log(`[Hygiene] Recorded signal: ${fullSignal.signalType} for route ${fullSignal.routeName}`);

    return fullSignal;
  }

  /**
   * Record a validation-based hygiene signal (doubtful or reject).
   */
  async recordValidationSignal(
    route: Route,
    trigger: RouteTrigger,
    captureId: string,
    input: string,
    confidence: 'doubtful' | 'reject',
    reasoning: string
  ): Promise<HygieneSignal> {
    return this.recordSignal({
      routeId: route.id,
      routeName: route.name,
      triggerPattern: trigger.pattern,
      signalType: confidence === 'reject' ? 'validation_reject' : 'validation_doubtful',
      captureId,
      input,
      details: reasoning,
    });
  }

  /**
   * Record a user correction signal.
   */
  async recordUserCorrection(
    route: Route,
    captureId: string,
    input: string,
    correctionDetails: string
  ): Promise<HygieneSignal> {
    return this.recordSignal({
      routeId: route.id,
      routeName: route.name,
      triggerPattern: null,
      signalType: 'user_correction',
      captureId,
      input,
      details: correctionDetails,
    });
  }

  /**
   * Compute hygiene statistics for a route.
   */
  computeRouteStats(route: Route, signals: HygieneSignal[]): RouteHygieneReport {
    const routeSignals = signals.filter(s => s.routeId === route.id);
    const recommendations: string[] = [];

    const triggerStats: TriggerHygieneStats[] = route.triggers.map(trigger => {
      const stats = getTriggerStats(trigger);
      const totalValidations = Object.values(stats.validationResults).reduce((a, b) => a + b, 0);
      const negativeCount = (stats.validationResults.doubtful || 0) + (stats.validationResults.reject || 0);
      const rejectRate = totalValidations > 0 ? negativeCount / totalValidations : 0;

      // Check for staleness (no fires in last 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const isStale = stats.lastFired === null || stats.lastFired < thirtyDaysAgo;

      return {
        pattern: trigger.pattern,
        status: trigger.status ?? 'live',
        totalFires: stats.totalFires,
        lastFired: stats.lastFired,
        validationDistribution: stats.validationResults,
        rejectRate,
        isStale,
        isRedundant: false, // Would need cross-trigger analysis to determine
      };
    });

    // Generate recommendations
    for (const ts of triggerStats) {
      if (ts.rejectRate > 0.3 && ts.totalFires >= 5) {
        recommendations.push(
          `Trigger /${ts.pattern}/ has a ${(ts.rejectRate * 100).toFixed(0)}% rejection rate - consider making it more specific`
        );
      }

      if (ts.isStale && ts.status === 'live') {
        recommendations.push(
          `Trigger /${ts.pattern}/ hasn't fired in 30+ days - may be redundant or overly specific`
        );
      }

      if (ts.totalFires === 0 && ts.status === 'live') {
        recommendations.push(
          `Trigger /${ts.pattern}/ has never fired - consider removing or adjusting`
        );
      }
    }

    return {
      routeId: route.id,
      routeName: route.name,
      triggerStats,
      recentSignals: routeSignals.slice(0, 10),
      recommendations,
    };
  }

  /**
   * Get all routes that have recent hygiene signals.
   */
  async getRoutesNeedingReview(routes: Route[]): Promise<RouteHygieneReport[]> {
    const signals = await this.storage.getHygieneSignals();
    const recentSignals = signals.filter(s => {
      const age = Date.now() - new Date(s.timestamp).getTime();
      return age < 7 * 24 * 60 * 60 * 1000; // Last 7 days
    });

    const routeIdsWithSignals = new Set(recentSignals.map(s => s.routeId));
    const routesNeedingReview = routes.filter(r => routeIdsWithSignals.has(r.id));

    return routesNeedingReview.map(route => this.computeRouteStats(route, signals));
  }
}
