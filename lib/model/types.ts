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
  | 'empty-filter'
  /**
   * A rule that has not been given a name yet.
   *
   * Distinct from `invalid-header-name` because they are not the same event.
   * A typo is a *mistake* — the user typed something and it is wrong. An empty
   * name is *unfinished* — the popup creates rules empty on purpose, so this is
   * the state every rule is born in, and it clears the moment a name is typed.
   * Filing both under one kind meant a rule the user had not touched yet was
   * reported as broken the instant it appeared.
   */
  | 'incomplete-header'
  /**
   * Some of a profile's domains are usable and some are not, so the compiler
   * suppresses the whole profile. See lib/compile/suppression.ts for why it is
   * all-or-nothing rather than per-entry.
   */
  | 'invalid-domain';

export interface Diagnostic {
  kind: DiagnosticKind;
  /**
   * How to read this, and — for a rule — which of the not-live states it is in.
   *
   * - `error` — it is wrong, and nothing goes out for it.
   * - `warning` — it goes out; there is something worth knowing about it.
   * - `incomplete` — it is not finished, so there is nothing to send yet.
   *
   * `incomplete` is a **severity** and not merely a kind because the popup has
   * to tell these three apart to count them, and it classifies by field rather
   * than by a table of kinds. A kind table has to be edited every time
   * `DiagnosticKind` grows, and this union has now grown three times; a
   * severity that names the consequence keeps every consumer correct by
   * default when the next kind arrives.
   */
  severity: 'error' | 'warning' | 'incomplete';
  profileId: string;
  headerRuleId?: string;
  /**
   * The host this diagnostic is about, when it is about one. Set by
   * `permission-missing` so the Grant button knows what to request without
   * parsing the message — a message is copy, and copy changes.
   */
  host?: string;
  message: string;
}

export interface CompileResult {
  dynamic: DnrRule[];
  session: DnrRule[];
  diagnostics: Diagnostic[];
  requiredOrigins: string[];
}
