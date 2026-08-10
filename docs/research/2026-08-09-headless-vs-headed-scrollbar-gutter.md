# 스크롤바 거터: headless 와 headed 가 다르다

2026-08-09. Chromium 151.0.7922.34 (playwright 1.62.0 동봉본), macOS 25.4.0.

## 왜 쟀나

이 저장소에는 이런 결론이 있었다 — `::-webkit-scrollbar` 로 스타일을 줘도 Chromium 은
오버레이 스크롤바에서 빠지지 않는다, 12px 폭에 빨간 썸을 준 상자가
`offsetWidth − clientWidth === 0` 이었고 정지 상태에서 아무것도 그리지 않았다.

그 결론은 headless 에서만 잰 것이었고, **그 사실이 어디에도 적혀 있지 않았다.**
`docs/superpowers/specs/2026-08-07-headerlab-design-system-design.md:135` 이 그것을
"대조 실험으로 반증됐다" 로 옮겨 적으면서 조건이 떨어져 나갔다.

## 무엇을 쟀나

순수 Chromium 페이지 — 확장도, 팝업도, 이 저장소의 스타일시트도 걸치지 않는다.
`overflow-y: auto` 인 200×100 상자 여덟 개를 (선언 4가지) × (넘침 / 안 넘침) 로 놓고
`offsetWidth − clientWidth` 를 읽는다. 같은 페이지를 `headless: true` 와 `false` 로
한 번씩 연다.

스크립트: 이 문서 끝에 있다.

## 결과

`offsetWidth − clientWidth`, **넘침 / 안 넘침**:

| | headless | headed |
|---|---|---|
| 아무것도 없음 | 0 / 0 | 0 / 0 |
| `scrollbar-gutter: stable` 만 | 0 / 0 | 0 / 0 |
| `::-webkit-scrollbar` 만 | **0 / 0** | **8 / 0** |
| 둘 다 | 8 / 8 | 8 / 8 |

## 읽는 법

**3행이 전부다.** 같은 CSS, 같은 빌드, 모드만 다른데 0 과 8 이다. 옛 결론은 틀린 게
아니라 **좁았다** — headless 라는 조건 안에서는 지금도 참이다. 사용자가 있는 headed
브라우저에서는 거짓이다.

`scrollbar-gutter: stable` 은 macOS 에서 단독으로는 아무것도 예약하지 않는다(2행).
오버레이 스크롤바는 자리를 차지하지 않으니 예약할 것이 없다는 뜻이고, 이건 양쪽 모드에서
같다. 스크롤바를 실제 막대로 만드는 것은 `::-webkit-scrollbar` 쪽이다.

**그래서 `scroll-list` 는 둘 다 켠다.** 4행이 양쪽 모드에서, 그리고 넘치든 안 넘치든
8 로 같은 유일한 줄이기 때문이다. "행이 밀리지 않는다" 를 모드와 무관하게 참으로
만드는 조합이 그것 하나다.

## 이 저장소에 대한 함의

**이 저장소의 e2e 는 전부 headless 다.** `tests/e2e/fixtures.ts` 는
`launchPersistentContext` 에 `headless` 를 넘기지 않고, playwright 의 기본이 headless 다.
따라서 e2e 로 잰 레이아웃 값은 사용자 화면의 값이라는 보장이 없다.

이번에 걸린 것이 스크롤바 거터였을 뿐이고, 교훈은 스크롤바에 대한 것이 아니다:
**측정한 조건을 숫자와 함께 적어라.** 조건이 떨어져 나간 숫자는 일반 사실로 읽히고,
다음 사람이 그걸 근거로 결정한다. 실제로 그렇게 됐다.

## 스크립트

```js
import { chromium } from '@playwright/test';

const PAGE = `<!doctype html><meta charset=utf-8>
<style>
  .box { width: 200px; height: 100px; overflow-y: auto; }
  .gutter { scrollbar-gutter: stable; }
  .wk::-webkit-scrollbar { width: 8px; }
  .wk::-webkit-scrollbar-track { background: transparent; }
  .wk::-webkit-scrollbar-thumb { background: red; border-radius: 999px; }
  .tall { height: 400px; }
  .short { height: 10px; }
</style>
<div id="a" class="box"><div class="tall"></div></div>
<div id="b" class="box"><div class="short"></div></div>
<div id="c" class="box gutter"><div class="tall"></div></div>
<div id="d" class="box gutter"><div class="short"></div></div>
<div id="e" class="box wk"><div class="tall"></div></div>
<div id="f" class="box wk"><div class="short"></div></div>
<div id="g" class="box gutter wk"><div class="tall"></div></div>
<div id="h" class="box gutter wk"><div class="short"></div></div>`;

const measure = () => {
  const g = (id) => {
    const el = document.getElementById(id);
    return el.offsetWidth - el.clientWidth;
  };
  return {
    nothing: [g('a'), g('b')],
    gutter: [g('c'), g('d')],
    webkit: [g('e'), g('f')],
    both: [g('g'), g('h')],
  };
};

for (const headless of [true, false]) {
  const browser = await chromium.launch({ channel: 'chromium', headless });
  const page = await browser.newPage();
  await page.setContent(PAGE);
  console.log(headless ? 'headless' : 'headed', await page.evaluate(measure));
  await browser.close();
}
```

원값:

```
headless {"nothing":[0,0],"gutter":[0,0],"webkit":[0,0],"both":[8,8]}
headed   {"nothing":[0,0],"gutter":[0,0],"webkit":[8,0],"both":[8,8]}
```
