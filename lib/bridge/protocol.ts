import { z } from 'zod';
import type { AppState } from '@/lib/model/types';

/**
 * 브리지가 받는 명령의 모양.
 *
 * 읽기 명령(`state get`, `status`, `diagnostics`)은 여기 없다. 그것들은
 * 상태를 바꾸지 않으므로 `compile()` 과 `ruleTally()` 를 그대로 부르면 되고,
 * 리듀서를 통과할 이유가 없다. 이 스키마는 **쓰기**의 목록이다.
 *
 * 판별자가 `cmd` 인 discriminated union 인 이유: 알 수 없는 명령이
 * "필드가 하나도 안 맞는 union" 이 아니라 "그런 cmd 는 없다" 로 실패해야
 * CLI 가 사람에게 읽을 만한 말을 돌려줄 수 있다.
 */
export const commandSchema = z.discriminatedUnion('cmd', [
  z.object({ cmd: z.literal('site.add'), domains: z.array(z.string().min(1)).min(1) }),
  z.object({ cmd: z.literal('site.remove'), domains: z.array(z.string().min(1)).min(1) }),
  z.object({ cmd: z.literal('site.allSites'), on: z.boolean() }),
  z.object({
    cmd: z.literal('rule.add'),
    target: z.enum(['request', 'response']),
    operation: z.enum(['set', 'append', 'remove']),
    // `.min(1)` 이 없는 게 일부러다 — `id`·`domains` 등 다른 필드들과 다르게
    // 보이지만, 이 저장소에서 규칙은 이름 없이 태어나는 게 정상이다
    // (defaults.ts 의 `newRule`). `incomplete-header` 가 `invalid-header-name`
    // 과 별개의 진단으로 존재하는 이유가 그것이고, 팝업이 매번 만드는 빈
    // 규칙을 이 스키마가 거절하면 안 된다.
    name: z.string(),
    // `remove` 는 값을 갖지 않는다(types.ts). 생략을 허용하되 빈 문자열로
    // 정규화해, 저장되는 모양이 늘 하나가 되게 한다.
    value: z.string().default(''),
  }),
  z.object({ cmd: z.literal('rule.remove'), id: z.string().min(1) }),
  // `on` 생략은 "뒤집어라". 요구하면 CLI 가 토글마다 먼저 읽어야 한다.
  z.object({ cmd: z.literal('rule.toggle'), id: z.string().min(1), on: z.boolean().optional() }),
  z.object({ cmd: z.literal('pause') }),
  z.object({ cmd: z.literal('resume') }),
  // 페이로드는 일부러 검사하지 않는다. `appStateSchema` 로 거르는 것은
  // apply() 의 몫이고, 그래야 나쁜 페이로드가 파싱 throw 가 아니라 구조화된
  // `invalid-state` 로 돌아온다 — 타이핑한 사람은 세 프로세스 건너에 있다.
  z.object({ cmd: z.literal('state.set'), state: z.unknown() }),
]);

export type Command = z.infer<typeof commandSchema>;

/** 실패 시 throw. 신뢰 경계에서 부른다. */
export function parseCommand(input: unknown): Command {
  return commandSchema.parse(input);
}

export type ApplyErrorCode =
  | 'invalid-command'
  | 'invalid-state'
  | 'unknown-rule'
  | 'unknown-domain';

export interface ApplyError {
  code: ApplyErrorCode;
  message: string;
}

/**
 * `changed` 는 `ok` 와 다른 사실이다.
 *
 * 이미 있는 사이트를 다시 더하는 것은 실패가 아니다 — 요청한 상태가 이미
 * 참이다. 하지만 아무 일도 안 일어났다는 것은 말해져야 한다. 팝업의
 * AddSiteField 가 `{added:false, alreadyThere}` 를 돌려주는 것과 같은 구분이고,
 * 같은 구분이어야 한다.
 */
export type ApplyResult =
  | { ok: true; state: AppState; changed: boolean; note?: string }
  | { ok: false; error: ApplyError };
