// src/pipeline/index.ts
import { v4 as uuidv4 } from 'uuid';
import { Capture, Route, ExecutionStep, ParseResult, DispatchResult, RouteVersion, RouteTrigger, getTriggerStatus, getTriggerStats, ValidationConfidence } from '../types.js';
import { Storage } from '../storage/index.js';
import { Parser } from '../parser/index.js';
import { Dispatcher } from '../dispatcher/index.js';
import { RouteExecutor } from '../routes/executor.js';
import { Mastermind, IntegrationContext } from '../mastermind/index.js';
import { Evolver, EvolverContext } from '../mastermind/evolver.js';
import { createEvolverTestCase } from '../mastermind/evolver-ratchet.js';
import { getIntegrationsWithStatus, INTEGRATIONS } from '../integrations/registry.js';
import { Validator } from '../validation/index.js';
import { RouteHygiene, HygieneSignal } from '../hygiene/index.js';

export interface PipelineResult {
  capture: Capture;
  needsClarification?: string;
}

export class CapturePipeline {
  private storage: Storage;
  private parser: Parser;
  private dispatcher: Dispatcher;
  private executor: RouteExecutor;
  private mastermind: Mastermind;
  private evolver: Evolver;
  private validator: Validator;
  private hygiene: RouteHygiene;
  private codeVersion: string;

  constructor(
    storage: Storage,
    filestoreRoot: string,
    apiKey: string = '',
    codeVersion: string = 'dev'
  ) {
    this.storage = storage;
    this.parser = new Parser();
    this.dispatcher = new Dispatcher([]);
    this.executor = new RouteExecutor(filestoreRoot, storage);
    this.mastermind = new Mastermind(apiKey);
    this.evolver = new Evolver(apiKey);
    this.validator = new Validator(apiKey);
    this.hygiene = new RouteHygiene(storage);
    this.codeVersion = codeVersion;
  }

