// ---------- domain ----------

export type Operation = 'set' | 'append' | 'remove';
export type HeaderTarget = 'request' | 'response';

export type ResourceType =
  | 'main_frame' | 'sub_frame' | 'stylesheet' | 'script' | 'image'
  | 'font' | 'object' | 'xmlhttprequest' | 'ping' | 'csp_report'
  | 'media' | 'websocket' | 'webtransport' | 'webbundle' | 'other';

export type RequestMethod =
  | 'connect' | 'delete' | 'get' | 'head' | 'options'
  | 'patch' | 'post' | 'put' | 'other';

export type ProfileColor = 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'cyan';

export interface HeaderRule {
  id: string;
  enabled: boolean;
  target: HeaderTarget;
  operation: Operation;
  name: string;
  /** Empty string when operation is 'remove'. The compiler drops the field entirely. */
  value: string;
  comment?: string;
}

export interface Filter {
  mode: 'structured' | 'regex';
  domains: string[];
  excludedDomains: string[];
  pathPattern?: string;
  regex?: string;
  /** Never empty. DNR rejects empty arrays and its default silently excludes main_frame. */
  resourceTypes: ResourceType[];
  requestMethods?: RequestMethod[];
}

export interface TabLock {
  enabled: boolean;
  tabId: number | null;
  tabTitle: string | null;
}

export interface Profile {
  id: string;
  name: string;
  color: ProfileColor;
  enabled: boolean;
  order: number;
  filter: Filter;
  tabLock: TabLock;
  headers: HeaderRule[];
}

export interface AppState {
  version: number;
  profiles: Profile[];
  globalPause: boolean;
  theme: 'system' | 'light' | 'dark';
}

/**
 * Bounds two undocumented behaviours at once: whether a rule id may be reused
 * across the dynamic and session rulesets, and the (undocumented) upper bound
 * of `priority`. See spec §4.6.
 */
export const MAX_PROFILES = 200;

// ---------- DNR output shapes ----------

export interface ModifyHeaderInfo {
  header: string;
  operation: Operation;
  /** Absent for 'remove'. Required for 'set' and 'append'. */
  value?: string;
}

export interface DnrRuleCondition {
  urlFilter?: string;
  regexFilter?: string;
  requestDomains?: string[];
  excludedRequestDomains?: string[];
  resourceTypes: ResourceType[];
  requestMethods?: RequestMethod[];
  /** Session-scoped rules only. */
  tabIds?: number[];
}

export interface DnrRule {
  id: number;
  priority: number;
  condition: DnrRuleCondition;
  action: {
    type: 'modifyHeaders';
    requestHeaders?: ModifyHeaderInfo[];
    responseHeaders?: ModifyHeaderInfo[];
  };
}

// ---------- compiler output ----------

export type DiagnosticKind =
  | 'append-not-allowed'
  | 'invalid-header-name'
  | 'duplicate-header'
  | 'regex-unsupported'
  | 'profile-conflict'
  | 'permission-missing'
  | 'tab-lock-stale'
  | 'empty-filter';

export interface Diagnostic {
  kind: DiagnosticKind;
  severity: 'error' | 'warning';
  profileId: string;
  headerRuleId?: string;
  message: string;
}

export interface CompileResult {
  dynamic: DnrRule[];
  session: DnrRule[];
  diagnostics: Diagnostic[];
  requiredOrigins: string[];
}
