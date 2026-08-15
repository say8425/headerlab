import assert from 'node:assert/strict';
import { test } from 'node:test';
import { suggest } from '../lib/suggest.mjs';

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

// 실제 그룹 목록에서도 같아야 한다. GROUPS 는 표에서 파생되므로 이
// 테스트가 표의 줄 순서로부터 오타 제안을 떼어 놓는다.
test('실제 그룹 목록에서도 statu 는 status 다', () => {
  assert.equal(suggest('statu', [...GROUPS, 'status']), 'status');
});
