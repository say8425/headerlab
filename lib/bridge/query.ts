import { compile } from '@/lib/compile/compile';
import { suppressionReason } from '@/lib/compile/suppression';
import { scopingHosts } from '@/lib/permissions/origins';
import { resolveSingleProfile } from '@/lib/view/singleProfile';
import { routeDiagnostics, ruleTally } from '@/lib/view/rules';
import type { SuppressionReason } from '@/lib/compile/suppression';
import type { AppState, Diagnostic, Profile } from '@/lib/model/types';
import type { RuleTally } from '@/lib/view/rules';

/**
 * 읽기 쿼리의 답을 만든다. **순수** — `chrome.*` 를 부르지 않고 I/O 를
 * 하지 않으며 입력을 바꾸지 않는다.
 *
 * 어떤 판단도 다시 구현하지 않는다. 팝업이 화면을 그릴 때 쓰는 바로 그
 * 함수들(`compile`·`routeDiagnostics`·`ruleTally`·`resolveSingleProfile`·
 * `scopingHosts`·`suppressionReason`)만 부른다 — CLI 와 팝업이 같은 사실을
 * 두 방식으로 계산하기 시작하면 갈라지고, 그것이 이 저장소에서 가장 비쌌던
 * 결함의 모양이다.
 *
 * **purity 가드(`purity.test.ts`)의 손목록에 이 파일이 이름으로 들어 있어야
 * 한다.** `lib/bridge/` 에는 디렉터리 규칙이 없다 — 같은 디렉터리의
 * `port.ts` 가 어댑터라 규칙을 걸 수 없기 때문이다.
 */
export interface StatusPayload {
  state: AppState;
  profile: Profile | null;
  diagnostics: {
    byRow: [string, Diagnostic[]][];
    byHost: [string, Diagnostic[]][];
    scope: Diagnostic[];
  };
  tally: RuleTally | null;
  scopingHosts: string[];
  suppression: SuppressionReason | null;
  requiredOrigins: string[];
  globalPause: boolean;
}

export function status(state: AppState): StatusPayload {
  const { profile } = resolveSingleProfile(state.profiles);
  const compiled = compile(state);
  const routed = routeDiagnostics(compiled.diagnostics);

  return {
    state,
    profile: profile ?? null,
    // Map 을 쌍 배열로 편다. JSON.stringify(new Map()) 은 '{}' 이므로,
    // 지도를 그대로 실으면 소켓 건너편에서 조용히 빈 객체가 된다.
    diagnostics: {
      byRow: [...routed.byRow],
      byHost: [...routed.byHost],
      scope: routed.scope,
    },
    tally: profile
      ? ruleTally(profile.headers, profile.id, routed.byRow, { live: !state.globalPause })
      : null,
    // `filter.domains` 가 아니라 `scopingHosts` 다. all-sites 는 저장된
    // 목록을 지우지 않고 컴파일만 안 하므로, 목록을 직접 읽으면 all-sites
    // 프로필을 좁은 것으로 오판한다.
    scopingHosts: profile ? scopingHosts(profile.filter) : [],
    suppression: profile ? suppressionReason(profile) : null,
    requiredOrigins: compiled.requiredOrigins,
    globalPause: state.globalPause,
  };
}
