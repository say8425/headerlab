# Detailed description — 한국어 (`ko`)

Paste the block below into **Store listing → Description**, with the language
dropdown set to Korean. It is plain text: the store keeps line breaks and
renders nothing else, so the bullets and headings are literal characters.

```text
HeaderLab 은 Chrome 자체의 declarativeNetRequest 엔진을 써서, 직접 고른 사이트에서 HTTP 요청·응답 헤더를 설정·추가·삭제합니다.

설치 시점에는 아무것도 요구하지 않습니다. 매니페스트가 요청하는 권한은 "storage" 와 "declarativeNetRequestWithHostAccess", 정확히 두 개뿐이며 호스트 접근 권한은 전혀 없습니다. 사이트는 그 이름이 적힌 행에서 Grant 버튼을 누른 뒤에야 수정할 수 있으며, 그 권한은 Chrome 에서 언제든 회수할 수 있습니다.

무엇을 하는가

• 어떤 헤더든 요청 쪽이든 응답 쪽이든 설정·추가·삭제합니다.
• 사이트 단위로 범위를 정합니다. 사이트는 호스트로 매칭되므로 포트나 경로는 사이트를 추가할 때 떨어져 나갑니다 — 팝업에 보이는 것이 실제로 회선에 나가는 것입니다.
• '모든 사이트에 적용'은 빈 사이트 목록이 아니라 명시적인 모드입니다. 이 모드는 모든 사이트에 대한 접근 권한을 요구하지만 스위치 자체는 그것을 요청하지 않습니다. 요청은 별도의 Grant 버튼이 하고, 누르기 전까지 그 행이 그렇다고 말합니다.
• 요청 타입으로 거릅니다. Chrome 의 리소스 타입 여덟 개를 각각 체크박스로 켜고 끕니다. main_frame 은 기본으로 켜져 있는데, Chrome 자체의 기본값이 그것을 조용히 빼놓기 때문입니다.
• 스위치 하나로 전체를 일시정지합니다. 툴바 아이콘도 그에 맞춰 회색으로 바뀌고, 브라우저를 다시 켠 뒤에도 회색 그대로입니다.
• OS 의 라이트·다크 설정을 따르며, 첫 페인트 전에 결정됩니다.

조용한 실패 없음

룰이 나가지 못하게 막는 것은 무엇이든 그 룰 자신의 행에서 말하고, Rules 제목 옆에서 셉니다 — 없는 권한, 쓸 수 없는 호스트명, Chrome 이 거절할 헤더 이름.

이 집계는 스스로를 부풀리지 않습니다. 아직 허용하지 않은 호스트에만 범위가 잡힌 룰은 절대 동작 중으로 세지 않고 막힌 것으로 세며, 아직 기다리고 있는 호스트가 그 옆에 적힙니다.

이건 들리는 것보다 중요합니다. Chrome 은 룰셋을 룰 단위가 아니라 통째로 받아들이거나 거절하므로, 잘못된 행 하나가 나머지 행 전부가 적용되지 못하게 막을 수 있습니다. HeaderLab 은 그 행을 짚어 주고 대신 무엇을 해야 하는지 말합니다.

무엇을 하지 않는가

• 네트워크 호출 없음. 분석도, 텔레메트리도, 원격 설정도, 업데이트 핑도 없습니다.
• 콘텐츠 스크립트 없음. 어떤 페이지에도 아무것도 주입하지 않으며, 확장이 페이지의 내용을 건네받는 일도 없습니다.
• 원격 코드 없음. 패키지 바깥에서 무언가를 받아 오거나 실행하지 않습니다.
• 외부 리소스 없음. CDN 도, 웹폰트도, 원격 이미지도 없습니다.
• 기기 밖으로 나가는 것 없음. 룰은 Chrome 자체의 확장 저장소에 보관됩니다.

소스가 공개되어 있으므로 위의 어느 것도 그냥 믿을 필요가 없습니다. 직접 확인할 수 있습니다:
https://github.com/say8425/headerlab

선택 사항: 터미널에서 조작하기

별도의 명령줄 도구(선택 사항)가 룰 변경을 대신 적용할 수 있습니다 — 클릭보다 타이핑이 편하거나, AI 코딩 어시스턴트가 작업하는 동안 헤더를 설정하게 하고 싶을 때 쓸모가 있습니다. 팝업에서 그 스위치를 켜기 전까지는 꺼져 있고, 직접 설치하는 도우미 프로그램이 따로 필요하며, 네트워크가 아니라 기기 안의 로컬 소켓으로 통신합니다. 스위치를 그대로 두면 그중 아무것도 돌지 않습니다.

오픈 소스, Apache-2.0.
```

## How this was produced

Translated from [`description.en.md`](description.en.md), then reviewed against
the English source and revised — 11 issues were raised on this
locale and applied. Terminology follows [`../README.ko.md`](../README.ko.md),
the project's own README in this language, so a reader arriving from the
repository meets the same words.

`tests/unit/storeListing.test.ts` holds the structure to the English source:
the same number of bullets in the same order, every verbatim token intact, and
no Markdown that would render as literal junk in the store. Edit the prose
freely; that test is what stops an edit quietly breaking the shape.

**The English file is the source.** If a claim changes, change
`description.en.md` first and bring the five into line from there — five
descriptions making four different promises about the same extension is the
failure this ordering exists to prevent.
