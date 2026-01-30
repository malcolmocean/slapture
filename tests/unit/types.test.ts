import { describe, it, expect } from 'vitest';
import type { Capture, Route, IntegrationConfig, TriggerChangeReview, FreedCaptureAction } from '../../src/types';

describe('OAuth Types', () => {
  it('should allow blocked_needs_auth execution result', () => {
    const capture: Partial<Capture> = {
      executionResult: 'blocked_needs_auth'
    };
    expect(capture.executionResult).toBe('blocked_needs_auth');
  });

  it('should allow blocked_auth_expired execution result', () => {
    const capture: Partial<Capture> = {
      executionResult: 'blocked_auth_expired'
    };
    expect(capture.executionResult).toBe('blocked_auth_expired');
  });

  it('should support intend destination type', () => {
    const route: Partial<Route> = {
      destinationType: 'intend',
      destinationConfig: {
        baseUrl: 'https://intend.do'
      }
    };
    expect(route.destinationType).toBe('intend');
  });

  it('should support integration config structure', () => {
    const config: IntegrationConfig = {
      intend: {
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        expiresAt: '2026-01-22T12:00:00Z',
        baseUrl: 'https://intend.do'
      }
    };
    expect(config.intend?.accessToken).toBe('test-token');
  });
});

describe('Tiered Regression Protection Types', () => {
  it('should support routingReviewQueued on Capture', () => {
    const capture: Partial<Capture> = {
      routingReviewQueued: true,
      suggestedReroute: 'route-fitness'
    };
    expect(capture.routingReviewQueued).toBe(true);
    expect(capture.suggestedReroute).toBe('route-fitness');
  });

  it('should support suggestedReroute being null', () => {
    const capture: Partial<Capture> = {
      routingReviewQueued: true,
      suggestedReroute: null
    };
    expect(capture.suggestedReroute).toBeNull();
  });

  it('should support TriggerChangeReview structure', () => {
    const review: TriggerChangeReview = {
      id: 'review-123',
      routeId: 'route-gwen',
      proposedTriggers: [{ type: 'regex', pattern: '^gwenmem', priority: 10 }],
      evolverReasoning: 'User now uses gwenmem prefix',
      createdAt: '2026-01-29T10:00:00Z',
      status: 'pending',
      affectedCaptures: [
        {
          captureId: 'cap-1',
          raw: 'log pushups to pushups.csv: 10',
          routedAt: '2026-01-15T10:00:00Z',
          recommendation: 'RE_ROUTE',
          suggestedReroute: 'route-fitness',
          reasoning: 'Contains pushups.csv, clearly fitness-related'
        },
        {
          captureId: 'cap-2',
          raw: 'gwen memories: first steps',
          routedAt: '2025-12-20T10:00:00Z',
          recommendation: 'LEAVE_AS_HISTORICAL',
          reasoning: 'Correct routing, just doesnt match new pattern'
        }
      ]
    };

    expect(review.status).toBe('pending');
    expect(review.affectedCaptures).toHaveLength(2);
    expect(review.affectedCaptures[0].recommendation).toBe('RE_ROUTE');
    expect(review.affectedCaptures[1].recommendation).toBe('LEAVE_AS_HISTORICAL');
  });

  it('should support all FreedCaptureAction values', () => {
    const actions: FreedCaptureAction[] = ['RE_ROUTE', 'MARK_FOR_REVIEW', 'LEAVE_AS_HISTORICAL'];
    expect(actions).toContain('RE_ROUTE');
    expect(actions).toContain('MARK_FOR_REVIEW');
    expect(actions).toContain('LEAVE_AS_HISTORICAL');
  });

  it('should support approved and rejected review statuses', () => {
    const approved: TriggerChangeReview = {
      id: 'review-1',
      routeId: 'route-1',
      proposedTriggers: [],
      evolverReasoning: 'test',
      createdAt: '2026-01-29T10:00:00Z',
      status: 'approved',
      affectedCaptures: []
    };

    const rejected: TriggerChangeReview = {
      ...approved,
      id: 'review-2',
      status: 'rejected'
    };

    expect(approved.status).toBe('approved');
    expect(rejected.status).toBe('rejected');
  });
});
