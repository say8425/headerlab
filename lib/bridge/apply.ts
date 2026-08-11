import { bootstrapProfile, newRule } from '@/lib/model/defaults';
import { effectiveDomain, isValidDomain } from '@/lib/permissions/origins';
import { parseAppState } from '@/lib/model/schema';
import { resolveSingleProfile } from '@/lib/view/singleProfile';
import type { ApplyResult, Command } from '@/lib/bridge/protocol';
import type { AppState, Profile } from '@/lib/model/types';

/**
 * 브리지 명령 하나를 상태 변경으로 바꾼다. 순수.
 *
 * **이 화면이 보여주는 하나의 규칙 세트에만 손댄다.** 저장소가 여럿을 들고
 * 있으면 `resolveSingleProfile` 이 고르는 첫 번째만 바꾸고 나머지는 건드리지
 * 않는다. 잘라내는 것은 팝업의 쓰기이고(App.tsx), 그 판단을 여기서 두 번째로
 * 구현하면 갈라진다.
 *
 * 저장소가 비어 있으면 팝업이 여는 것과 **같은** 암묵적 규칙 세트를 만든다 —
 * `bootstrapProfile()` 을 부르지, 그 모양을 다시 적지 않는다.
 */
/**
 * 손댈 규칙 세트와, 그것이 실제로 들어있는 상태를 함께 돌려준다.
 *
 * **게으르게 부른다.** `pause` 는 최상위 키만 건드리므로 이걸 부르면 안 된다 —
 * 부르면 빈 저장소에 아무도 요청하지 않은 규칙 세트가 생긴다. 규칙 세트를
 * 건드리는 case 안에서만 부른다.
 *
 * `minted` 는 이번 호출이 방금 `bootstrapProfile()` 을 불렀는지를 말한다.
 * `rule.add` 가 그 이름 없는 첫 규칙을 지울지 말지 판단하는 데 쓴다 — 기존
 * 규칙 세트가 우연히 빈 규칙 하나뿐인 경우와 갈라야 하므로 `active.headers`
 * 만 보고는 알 수 없다.
 */
function seed(state: AppState): { base: AppState; active: Profile; minted: boolean } {
  const { profile } = resolveSingleProfile(state.profiles);
  if (profile) return { base: state, active: profile, minted: false };
  const bootstrapped = bootstrapProfile();
  return { base: { ...state, profiles: [bootstrapped] }, active: bootstrapped, minted: true };
}

function replace(base: AppState, next: Profile, changed: boolean, note?: string): ApplyResult {
  return {
    ok: true,
    state: { ...base, profiles: base.profiles.map((p) => (p.id === next.id ? next : p)) },
    changed,
    ...(note === undefined ? {} : { note }),
  };
}