  async process(raw: string, username: string): Promise<PipelineResult> {
    const capture: Capture = {
      id: uuidv4(),
      raw,
      timestamp: new Date().toISOString(),
      username,
      parsed: null,
      routeProposed: null,
      routeConfidence: null,
      routeFinal: null,
      executionTrace: [],
      executionResult: 'pending',
      verificationState: 'pending',
      retiredFromTests: false,
      retiredReason: null,
    };

    try {
      // Load routes and update dispatcher
      const routes = await this.storage.listRoutes();
      this.dispatcher.updateRoutes(routes);

      // Step 1: Parse
      const parseStart = Date.now();
      const parsed = this.parser.parse(raw);
      capture.parsed = parsed;
      this.addTrace(capture, 'parse', raw, parsed, parseStart);

      // Step 2: Dispatch
      const dispatchStart = Date.now();
      const dispatchResult = this.dispatcher.dispatch(parsed);
      capture.routeProposed = dispatchResult.routeId;
      capture.routeConfidence = dispatchResult.confidence;
      this.addTrace(capture, 'dispatch', parsed, dispatchResult, dispatchStart);

      // Step 3: Handle dispatch result
      let route: Route | null = null;

      if (dispatchResult.routeId) {
        route = await this.storage.getRoute(dispatchResult.routeId);
      }

      // Step 3a: LLM Validation (if trigger-matched route with validation enabled)
      if (route && dispatchResult.matchedTrigger) {
        const trigger = dispatchResult.matchedTrigger;
        const triggerStatus = getTriggerStatus(trigger);

        // Draft triggers don't auto-execute - send to Mastermind with context
        if (triggerStatus === 'draft') {
          console.log(`[Pipeline] Draft trigger matched, consulting Mastermind: ${trigger.pattern}`);
          // Increment fire count for draft graduation tracking
          await this.updateTriggerFireCount(route, trigger);
          // Fall through to Mastermind below (set route to null)
          route = null;
        }
        // Live triggers with validation enabled get validated
        else if (route.validation?.enabled) {
          const validationStart = Date.now();
          const { result: validationResult, promptUsed } = await this.validator.validate({
            route,
            matchedTrigger: trigger,
            input: parsed.payload,
          });

          this.addTrace(capture, 'route_validate', {
            routeId: route.id,
            trigger: trigger.pattern,
            input: parsed.payload,
          }, {
            confidence: validationResult.confidence,
            reasoning: validationResult.reasoning,
            promptUsed,
          }, validationStart);

          // Update trigger stats with validation result
          await this.updateTriggerStats(route, trigger, validationResult.confidence);

          // Handle validation result
          const action = Validator.getAction(validationResult.confidence);
          console.log(`[Pipeline] Validation: ${validationResult.confidence} -> ${action}`);

          if (action === 'execute') {
            // Continue to execution (route stays set)
          } else if (action === 'execute_flagged') {
            // Execute but mark as needing review
            capture.verificationState = 'ai_uncertain';
          } else if (action === 'mastermind') {
            // Send to Mastermind for decision
            route = null;
          } else if (action === 'mastermind_hygiene') {
            // Send to Mastermind AND record hygiene signal
            await this.hygiene.recordValidationSignal(
              route,
              trigger,
              capture.id,
              parsed.payload,
              validationResult.confidence as 'doubtful' | 'reject',
              validationResult.reasoning
            );
            route = null;
          }

        }
      }

      // If no route matched (or validation rejected), consult Mastermind
      if (!route) {
        console.log(`[Pipeline] No route matched, consulting Mastermind for: "${raw}"`);
        const mastermindStart = Date.now();

        // Gather integration context for the Mastermind
        const integrationContext = await this.gatherIntegrationContext(username, routes);

        const { action, promptUsed } = await this.mastermind.consult(
          routes,
          raw,
          parsed,
          dispatchResult.reason,
          integrationContext
        );
        // Store both the dynamic input context and the full prompt for retroactive replay
        // Include full route snapshots as shown to the LLM (name, description, triggers, recent items)
        this.addTrace(capture, 'mastermind', {
          dynamicInput: {
            raw,
            parsed,
            dispatcherReason: dispatchResult.reason,
            routesSnapshot: routes.map(r => ({
              id: r.id,
              name: r.name,
              description: r.description,
              triggers: r.triggers,
              recentItems: r.recentItems.slice(0, 3),  // matches buildPrompt limit
            })),
          },
          staticPrompt: promptUsed,
        }, action, mastermindStart);
        console.log(`[Pipeline] Mastermind action: ${action.action}`, action.routeId || action.route?.name || '');

        if (action.action === 'route' && action.routeId) {
          // Mastermind returns route name, not ID - try both lookups
          route = await this.storage.getRoute(action.routeId)
            || await this.storage.getRouteByName(action.routeId);
          console.log(`[Pipeline] Resolved route: ${route?.id || 'NOT FOUND'}`);

          // Evolver fires when Mastermind routes to existing
          if (route) {
            const evolvedRoute = await this.tryEvolveRoute(capture, route, raw, action.reason, routes);
            if (evolvedRoute) {
              route = evolvedRoute;
              // Update dispatcher with evolved route
              this.dispatcher.updateRoutes(routes.map(r => r.id === route!.id ? route! : r));
            }
          }
        } else if (action.action === 'create' && action.route) {
          // Create new route
          const newRoute: Route = {
            ...action.route,
            id: `route-${uuidv4()}`,
            createdAt: new Date().toISOString(),
            lastUsed: null,
            recentItems: [],
          };
          await this.storage.saveRoute(newRoute);
          route = newRoute;

          // Update dispatcher with new route
          this.dispatcher.updateRoutes([...routes, newRoute]);
        } else if (action.action === 'clarify') {
          capture.executionResult = 'pending';
          capture.verificationState = 'pending';
          await this.storage.saveCapture(capture, username);
          return { capture, needsClarification: action.question };
        } else {
          // Send to inbox
          await this.storage.appendToInbox(`${capture.id}: ${raw} - ${action.reason}`);
          capture.executionResult = 'rejected';
          capture.verificationState = 'ai_uncertain';
          await this.storage.saveCapture(capture, username);
          return { capture };
        }
      }

      // Step 4: Execute
      if (route) {
        const executeStart = Date.now();
        const execResult = await this.executor.execute(
          route,
          parsed.payload,
          username,
          parsed.metadata,
          capture.timestamp,
          capture
        );
        this.addTrace(capture, 'execute', { route: route.id, payload: parsed.payload }, execResult, executeStart);

        // Handle blocked states (OAuth required)
        if (execResult.status === 'blocked_needs_auth' || execResult.status === 'blocked_auth_expired') {
          capture.routeFinal = route.id;
          capture.executionResult = execResult.status;
          capture.verificationState = 'pending';
          console.log(`[Pipeline] Execution blocked: ${execResult.status} - ${execResult.error}`);
        } else if (execResult.success) {
          capture.routeFinal = route.id;
          capture.executionResult = 'success';
          capture.verificationState = capture.routeConfidence === 'high' ? 'ai_certain' : 'ai_uncertain';

          // Update route's lastUsed and recentItems
          route.lastUsed = capture.timestamp;
          route.recentItems = [
            { captureId: capture.id, raw, timestamp: capture.timestamp, wasCorrect: true },
            ...route.recentItems.slice(0, 4),
          ];
          await this.storage.saveRoute(route);
        } else {
          capture.executionResult = 'failed';
          capture.verificationState = 'failed';
        }
      }

      await this.storage.saveCapture(capture, username);
      return { capture };

    } catch (error) {
      capture.executionResult = 'failed';
      capture.verificationState = 'failed';
      this.addTrace(capture, 'execute', {}, { error: String(error) }, Date.now());
      await this.storage.saveCapture(capture, username);
      return { capture };
    }
  }

