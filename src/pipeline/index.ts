// src/pipeline/index.ts
import { v4 as uuidv4 } from 'uuid';
import { Capture, Route, ExecutionStep, ParseResult, DispatchResult, RouteVersion } from '../types.js';
import { Storage } from '../storage/index.js';
import { Parser } from '../parser/index.js';
import { Dispatcher } from '../dispatcher/index.js';
import { RouteExecutor } from '../routes/executor.js';
import { Mastermind } from '../mastermind/index.js';
import { Evolver, EvolverContext } from '../mastermind/evolver.js';
import { createEvolverTestCase } from '../mastermind/evolver-ratchet.js';

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
  private codeVersion: string;

  constructor(
    storage: Storage,
    filestoreRoot: string,
    apiKey: string,
    codeVersion: string = 'dev'
  ) {
    this.storage = storage;
    this.parser = new Parser();
    this.dispatcher = new Dispatcher([]);
    this.executor = new RouteExecutor(filestoreRoot);
    this.mastermind = new Mastermind(apiKey);
    this.evolver = new Evolver(apiKey);
    this.codeVersion = codeVersion;
  }

  async process(raw: string, username: string): Promise<PipelineResult> {
    const capture: Capture = {
      id: uuidv4(),
      raw,
      timestamp: new Date().toISOString(),
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

      // If no route matched, consult Mastermind
      if (!route) {
        console.log(`[Pipeline] No route matched, consulting Mastermind for: "${raw}"`);
        const mastermindStart = Date.now();
        const { action, promptUsed } = await this.mastermind.consult(
          routes,
          raw,
          parsed,
          dispatchResult.reason
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
          capture.timestamp
        );
        this.addTrace(capture, 'execute', { route: route.id, payload: parsed.payload }, execResult, executeStart);

        if (execResult.success) {
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
}
