import { compile } from '@/lib/compile/compile';
import { isSuppressed, suppressionReason } from '@/lib/compile/suppression';
import { originsForFilter, scopingHosts } from '@/lib/permissions/origins';
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
  /**
   * Rule sets that exist in storage and are **not** described by any other
   * field here — their ids, so the CLI can say so.
   *
   * `resolveSingleProfile`'s docblock tells its caller to remove these from
   * storage, because compile() reads storage rather than the popup and a rule
   * set left behind goes on modifying headers with nothing able to show it.
   * This caller cannot honour that — a read command must not write — so it
   * does the only other honest thing and reports them. `state set --force`
   * can plant one without the popup ever being opened to truncate it.
   */
  dropped: string[];
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
  const { profile, dropped } = resolveSingleProfile(state.profiles);
  const compiled = compile(state);
  // 보고하는 프로필의 진단만 태운다 — 팝업이 하는 것과 같다 (App.tsx 의
  // `allDiagnostics.filter((d) => d.profileId === active.id)`). 전부를 태우면
  // `byHost`·`scope` 에 이 payload 의 `profile` 이 아무 말도 하지 않는 규칙
  // 세트의 오류가 섞여 들어가고, 기계로 받는 쪽은 그것을 누구의 문제인지
  // 물을 데가 없다. `render.mjs` 는 행(byRow)에 대해서만 이 사실을 알고
  // 프로필 id 로 키를 지어 피하고 있었다.
  const routed = routeDiagnostics(compiled.diagnostics.filter((d) => d.profileId === profile?.id));

  return {
    state,
    profile: profile ?? null,
    dropped: dropped.map((p) => p.id),
    // Map 을 쌍 배열로 편다. JSON.stringify(new Map()) 은 '{}' 이므로,
    // 지도를 그대로 실으면 소켓 건너편에서 조용히 빈 객체가 된다.
    diagnostics: {
      byRow: [...routed.byRow],
      byHost: [...routed.byHost],
      scope: routed.scope,
    },
    // 팝업이 세는 그 술어 그대로다 (App.tsx: `active.enabled &&
    // !state.globalPause && !isSuppressed(active)`). `!state.globalPause` 만
    // 넘기던 동안 세 항 중 둘이 빠져 있었고, 그래서 compile() 이 규칙을 하나도
    // 내지 않는 상태에 대해 `tally.live` 가 살아 있다고 셌다 — `render.mjs`
    // 가 그것을 "3 total, 3 on" 으로 찍으므로, 헤더가 실제로 고쳐지고 있는지에
    // 대한 거짓 문장이 사람에게 닿는다. 빈 화면 얘기가 아니다: `createProfile`
    // 은 새 규칙 세트를 **일부러** 스코프 없이 만들므로, 갓 설치한 확장에
    // `rule add` 를 `site add` 보다 먼저 치면 바로 이 상태다.
    //
    // 넷째 항인 `access` 는 여기서 답하지 않는다: 이 payload 는 동기적으로
    // 만들어지고 권한 조사(probe)는 비동기라, 답을 기다리려면 소켓 핸들러
    // 전체가 바뀌어야 한다. 비워 두면 "묻지 않았다" 는 뜻이지 "허가됐다" 는
    // 뜻이 아니므로(Access 의 docblock 참조), 권한 없는 호스트에 대해
    // `tally.live` 는 팝업이 고치기 전과 같은 값을 그대로 말한다 — CLAUDE.md
    // 의 Known gaps 가 이 갭을 기록한다.
    tally: profile
      ? ruleTally(profile.headers, profile.id, routed.byRow, {
          live: profile.enabled && !state.globalPause && !isSuppressed(profile),
        })
      : null,
    // `filter.domains` 가 아니라 `scopingHosts` 다. all-sites 는 저장된
    // 목록을 지우지 않고 컴파일만 안 하므로, 목록을 직접 읽으면 all-sites
    // 프로필을 좁은 것으로 오판한다.
    scopingHosts: profile ? scopingHosts(profile.filter) : [],
    suppression: profile ? suppressionReason(profile) : null,
    // 보고하는 프로필이 필요로 하는 것. `compiled.requiredOrigins` 는 모든
    // 프로필의 합집합이라, 화면에 없는 규칙 세트의 호스트까지 "이 프로필에
    // 필요하다" 고 말하게 된다. compile() 이 부르는 바로 그 함수를 부른다.
    requiredOrigins: profile?.enabled ? originsForFilter(profile.filter) : [],
    globalPause: state.globalPause,
  };
}