  private addTrace(
    capture: Capture,
    step: ExecutionStep['step'],
    input: unknown,
    output: unknown,
    startTime: number
  ): void {
    capture.executionTrace.push({
      step,
      timestamp: new Date().toISOString(),
      input,
      output,
      codeVersion: this.codeVersion,
      durationMs: Date.now() - startTime,
    });
  }

  /**
   * Update trigger fire count (for draft matcher graduation tracking).
   */
  private async updateTriggerFireCount(route: Route, trigger: RouteTrigger): Promise<void> {
    const triggerIndex = route.triggers.findIndex(t => t.pattern === trigger.pattern);
    if (triggerIndex === -1) return;

    route.triggers[triggerIndex] = {
      ...route.triggers[triggerIndex],
      fireCount: (route.triggers[triggerIndex].fireCount ?? 0) + 1,
      stats: {
        ...getTriggerStats(route.triggers[triggerIndex]),
        totalFires: (getTriggerStats(route.triggers[triggerIndex]).totalFires) + 1,
        lastFired: new Date().toISOString(),
      },
    };

    await this.storage.saveRoute(route);
  }

  /**
   * Update trigger stats with validation result.
   */
  private async updateTriggerStats(route: Route, trigger: RouteTrigger, confidence: ValidationConfidence): Promise<void> {
    const triggerIndex = route.triggers.findIndex(t => t.pattern === trigger.pattern);
    if (triggerIndex === -1) return;

    const currentStats = getTriggerStats(route.triggers[triggerIndex]);
    route.triggers[triggerIndex] = {
      ...route.triggers[triggerIndex],
      fireCount: (route.triggers[triggerIndex].fireCount ?? 0) + 1,
      stats: {
        ...currentStats,
        totalFires: currentStats.totalFires + 1,
        lastFired: new Date().toISOString(),
        validationResults: {
          ...currentStats.validationResults,
          [confidence]: (currentStats.validationResults[confidence] || 0) + 1,
        },
      },
    };

    await this.storage.saveRoute(route);
  }

  /**
   * Gather integration context for the Mastermind prompt.
   * This provides information about available integrations and user notes.
   */
  private async gatherIntegrationContext(
    username: string,
    routes: Route[]
  ): Promise<IntegrationContext> {
    // Get integrations with their current auth status
    const integrations = await getIntegrationsWithStatus(this.storage, username);

    // Gather integration notes
    const integrationNotes = new Map<string, string>();
    for (const integration of INTEGRATIONS) {
      const note = await this.storage.getIntegrationNote(username, integration.id);
      if (note) {
        integrationNotes.set(integration.id, note);
      }
    }

    // Gather destination notes (keyed by route name)
    const destinationNotes = new Map<string, string>();
    for (const route of routes) {
      const note = await this.storage.getDestinationNote(username, route.name);
      if (note) {
        destinationNotes.set(route.name, note);
      }
    }

    return {
      integrations,
      integrationNotes,
      destinationNotes,
    };
  }

