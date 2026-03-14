declare module '@roam-research/roam-api-sdk' {
  interface GraphConfig {
    graph: string;
    token: string;
    httpClient?: unknown;
  }

  interface Graph {
    graph: string;
    api(path: string, method?: string, body?: unknown): Promise<Response>;
  }

  interface CreateBlockArgs {
    action: 'create-block';
    location: { 'parent-uid': string; order: 'last' | number };
    block: { string: string };
  }

  interface CreatePageArgs {
    action: 'create-page';
    page: { title: string };
  }

  export function initializeGraph(config: GraphConfig): Graph;
  export function q(graph: Graph, queryString: string, args?: unknown): Promise<unknown[][]>;
  export function pull(graph: Graph, selectorString: string, eidString: string): Promise<unknown>;
  export function createBlock(graph: Graph, args: CreateBlockArgs): Promise<boolean>;
  export function createPage(graph: Graph, args: CreatePageArgs): Promise<boolean>;
  export function deleteBlock(graph: Graph, args: unknown): Promise<boolean>;
  export function deletePage(graph: Graph, args: unknown): Promise<boolean>;
  export function moveBlock(graph: Graph, args: unknown): Promise<boolean>;
  export function updateBlock(graph: Graph, args: unknown): Promise<boolean>;
  export function updatePage(graph: Graph, args: unknown): Promise<boolean>;
  export function batchActions(graph: Graph, args: unknown): Promise<unknown>;
}