export function apply(state: AppState, command: Command): ApplyResult {
  switch (command.cmd) {
    case 'site.add': {
      const { base, active } = seed(state);
      const existing = new Set(active.filter.domains.map(effectiveDomain));
      const fresh: string[] = [];
      const already: string[] = [];
      // `effectiveDomain` hands back the input verbatim when nothing usable
      // could be salvaged from it (origins.ts). Storing it anyway is right —
      // the row is how the user sees and fixes the mistake — but storing it
      // *silently* is not: once stored, `suppressionReason` returns
      // 'unusable-site' and the whole profile stops compiling, every good
      // rule along with it. "Never suppress without saying so" applies here
      // exactly as it does to a filter with no usable domain at all.
      const unusable: string[] = [];
      for (const typed of command.domains) {
        const host = effectiveDomain(typed);
        if (existing.has(host)) {
          already.push(host);
          continue;
        }
        existing.add(host);
        fresh.push(host);
        if (!isValidDomain(host)) unusable.push(host);
      }
      const domains = [...active.filter.domains, ...fresh];
      const notes: string[] = [];
      if (already.length > 0) notes.push(`already listed: ${already.join(', ')}`);
      if (unusable.length > 0) {
        notes.push(
          `cannot scope anything and suppresses the whole rule set until fixed: ${unusable.join(', ')}`,
        );
      }
      const note = notes.length === 0 ? undefined : notes.join('; ');
      return replace(
        base,
        { ...active, filter: { ...active.filter, domains } },
        fresh.length > 0,
        note,
      );
    }

    case 'site.remove': {
      const { base, active } = seed(state);
      // 전부 있는지 먼저 확인하고, 하나라도 없으면 아무것도 지우지 않는다.
      // 부분 적용은 "무엇이 지워졌는지" 를 되물어야만 알 수 있게 만든다.
      const wanted = command.domains.map(effectiveDomain);
      const present = new Set(active.filter.domains.map(effectiveDomain));
      const missing = wanted.filter((host) => !present.has(host));
      if (missing.length > 0) {
        return {
          ok: false,
          error: { code: 'unknown-domain', message: `not in the site list: ${missing.join(', ')}` },
        };
      }
      const drop = new Set(wanted);
      const domains = active.filter.domains.filter((d) => !drop.has(effectiveDomain(d)));
      return replace(base, { ...active, filter: { ...active.filter, domains } }, true);
    }

    case 'site.allSites': {
      const { base, active } = seed(state);
      if (active.filter.allSites === command.on) return replace(base, active, false);
      // 목록은 남긴다. 그게 스위치를 되돌릴 수 있게 하는 것이고, 끄면 사용자가
      // 쌓아둔 스코프가 돌아온다.
      return replace(base, { ...active, filter: { ...active.filter, allSites: command.on } }, true);
    }

    case 'rule.add': {
      const { base, active, minted } = seed(state);
      // `remove` 는 값을 갖지 않는다(types.ts). 여기서 떨어뜨려, 저장되는
      // 모양이 늘 하나가 되게 한다 — 죽은 값이 의미 있는 것처럼 읽히는 일이
      // 없도록.
      const value = command.operation === 'remove' ? '' : command.value;
      const rule = {
        ...newRule(),
        target: command.target,
        operation: command.operation,
        name: command.name,
        value,
      };
      // `bootstrapProfile()` 은 이름도 값도 없는 규칙 하나를 함께 만든다. 방금
      // 그걸로 태어난 저장소에 이걸 그대로 둔 채 요청받은 규칙을 덧붙이면, 새
      // 설치에서 `rule add` 한 번이 규칙 둘 — 요청한 것과, 아무도 청하지 않고
      // 영원히 `incomplete-header` 로 남는 것 — 을 낳는다. `site.add` 가 빈
      // 저장소에 이미 갖고 있는 경계 처리와 같은 자리. `minted` 로 가른다 —
      // 기존 규칙 세트가 우연히 빈 규칙 하나뿐인 경우까지 덮어쓰면 안 된다.
      const blank =
        active.headers.length === 1 &&
        active.headers[0]!.name === '' &&
        active.headers[0]!.value === '';
      const headers = minted && blank ? [rule] : [...active.headers, rule];
      return replace(base, { ...active, headers }, true);
    }

    case 'rule.remove': {
      const { base, active } = seed(state);
      if (!active.headers.some((h) => h.id === command.id)) {
        return {
          ok: false,
          error: { code: 'unknown-rule', message: `no rule with id ${command.id}` },
        };
      }
      return replace(
        base,
        { ...active, headers: active.headers.filter((h) => h.id !== command.id) },
        true,
      );
    }

    case 'rule.toggle': {
      const { base, active } = seed(state);
      const current = active.headers.find((h) => h.id === command.id);
      if (!current) {
        return {
          ok: false,
          error: { code: 'unknown-rule', message: `no rule with id ${command.id}` },
        };
      }
      const next = command.on ?? !current.enabled;
      if (next === current.enabled) return replace(base, active, false);
      return replace(
        base,
        {
          ...active,
          headers: active.headers.map((h) => (h.id === command.id ? { ...h, enabled: next } : h)),
        },
        true,
      );
    }

    case 'pause':
    case 'resume': {
      const paused = command.cmd === 'pause';
      // `seeded` 가 아니라 `state`. 일시정지는 최상위 키이고, 그것 때문에
      // 규칙 세트가 생겨서는 안 된다.
      if (state.globalPause === paused) return { ok: true, state, changed: false };
      return { ok: true, state: { ...state, globalPause: paused }, changed: true };
    }

    case 'state.set': {
      try {
        // 검증을 통과하지 못한 저장소는 컴파일되지 않으므로 중화할 것도 없고,
        // 남의 바이트를 덮어쓸 근거도 없다. 거절하고 그대로 둔다.
        return { ok: true, state: parseAppState(command.state), changed: true };
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'invalid-state',
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }

    default: {
      // 위 아홉 case 가 `Command` 의 전부라서 타입 위에서는 여기 닿지 않는다 —
      // `command` 는 `never` 로 좁혀진다. 그래도 지우지 않는다: `parseCommand`
      // 를 거치지 않고 부른 호출이 타입을 우회해 들어오면 여기가 마지막
      // 방어선이다. 그 값을 읽으려면 좁혀진 타입을 다시 넓혀야 한다.
      // `never` 를 거쳐 넓히는 것이 요점이다. `command` 에서 곧장 캐스트하면
      // 열 번째 명령이 case 없이 추가돼도 그대로 컴파일되어, 빠진 case 가
      // 런타임 invalid-command 로 조용히 나간다. 측정된 차이다.
      const exhaustive: never = command;
      const unexpected = exhaustive as Command;
      return {
        ok: false,
        error: { code: 'invalid-command', message: `unhandled command: ${unexpected.cmd}` },
      };
    }
  }
}