  /**
   * Try to evolve a route's triggers/transform to handle a new input variation.
   * Returns the updated route if evolution succeeded, null otherwise.
   */
  private async tryEvolveRoute(
    capture: Capture,
    route: Route,
    newInput: string,
    mastermindReason: string,
    allRoutes: Route[]
  ): Promise<Route | null> {
    const MAX_RETRIES = 3;
    let context: EvolverContext = {
      newInput,
      route,
      mastermindReason,
    };

    const allCaptures = await this.storage.listAllCaptures();
    const evolverStart = Date.now();

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      console.log(`[Pipeline] Evolver attempt ${attempt}/${MAX_RETRIES} for route ${route.name}`);

      const { result, promptUsed } = await this.evolver.evolve(context);
      console.log(`[Pipeline] Evolver result: ${result.action} - ${result.reasoning}`);

      if (result.action === 'skipped') {
        // Add trace for skipped evolution
        // Include full route snapshot as shown to the LLM
        this.addTrace(capture, 'evolve', {
          dynamicInput: {
            newInput,
            mastermindReason,
            attempt,
            routeSnapshot: {
              id: route.id,
              name: route.name,
              description: route.description,
              triggers: route.triggers,
              transformScript: route.transformScript,
              recentItems: route.recentItems.slice(0, 5),  // matches buildPrompt limit
            },
            validationFailure: context.validationFailure,
          },
          staticPrompt: promptUsed,
        }, { ...result, validationPassed: null, retriesUsed: attempt }, evolverStart);
        console.log(`[Pipeline] Evolver skipped evolution: ${result.reasoning}`);

        // Auto-save test case for ratcheting system
        await this.saveEvolverTestCase(route, newInput, mastermindReason, promptUsed, result);

        return null;
      }

      if (result.action === 'failed') {
        // Add trace for failed evolution
        // Include full route snapshot as shown to the LLM
        this.addTrace(capture, 'evolve', {
          dynamicInput: {
            newInput,
            mastermindReason,
            attempt,
            routeSnapshot: {
              id: route.id,
              name: route.name,
              description: route.description,
              triggers: route.triggers,
              transformScript: route.transformScript,
              recentItems: route.recentItems.slice(0, 5),  // matches buildPrompt limit
            },
            validationFailure: context.validationFailure,
          },
          staticPrompt: promptUsed,
        }, { ...result, validationPassed: null, retriesUsed: attempt }, evolverStart);
        console.log(`[Pipeline] Evolver failed: ${result.reasoning}`);

        // Auto-save test case for ratcheting system
        await this.saveEvolverTestCase(route, newInput, mastermindReason, promptUsed, result);

        return null;
      }

      // Validate proposed changes
      const proposedTriggers = result.triggers || route.triggers;
      const validation = this.evolver.validateChanges(
        proposedTriggers,
        route.id,
        allCaptures,
        allRoutes
      );

      if (validation.passed) {
        // Apply changes
        const updatedRoute = this.applyEvolution(route, result, newInput);
        await this.storage.saveRoute(updatedRoute);
        // Add trace for successful evolution
        // Include full route snapshot as shown to the LLM (BEFORE evolution was applied)
        this.addTrace(capture, 'evolve', {
          dynamicInput: {
            newInput,
            mastermindReason,
            attempt,
            routeSnapshot: {
              id: route.id,
              name: route.name,
              description: route.description,
              triggers: route.triggers,
              transformScript: route.transformScript,
              recentItems: route.recentItems.slice(0, 5),  // matches buildPrompt limit
            },
            validationFailure: context.validationFailure,
          },
          staticPrompt: promptUsed,
        }, { ...result, validationPassed: true, retriesUsed: attempt }, evolverStart);
        console.log(`[Pipeline] Evolution applied to route ${route.name}`);

        // Auto-save test case for ratcheting system (evolved = ratchet case)
        await this.saveEvolverTestCase(route, newInput, mastermindReason, promptUsed, result);

        return updatedRoute;
      }

      // Validation failed - prepare retry context
      console.log(`[Pipeline] Validation failed: ${validation.errors.join(', ')}`);

      context = {
        ...context,
        validationFailure: {
          errors: validation.errors,
          // Add other routes' triggers on 2nd+ retry
          otherRoutesTriggers: attempt >= 2
            ? allRoutes
                .filter(r => r.id !== route.id)
                .map(r => ({ routeName: r.name, triggers: r.triggers }))
            : undefined,
        },
      };
    }

