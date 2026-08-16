import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GROUPS as TABLE_GROUPS } from '../lib/commands.mjs';
import { suggest } from '../lib/suggest.mjs';

// 이 파일이 손으로 적은 후보들. 표(`lib/commands.mjs`)와 일부러 분리해
// 둔다 — 거리·문턱·동점 규칙은 표와 무관한 성질이고, 표가 바뀔 때마다
// 이 파일의 기대값이 흔들리면 재는 것이 규칙이 아니라 표가 된다. 표에
// 대한 주장은 맨 아래 `TABLE_GROUPS` 하나가 맡는다.
const GROUPS = ['bridge', 'site', 'rule', 'pause', 'resume', 'state'];

// 브리프 원문은 'sight' 를 썼지만, 이 파일의 손으로 짠 Wagner–Fischer
// distance() 로 측정하면 'sight' 와 'site' 는 거리 3 이다 (`node -e` 로
// 직접 계산해 확인: g,h 를 지우고 e 를 더하는 최소 3 단계) — 문턱 2 를
// 넘어 아예 제안되지 않는다. 't a b s' 처럼 갈아치우는 대신, "한 글자
// 차이" 라는 테스트 의도에 실제로 맞는 예로 바꾼다: 'ste' 는 'site' 에서
// 'i' 하나를 지운 것으로 거리 1 이다.
test('한 글자 차이를 잡는다', () => {
  assert.equal(suggest('ste', GROUPS), 'site');
  assert.equal(suggest('rul', GROUPS), 'rule');
});

test('너무 먼 것은 제안하지 않는다', () => {
  assert.equal(suggest('completely-different', GROUPS), null);
});

// 거리 2 이하라도 후보가 짧으면 우연의 일치다. 'site' 와 'rule' 은
// 거리 4 로 안전하지만, 'on' 과 'off' 같은 짧은 쌍에서 이 규칙이 일한다.
test('짧은 후보에는 40% 규칙이 걸린다', () => {
  assert.equal(suggest('xn', ['on', 'off']), null);
});

test('빈 입력에는 아무것도 제안하지 않는다', () => {
  assert.equal(suggest('', GROUPS), null);
});

test('정확히 일치하면 제안하지 않는다 — 제안할 오타가 없다', () => {
  assert.equal(suggest('site', GROUPS), null);
});

// 측정된 동점: `statu` 는 `state` 에서 한 글자를 바꾼 것이자 `status` 에서
// 한 글자를 뺀 것이라, 편집거리가 둘 다 1 이다. 배열 순서로 이기는
// 구현에서는 `commands.mjs` 의 줄 순서가 답을 정한다 — 표를 재배열한
// 사람은 자기가 오타 제안을 바꿨다는 것을 알 길이 없다.
//
// 그래서 동점은 **접두사**로 깬다: 친 글자가 후보의 시작과 그대로 겹치면
// 그 후보가 이긴다 (`statu` → `status`). 아래는 후보 순서를 뒤집어서도
// 같은 답을 요구하므로, 배열 순서에 기대는 구현은 둘 중 하나에서 반드시
// 빨개진다.
test('동점은 배열 순서가 아니라 접두사로 깬다', () => {
  assert.equal(suggest('statu', ['state', 'status']), 'status');
  assert.equal(suggest('statu', ['status', 'state']), 'status');
});

// 접두사가 관여하지 않는 동점은 여전히 첫 후보다 — 규칙이 하나 더 늘지
// 않았다는 것을 못박는다.
test('접두사가 없는 동점은 첫 후보 그대로다', () => {
  assert.equal(suggest('bare', ['bore', 'bard']), 'bore');
});

// 실제 표에서도 같아야 한다. 위의 `GROUPS` 는 이 파일이 손으로 적은
// 목록이라 표를 재배열해도 움직이지 않으므로, 표에서 **파생된** 목록으로
// 한 번 더 잰다.
//
// **양쪽 순서로 넣는 것이 이 테스트의 전부다.** 재 보면 `TABLE_GROUPS` 는
// `status` 를 첫 줄에 두고 있고(`COMMANDS` 의 읽기 넷이 맨 앞이다),
// 그 순서에서는 동점의 첫 후보가 이미 `status` 라 옛 구현("첫 개선을
// 유지한다")도 통과한다 — 즉 한쪽 순서만 재는 어서션은 접두사 규칙에 대해
// 아무것도 말하지 않는다. 뒤집으면 `state` 가 앞서므로(측정: 옛 구현이
// `state` 를 낸다) 그쪽이 규칙을 강제한다. 표의 줄 순서가 바뀌면 두 어서션이
// 역할을 맞바꿀 뿐, 규칙이 검사되지 않는 순서는 없다.
test('표에서 파생된 그룹 목록에서도, 줄 순서와 무관하게 statu 는 status 다', () => {
  assert.equal(suggest('statu', TABLE_GROUPS), 'status');
  assert.equal(suggest('statu', [...TABLE_GROUPS].reverse()), 'status');
});
