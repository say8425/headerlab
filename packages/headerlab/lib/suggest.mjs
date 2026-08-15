/**
 * 오타 제안. clig.dev Help §10 — "사용자가 뭘 하려 했는지 짐작할 수 있으면
 * 고쳐서 제안하라."
 *
 * 손으로 짠 이유는 하나다: 이 패키지의 런타임 의존성은 0 이고, 그 0 이
 * 광고 문구이자 이 프로젝트가 존재하는 이유(숨은 트래커로 내려간 확장의
 * 대체재)와 직결된다. 20줄짜리 편집거리 하나를 위해 그걸 깨지 않는다.
 */

function distance(a, b) {
  // Wagner–Fischer. 한 줄만 들고 간다 — 후보가 열댓 개고 이름이 짧다.
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * 가장 가까운 후보 하나, 또는 null.
 *
 * 문턱이 둘인 이유: 절대 거리 2 만 쓰면 짧은 이름끼리 우연히 걸린다
 * (`on` 과 `off` 는 거리 2 다). 후보 길이의 40% 도 함께 넘어야 제안한다.
 * 정확히 일치하는 입력에는 제안하지 않는다 — 그건 오타가 아니다.
 *
 * **동점은 후보 배열의 순서로 깨지 않는다.** 측정된 예가 하나 있다:
 * `statu` 는 `state` 에서 한 글자를 바꾼 것이자 `status` 에서 한 글자를
 * 뺀 것이라 거리가 둘 다 1 이고, `d < bestDistance` 만 보는 구현에서는
 * `commands.mjs` 의 줄 순서가 답을 정했다 — 표를 재배열한 사람이 오타
 * 제안을 바꿨다는 것을 알 길이 없다. 동점에서는 **친 글자로 시작하는**
 * 후보를 고른다: 사람이 이름을 끝까지 안 친 쪽이 글자를 잘못 친 쪽보다
 * 흔하다. 그래도 남는 동점만 첫 후보다.
 */
export function suggest(input, candidates) {
  if (input.length === 0) return null;
  if (candidates.includes(input)) return null;

  let tied = [];
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const d = distance(input, candidate);
    if (d < bestDistance) {
      bestDistance = d;
      tied = [candidate];
    } else if (d === bestDistance) {
      tied.push(candidate);
    }
  }
  const best = tied.find((candidate) => candidate.startsWith(input)) ?? tied[0] ?? null;
  if (best === null) return null;
  if (bestDistance > 2) return null;
  if (bestDistance > Math.floor(best.length * 0.4)) return null;
  return best;
}
