import { bootstrapProfile, newRule } from '@/lib/model/defaults';
import { effectiveDomain } from '@/lib/permissions/origins';
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
 */
function seed(state: AppState): { base: AppState; active: Profile } {
  const { profile } = resolveSingleProfile(state.profiles);
  if (profile) return { base: state, active: profile };
  const minted = bootstrapProfile();
  return { base: { ...state, profiles: [minted] }, active: minted };
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
      for (const typed of command.domains) {
        const host = effectiveDomain(typed);
        if (existing.has(host)) {
          already.push(host);
          continue;
        }
        existing.add(host);
        fresh.push(host);
      }
      const domains = [...active.filter.domains, ...fresh];
      const note = already.length === 0 ? undefined : `already listed: ${already.join(', ')}`;
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
      const { base, active } = seed(state);
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
      return replace(base, { ...active, headers: [...active.headers, rule] }, true);
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

    default:
      return {
        ok: false,
        error: { code: 'invalid-command', message: `unhandled command: ${command.cmd}` },
      };
  }
}
