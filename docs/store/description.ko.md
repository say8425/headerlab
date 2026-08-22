# Detailed description — 한국어 (`ko`)

Paste the block below into **Store listing → Description**, with the language
dropdown set to Korean. It is plain text: the store keeps line breaks and
renders nothing else, so the bullets and headings are literal characters.

```text
HeaderLab 은 Chrome 자체의 declarativeNetRequest 엔진을 써서, 직접 고른 사이트에서 HTTP 요청·응답 헤더를 설정·추가·삭제합니다. 직접 허용하기 전까지는 어떤 사이트에도 접근 권한을 갖지 않습니다.

무엇을 하는가

• 어떤 헤더든 요청 쪽이든 응답 쪽이든 설정·추가·삭제합니다.
• 사이트 단위로 범위를 정합니다. 사이트는 호스트로 매칭되므로, 팝업에 보이는 것이 실제로 회선에 나가는 것입니다.
• 모든 사이트에 적용하는 것은 명시적인 모드입니다. 모든 사이트에 대한 접근 권한을 요구하지만 스위치 자체는 그것을 요청하지 않고 — 별도의 Grant 버튼이 요청합니다.
• 요청 타입으로 거릅니다. Chrome 의 리소스 타입 여덟 개를 각각 체크박스로 켜고 끄며, Chrome 자체의 기본값이 조용히 빼놓는 main_frame 도 포함됩니다.
• 스위치 하나로 전체를 일시정지합니다. 툴바 아이콘도 그에 맞춰 회색으로 바뀌고, 브라우저를 다시 켜도 회색 그대로입니다.

AI 코딩 에이전트로 조작하기

HeaderLab 은 선택 사항인 명령줄 도구와 Claude Code·Codex 용 스킬을 함께 제공합니다. 에이전트가 작업하는 도중에 헤더 룰을 읽고 바꿀 수 있다는 뜻입니다. 그냥 말로 부탁하면 됩니다 — X-Debug 헤더를 추가하고 staging.example.com 으로 범위를 잡아 줘, API 로는 Referer 를 보내지 마 — 그리고 그 결과는 직접 타이핑했을 때와 똑같이 팝업에 나타납니다.

그렇다고 통제권을 내주지는 않습니다. 브리지는 팝업에서 스위치를 켜기 전까지 꺼져 있고, 도구가 스스로 스위치를 켜거나 사이트 접근 권한을 얻을 수는 없으며 — Chrome 은 그 둘 다 사람의 클릭에서만 받습니다 — 통신은 네트워크가 아니라 로컬 소켓으로 이뤄집니다.

무엇을 하지 않는가

• 네트워크 호출 없음. 분석도, 텔레메트리도, 원격 설정도, 업데이트 핑도 없습니다.
• 콘텐츠 스크립트 없음. 어떤 페이지에도 아무것도 주입하지 않으며, 확장이 페이지의 내용을 보는 일도 없습니다.
• 원격 코드도, CDN 도, 웹폰트도, 원격 이미지도 없음. 패키지 바깥에서 무언가를 받아 오지 않습니다.
• 기기 밖으로 나가는 것 없음. 룰은 Chrome 자체의 확장 저장소에 보관됩니다.

https://github.com/say8425/headerlab

오픈 소스, Apache-2.0.
```

## How this was produced

Translated from [`description.en.md`](description.en.md). The first version was
reviewed against the English source and revised — 11 issues were raised on this
locale and applied.

**The 2026-08-22 rewrite did not go through that reviewer stage.** It was
translated straight from the new English, in the same pass that wrote it, so
this file is worth a proofread before it is pasted into the dashboard — the
structural guard below cannot read meaning. Terminology follows
[`../README.ko.md`](../README.ko.md), the project's own README in this language, so a
reader arriving from the repository meets the same words.

`tests/unit/storeListing.test.ts` holds the structure to the English source:
the same number of bullets in the same order, every verbatim token intact, and
no Markdown that would render as literal junk in the store. Edit the prose
freely; that test is what stops an edit quietly breaking the shape.

**The English file is the source.** If a claim changes, change
`description.en.md` first and bring the five into line from there — five
descriptions making four different promises about the same extension is the
failure this ordering exists to prevent.
