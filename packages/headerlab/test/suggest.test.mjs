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
