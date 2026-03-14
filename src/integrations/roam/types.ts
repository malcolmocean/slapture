export interface Block {
  uid: string;
  string: string;
  order: number;
  children?: Block[];
}

export interface RoamDestinationConfig {
  graphName: string;
  operation: RoamOperation;
}

export type RoamOperation = DailyTaggedOperation | PageChildOperation;

export interface DailyTaggedOperation {
  type: 'daily_tagged';
  tag: string;
}

export interface PageChildOperation {
  type: 'page_child';
  pageTitle: string;
  parentBlockUid?: string;
}