    // All retries exhausted - add trace
    // Include full route snapshot as shown to the LLM
    this.addTrace(capture, 'evolve', {
      dynamicInput: {
        newInput,
        mastermindReason,
        attempt: MAX_RETRIES,
        routeSnapshot: {
          id: route.id,
          name: route.name,
          description: route.description,
          triggers: route.triggers,
          transformScript: route.transformScript,
          recentItems: route.recentItems.slice(0, 5),  // matches buildPrompt limit
        },
        validationFailure: context.validationFailure,
      },
      staticPrompt: '(see previous attempts)',
    }, { action: 'failed', reasoning: 'All retries exhausted', validationPassed: false, retriesUsed: MAX_RETRIES }, evolverStart);
    console.log(`[Pipeline] Evolver exhausted all retries for route ${route.name}`);
    return null;
  }

  /**
   * Apply evolution result to a route, preserving version history
   */
  private applyEvolution(
    route: Route,
    result: { triggers?: import('../types.js').RouteTrigger[]; transform?: string; reasoning: string },
    evolvedFrom: string
  ): Route {
    // Create version entry for current state
    const currentVersion: RouteVersion = {
      version: (route.versions?.length || 0) + 1,
      timestamp: route.lastUsed || route.createdAt,
      triggers: route.triggers,
      transformScript: route.transformScript,
      reason: route.versions?.length
        ? `Before evolution from: ${evolvedFrom}`
        : 'Initial creation',
    };

    // Build updated route
    return {
      ...route,
      triggers: result.triggers || route.triggers,
      transformScript: result.transform !== undefined ? result.transform : route.transformScript,
      versions: [
        ...(route.versions || []),
        currentVersion,
        {
          version: currentVersion.version + 1,
          timestamp: new Date().toISOString(),
          triggers: result.triggers || route.triggers,
          transformScript: result.transform !== undefined ? result.transform : route.transformScript,
          reason: result.reasoning,
          evolvedFrom,
        },
      ],
    };
  }

  /**
   * Save evolver test case for the ratcheting system.
   * Auto-saves after each evolver call, then prunes old non-ratchet cases.
   */
  private async saveEvolverTestCase(
    route: Route,
    newInput: string,
    mastermindReason: string,
    promptUsed: string,
    result: import('../types.js').EvolverResult
  ): Promise<void> {
    const testCase = createEvolverTestCase(
      { newInput, route, mastermindReason, promptUsed },
      result
    );
    await this.storage.saveEvolverTestCase(testCase);
    // Prune to keep only last 5 non-ratchet cases
    await this.storage.pruneEvolverTestCases(5);
  }

  /**
   * Retry a previously blocked capture (e.g., after OAuth is configured).
   * Uses the capture's stored username for all operations.
   */
  async retryCapture(capture: Capture): Promise<{ capture: Capture }> {
    const username = capture.username;

    // Re-execute with existing route
    const route = await this.storage.getRoute(capture.routeFinal!);
    if (!route) {
      capture.executionResult = 'failed';
      capture.executionTrace.push({
        step: 'execute',
        timestamp: new Date().toISOString(),
        input: { retryAttempt: true },
        output: { error: 'Route no longer exists' },
        codeVersion: this.codeVersion,
        durationMs: 0
      });
      await this.storage.saveCapture(capture, username);
      return { capture };
    }

    const startTime = Date.now();
    const result = await this.executor.execute(
      route,
      capture.parsed?.payload || capture.raw,
      username,
      capture.parsed?.metadata || {},
      capture.timestamp,
      capture
    );

    // Map the result status to execution result
    if (result.status === 'blocked_needs_auth' || result.status === 'blocked_auth_expired') {
      capture.executionResult = result.status;
    } else if (result.success) {
      capture.executionResult = 'success';
    } else {
      capture.executionResult = 'failed';
    }

    capture.executionTrace.push({
      step: 'execute',
      timestamp: new Date().toISOString(),
      input: { route: route.id, payload: capture.parsed?.payload, retryAttempt: true },
      output: result,
      codeVersion: this.codeVersion,
      durationMs: Date.now() - startTime
    });

    await this.storage.saveCapture(capture, username);

    if (result.success) {
      // Update route's recentItems
      route.recentItems = [
        { captureId: capture.id, raw: capture.raw, timestamp: capture.timestamp, wasCorrect: true },
        ...route.recentItems.slice(0, 4)
      ];
      route.lastUsed = capture.timestamp;
      await this.storage.saveRoute(route);
    }

    return { capture };
  }
}
