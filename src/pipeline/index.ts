// src/pipeline/index.ts
import { v4 as uuidv4 } from 'uuid';
import { Capture, Route, ExecutionStep, ParseResult, DispatchResult } from '../types.js';
import { Storage } from '../storage/index.js';
import { Parser } from '../parser/index.js';
import { Dispatcher } from '../dispatcher/index.js';
import { RouteExecutor } from '../routes/executor.js';
import { Mastermind } from '../mastermind/index.js';

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
        const mastermindStart = Date.now();
        const action = await this.mastermind.consult(
          routes,
          raw,
          parsed,
          dispatchResult.reason
        );
        this.addTrace(capture, 'mastermind', { raw, parsed, reason: dispatchResult.reason }, action, mastermindStart);

        if (action.action === 'route' && action.routeId) {
          route = await this.storage.getRoute(action.routeId);
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
          await this.storage.saveCapture(capture);
          return { capture, needsClarification: action.question };
        } else {
          // Send to inbox
          await this.storage.appendToInbox(`${capture.id}: ${raw} - ${action.reason}`);
          capture.executionResult = 'rejected';
          capture.verificationState = 'ai_uncertain';
          await this.storage.saveCapture(capture);
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

      await this.storage.saveCapture(capture);
      return { capture };

    } catch (error) {
      capture.executionResult = 'failed';
      capture.verificationState = 'failed';
      this.addTrace(capture, 'execute', {}, { error: String(error) }, Date.now());
      await this.storage.saveCapture(capture);
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
}
