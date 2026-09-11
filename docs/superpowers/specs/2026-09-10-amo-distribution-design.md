# HeaderLab — Firefox Add-ons (AMO) 배포 설계 (스펙 C)

2026-09-10. `docs/superpowers/specs/2026-09-08-firefox-support-design.md` §10 이 "스펙 C" 로
미뤄 둔 것: 서명된 Firefox 배포. 그 스펙이 Firefox 빌드를 **만들고 wire 에서 증명**했다면,
이 스펙은 그 빌드를 **AMO 에 올리고, 릴리스에 붙이고, 문서가 두 브라우저를 말하게** 한다.

접근법은 Chrome Web Store 경로를 거울처럼 따른다 — 재사용 워크플로 하나, 환경 하나, 시크릿은 그
환경 안에만, 첫 제출은 사람이, 그 뒤는 릴리스 PR 머지가 전부. 다른 점은 딱 하나다: Chrome 은
`wxt submit` 이 **아니고**(Verified CRX 가 zip 을 거부하므로 CRX 를 직접 서명해 v2 API 에 올린다),
Firefox 는 `wxt submit` **그 자체**다.

## 1. 목표와 범위

**안:**

- `pnpm zip` 이 세 아카이브를 만든다 — `headerlab-<v>-chrome.zip`, `-firefox.zip`, `-sources.zip`.
  릴리스 잡은 셋을 모두 GitHub 릴리스에 붙인다.
- `.github/workflows/amo-submit.yml` — 릴리스가 부르는 재사용 워크플로. `firefox-amo` 환경의
  시크릿으로 `wxt submit` 을 돌린다. listed 와 unlisted 채널을 모두 받고, unlisted 면 AMO 가
  서명한 `.xpi` 를 받아 릴리스에 붙인다.
- `.github/workflows/store-submit.yml` → `cws-submit.yml` 개명. 스토어가 둘이 된 뒤로 "store" 는
  이름이 아니다.
- `scripts/amo-submit.mjs`(로컬·CI 공용 진입점, 1Password 또는 env 에서 자격 증명), `scripts/lib/amo.mjs`
  (순수 판정, 단위 테스트), `scripts/amo-probe.mjs`(읽기 전용 상태 조회).
- `docs/store/amo/` — AMO 리스팅 런북·필드·문안·리뷰어 노트. Chrome 문안과 스크린샷을 재활용한다.
- `PRIVACY.md` 를 브라우저 중립으로 다시 쓴다. README 다섯 판의 Firefox 설치 절을 지금 참인
  문장으로 고친다. CLAUDE.md 에 AMO 절을 더한다.
- 가드: `tests/unit/storeSubmit.test.ts` 확장, `tests/unit/amo.test.ts` 신설,
  `tests/unit/storeListing.test.ts` 에 AMO 문안 규칙.
- 저장소 밖: `firefox-amo` 환경·브랜치 규칙·시크릿 둘·변수 하나 (`gh` 로, 오너 승인 2026-09-10).

**밖 (§13):** 첫 제출의 자동화, `update_url` 자체 배포, sources zip 재현 검사, Firefox 에서
찍은 스크린샷, AMO 게시 뒤의 README 뱃지·링크 (체크리스트의 "게시 후" 항목으로 문안만 준비).

## 2. 실측 사실 — 설계가 기대는 것

모두 2026-09-09 ~ 10 에 이 Mac 에서 잰 것이다. 문서에서 읽은 것은 그렇게 표시했다.

**`wxt submit` 은 `publish-browser-extension@5.1.0` 의 CLI 를 그대로 별칭한 것이다**
(`node_modules/wxt/dist/cli/commands.mjs:77`, `createAliasedCommand(cli, "submit", "publish-extension", …)`).
그 패키지는 wxt 의 의존성이라 새로 설치할 것이 없다 — "새 의존성 없음" 규칙이 그대로 선다. 읽는
환경변수는 `FIREFOX_ZIP`, `FIREFOX_SOURCES_ZIP`, `FIREFOX_EXTENSION_ID`, `FIREFOX_JWT_ISSUER`,
`FIREFOX_JWT_SECRET`, `FIREFOX_CHANNEL`(`listed`|`unlisted`, 기본 `listed`), `FIREFOX_COMPATIBILITY`,
`FIREFOX_SKIP_SUBMIT_REVIEW`, `DRY_RUN`. 같은 이름을 `--firefox-*` 플래그로도 받고, 있으면
`.env.submit` 을 dotenv 로 읽는다 (`dist/cli.mjs:46`). `wxt submit init` 이 그 파일에 시크릿을
쓰므로 `.gitignore` 에 올린다.

**그 Firefox 흐름은 넷이고, 못 하는 것이 둘이다** (`dist/init-B7pE83dc.mjs:1590-1641`):

1. `GET /api/v5/addons/addon/{id}` — 애드온 조회. `--dry-run` 은 여기서 멈춘다 (인증과 존재만
   확인).
2. `POST /api/v5/addons/upload/` (multipart, `channel` 포함) → `GET /api/v5/addons/upload/{uuid}` 를
   `processed` 가 될 때까지 폴링. 5초 간격, 10분 상한 (`pollUntil`, `:1442`).
3. `POST /api/v5/addons/addon/{id}/versions/` (multipart: `upload` uuid, `source` = sources zip).
4. 업로드가 `valid` 가 아니면 검증 URL 을 들고 throw. `compatibility` 가 주어졌을 때만 PATCH.

못 하는 것: **애드온을 만들지 못한다** (1번이 404 면 끝) — 그래서 첫 제출은 사람이 한다 (§11).
**서명된 파일을 받아오지 않는다** — 3번에서 버전을 만들고 끝나므로, unlisted 의 xpi 는 우리
스크립트가 받는다 (§5).

**AMO 의 현재 상태.** `GET /api/v5/addons/addon/headerlab@say8425.github.io/` 는 공개로도,
JWT 로 인증해도 **404**. slug `headerlab` 도 404 — 비어 있다. 1Password 의 토큰으로
`GET /api/v5/accounts/profile/` 은 **200**, `is_addon_developer: false`, `num_addons_listed: 0`.
계정은 유효하고 아직 아무것도 제출한 적이 없다.

**1Password 아이템 `Firefox AMO Token`** (Personal 볼트, LOGIN, 2026-09-09 생성): `username` 필드가
JWT issuer (`user:########:###` 꼴, 17자), `password` 필드가 JWT secret (64자). 세 번째 필드
`notesPlain` 은 비어 있다. 값은 이 문서 어디에도 없다.

**AMO 의 JWT** (문서: `addons-server/topics/api/auth.html`): `Authorization: JWT <token>`, HS256,
클레임 `iss`·`jti`(재사용 방지 nonce)·`iat`·`exp`, **`exp` 는 `iat` 에서 5분을 넘을 수 없다**.
`publish-browser-extension` 은 요청마다 30초짜리를 새로 만든다 (`createFirefoxJwt`, `:1566`).

**`wxt zip -b firefox`** 는 두 파일을 만든다 — `headerlab-1.7.0-firefox.zip`(166 KB)과
`headerlab-1.7.0-sources.zip`(2.77 MB). sources 는 Firefox 와 Opera 에서만 기본 켜짐
(`resolve-config.mjs:200`), 기본 제외는 `**/node_modules`, `**/web-ext.config.ts`, `**/__tests__/**`,
`*.test|spec.*`, `.output/**`, 그리고 dotfile 전부 (`dotSources: false`). 실측한 내용물: **214 파일**,
최상위 `docs` 67 · `lib` 40 · `packages` 35 · `scripts` 15 · `components` 15 · `tests` 12 ·
`public` 9 · `entrypoints` 7, 그리고 루트 파일 열넷 (`pnpm-lock.yaml`, `package.json`,
`wxt.config.ts`, `tsconfig.json`, `CLAUDE.md`, `README.md`, `PRIVACY.md`, `LICENSE`, …).
**`.nvmrc` 는 dotfile 이라 들어가지 않는다** — Node 버전은 README 가 글로 말해야 한다.

**AMO 리스팅 규격** (문서: Extension Workshop "Create an appealing listing",
"Submitting an add-on", "Source code submission"): summary **250자**, 카테고리 **최대 2**,
스크린샷 권장 **1280×800** ("the maximum image display size"), 아이콘 PNG/JPEG 정사각,
description 은 제한된 HTML/Markdown 허용, 개인정보 정책은 리스팅에 **본문으로** 입력 (Chrome 은
URL). 소스 제출은 "bundling tools" 를 쓴 확장에 **필수**이고 리뷰어는 "use a diff tool to compare
the generated sources to those in the extension. There must be no differences." — 채널을 가리지
않는다. 카테고리 슬러그 (`GET /api/v5/addons/categories/`): `web-development` ("Web Development").
라이선스 슬러그 (`topics/api/licenses.html`): `Apache-2.0`.

**버전·파일 상태** (문서: `topics/api/addons.html`): 버전 상세
`GET /api/v5/addons/addon/{id}/versions/{version_number}/` 의 `file.status` 는 `public`(승인),
`unreviewed`(대기), `disabled`(거절·비활성·미검토). `file.url` 은 절대 다운로드 URL, `file.hash`
는 해시. unlisted 버전은 작성자 인증이 있어야 보인다. 버전 목록의 `filter=all_with_unlisted` 도
같은 조건.

**저장소 쪽.** `pack-crx.mjs` 는 인자가 없으면 `package.json` 의 version 으로
`.output/headerlab-<v>-chrome.zip` 을 고른다 (`:89-91`); `cws-submit.yml` 이 될 워크플로는 지금
`.output/*.zip` glob 을 두 곳에서 쓴다 (`gh release download --pattern '*.zip'`,
`node scripts/pack-crx.mjs .output/*.zip`) — zip 이 셋이 되면 둘 다 깨진다. `chrome-web-store`
환경은 `can_admins_bypass: false`, 브랜치 정책 `main` 하나.

## 3. 아카이브와 릴리스 잡

**`package.json`**

```json
"zip": "wxt zip && wxt zip -b firefox",
"amo:submit": "wxt zip -b firefox && node scripts/amo-submit.mjs",
"amo:probe": "node scripts/amo-probe.mjs"
```

`crx` 는 그대로 (`wxt zip && node scripts/pack-crx.mjs` — 기본 경로가 이미 `-chrome.zip` 이다).
`build` 는 이미 두 타깃을 만든다.

**`wxt.config.ts`** — `zip: { excludeSources: ['docs/**'] }`. 67 파일, 그중 PNG 가 1.2 MB, 빌드
입력은 하나도 없다. `tests/**` 와 `packages/**` 는 남긴다: 전자는 wxt 가 `*.test.ts` 를 이미 빼고
남은 열둘이 작으며, 후자는 `pnpm-workspace.yaml` 이 이름으로 부르는 디렉터리라 없으면
`pnpm install --frozen-lockfile` 의 결과를 장담할 수 없다 (CLAUDE.md 가 그 예측을 두 번 틀린
기록을 갖고 있다). 제외 뒤의 파일 수와 크기는 플랜에서 재고 CLAUDE.md 에 적는다.

**`release-please.yml`** — `pnpm zip` 단계의 주석을 세 아카이브로 고치고, `gh release upload "$TAG"
.output/*.zip` 은 그대로 둔다 (셋을 다 붙이는 것이 의도다). sources zip 을 붙이는 이유는
투명성이다: **Mozilla 리뷰어가 받은 아카이브와 누구나 릴리스 페이지에서 내려받는 아카이브가 같은
파일**이고, AMO 잡이 그것을 다시 빌드하지 않고 내려받아 올린다. 태그 이전에 실패할 수 있는 것은
전부 태그 이전에 — `pnpm check` 가 이미 두 빌드를 만들고 manifest 를 고정하므로 zip 단계에 새로
더할 검사는 없다.

잡 둘을 나란히 부른다:

```yaml
  cws-submit:
    needs: release-please
    if: ${{ needs.release-please.outputs.extension_released }}
    uses: ./.github/workflows/cws-submit.yml
    with:
      tag: ${{ needs.release-please.outputs.extension_tag }}
      version: ${{ needs.release-please.outputs.extension_version }}
    secrets: inherit

  amo-submit:
    needs: release-please
    if: ${{ needs.release-please.outputs.extension_released }}
    uses: ./.github/workflows/amo-submit.yml
    with:
      tag: ${{ needs.release-please.outputs.extension_tag }}
      version: ${{ needs.release-please.outputs.extension_version }}
    secrets: inherit
```

한쪽이 빨개도 다른 쪽은 돈다 — 두 스토어는 서로의 실패를 알 이유가 없다.

**`cws-submit.yml`** (개명, 내용은 두 줄만): `--pattern '*-chrome.zip'`,
`node scripts/pack-crx.mjs .output/*-chrome.zip`. `name: Chrome Web Store submit`.

## 4. `amo-submit.yml`

`cws-submit.yml` 과 같은 골격이고, 다른 곳은 아래에 다 적었다.

```yaml
name: Firefox Add-ons submit

on:
  workflow_call:
    inputs:
      tag:      { required: true,  type: string }
      version:  { required: true,  type: string }
      channel:  { required: false, type: string }   # 릴리스는 넘기지 않는다
      ref:      { required: false, type: string }
  workflow_dispatch:
    inputs:
      tag:      { required: true,  type: string }
      version:  { required: true,  type: string }
      channel:
        type: choice
        options: [listed, unlisted]
        default: listed
      ref:      { required: false, type: string }

permissions:
  contents: write

jobs:
  submit:
    runs-on: ubuntu-latest
    timeout-minutes: 30      # 검증 폴링 10분 + unlisted 서명 대기 15분
    environment: firefox-amo
```

(위는 스케치라 flow 스타일로 줄였다. 실제 파일은 `cws-submit.yml` 처럼 블록 스타일로 쓴다 —
§10 의 들여쓰기 단언이 그 모양을 센다.)

단계, 이 순서로:

1. **checkout** `ref: ${{ inputs.ref || inputs.tag }}`, `persist-credentials: false`. Chrome 과
   같은 두 실패 모드, 같은 두 답 (§12 의 복구 표).
2. **`./.github/actions/setup`** — `wxt submit` 은 `node_modules` 가 있어야 돈다. Chrome 잡이
   설치 없이 도는 것과 다른 점이고, 시크릿을 쥔 잡이 그만큼 커진다. 받아들인 비용이다:
   `wxt submit` 을 쓰라는 것이 요청이고, 대안(§12 접근법 B)은 이미 있는 것을 다시 쓰는 일이다.
3. **Refuse to run without real AMO credentials** — `FIREFOX_JWT_ISSUER` 가 `^user:[0-9]+:[0-9]+$`
   에 맞고, `FIREFOX_JWT_SECRET` 이 비어 있지 않고, 채널이 `listed` 또는 `unlisted`. 채널은
   `${{ inputs.channel || vars.FIREFOX_CHANNEL || 'listed' }}` 로 정해 `$GITHUB_ENV` 에
   `FIREFOX_CHANNEL` 로 쓴다. 비어 있는 시크릿은 빈 문자열로 도착하고, `wxt submit` 은 그것을
   "nonempty" 검증에서 잡지만 그때는 이미 체크아웃과 설치가 끝난 뒤다 — 여기서 먼저 거른다.
   secret 의 형태는 검사하지 않는다 (64자라는 것은 이 토큰의 사실이지 AMO 의 약속이 아니다).
4. **Take the archives from the release** — `gh release download "$TAG" --pattern '*-firefox.zip'
   --pattern '*-sources.zip' --dir .output`.
5. **Submit to Firefox Add-ons** —
   `node scripts/amo-submit.mjs --channel "$FIREFOX_CHANNEL" --expect-version "$VERSION"`, env 에
   `FIREFOX_JWT_ISSUER`·`FIREFOX_JWT_SECRET`(시크릿), `FIREFOX_EXTENSION_ID: headerlab@say8425.github.io`.
   스크립트가 아카이브를 찾고, manifest 의 version·gecko id 를 확인하고, `wxt submit` 을 돌리고,
   unlisted 면 서명된 xpi 까지 받는다 (§5). 워크플로는 채널을 정하고 자격 증명을 넘기는 일만 한다.
6. **Attach the signed package to the release** — `if: env.FIREFOX_CHANNEL == 'unlisted'`,
   `gh release upload "$TAG" .output/*.xpi --clobber`. listed 는 붙일 것이 없다: AMO 가 호스팅한다.

**초록의 뜻.** listed: AMO 가 업로드를 검증했고 버전을 만들었다 — 승인은 이메일로 온다.
unlisted: 거기에 더해 서명이 끝났고 `headerlab-<v>-firefox.xpi` 가 릴리스에 있다. 어느 쪽도
"게시됐다" 는 아니다.

**`FIREFOX_EXTENSION_ID` 는 시크릿이 아니라 워크플로의 상수**다 — manifest 에 있고 README 에
있는 공개 값이다. 워크플로의 문자열과 빌드된 Firefox manifest 의 `browser_specific_settings.gecko.id`
가 같다는 것을 `storeSubmit.test.ts` 가 고정한다 (§10).

## 5. 스크립트

셋 다 Node 내장만 쓴다. `scripts/lib/cws.mjs` / `store-submit.mjs` 와 같은 분할: 판정은 순수
모듈에, I/O 는 진입점에.

**`scripts/lib/amo.mjs`** (순수, `amo.d.mts` 동반, `tests/unit/amo.test.ts`):

- `AMO_ORIGIN = 'https://addons.mozilla.org'`, `GECKO_ID = 'headerlab@say8425.github.io'`,
  `CHANNELS = ['listed', 'unlisted']`.
- `archiveNames(version)` → `{ extension: 'headerlab-<v>-firefox.zip', sources: 'headerlab-<v>-sources.zip', signed: 'headerlab-<v>-firefox.xpi' }`.
- `issuerLooksValid(s)` → `/^user:\d+:\d+$/`.
- `claimSet({ issuer, now, jti, lifetimeSeconds = 60 })` → `{ iss, jti, iat: now, exp: now + lifetime }`.
  `lifetimeSeconds` 가 300 을 넘으면 throw — AMO 의 상한이고, 넘기면 401 이 "왜" 없이 온다.
- `signingInput(claims)` → `base64url(header).base64url(claims)`, header 는 `{ alg: 'HS256', typ: 'JWT' }`.
  서명(HMAC)은 호출자가 `node:crypto` 로 한다.
- `endpoints(id)` → `{ addon, versions: (filter) => …, version: (number) => … }`.
- `parseHash('sha256:<hex>')` → `{ algorithm: 'sha256', hex }`; 다른 알고리즘은 throw.
- `readSignedFile(versionDetail, { channel })` → `{ kind: 'ready', url, hash }` |
  `{ kind: 'wait', status }` | `{ kind: 'refused', reason }`. 판정표:
  `channel` 이 요청과 다르면 refused; `file.status === 'public'` 이면 ready;
  `'unreviewed'` 면 wait; `'disabled'` 면 refused ("rejected, disabled or not reviewed");
  **그 밖의 값은 refused** — `UPLOADABLE_STATES` 와 같은 fail-closed. 문서가 셋만 말하므로
  넷째 값은 스키마 드리프트다.
- `manifestMatches(manifestJson, { version, geckoId })` → `[]` 또는 불일치 설명 배열.

**`scripts/amo-submit.mjs`** — 로컬과 CI 의 **하나뿐인** 진입점. `pack-crx.mjs` 가 그렇듯
워크플로는 사람이 치는 명령을 그대로 친다.

- 인자: `--channel listed|unlisted` (기본 `listed`), `--expect-version <v>` (없으면
  `package.json` 의 version), `--dry-run`.
- 자격 증명: env `FIREFOX_JWT_ISSUER`/`FIREFOX_JWT_SECRET` 이 있으면 그것, 없으면 1Password
  `op://Personal/Firefox AMO Token/username` 과 `…/password` 를 `op read` 로. 값은 자식 프로세스의
  env 로만 흐르고 argv·로그·디스크에 닿지 않는다.
- 아카이브: `.output/headerlab-<v>-firefox.zip` 과 `-sources.zip` 이 둘 다 있어야 한다. 없으면
  `pnpm zip` 또는 `gh release download` 를 이름 붙여 거부.
- 검사: `unzip -p <zip> manifest.json` 의 `version` 이 `<v>` 와, `gecko.id` 가 `GECKO_ID` 와 같다
  (`manifestMatches`). Chrome 의 `pack-crx.mjs` 가 같은 이유로 같은 검사를 한다 — 아카이브는
  argv 에서, 버전은 `package.json` 에서 오면 1.2.0 아카이브가 1.3.0 으로 올라간다.
- 실행: `node_modules/.bin/wxt submit --firefox-zip … --firefox-sources-zip … --firefox-channel …
  [--dry-run]`, env 에 `FIREFOX_EXTENSION_ID`·issuer·secret. `pnpm exec` 가 아니라 `.bin` 을
  직접 — 이 Mac 의 pnpm 사정과 무관하게, 그리고 CI 에서 같은 줄로.
- unlisted 이고 dry-run 이 아니면: 버전 상세를 15초마다 읽어 `readSignedFile` 이 `ready` 를 줄 때까지
  (상한 `--timeout-minutes`, 기본 15), `file.url` 을 JWT 로 받아 `sha256` 을 `file.hash` 와
  대조하고 `.output/headerlab-<v>-firefox.xpi` 로 쓴다. `refused` 는 이유를 찍고 종료 1.
  **`file.url` 이 `/api/` 밖의 경로인데 JWT 헤더로 받아지는지는 아직 재지 않았다** — `web-ext sign`
  의 구현이 그렇게 받으므로 그렇게 쓰되, 첫 unlisted 실행이 측정이고 CLAUDE.md 가 그렇게 적는다.
- `die` 는 throw 다 (`store-submit.mjs` 의 이유 그대로: 파이프 stdout 에서 `process.exit` 은
  마지막 줄을 잘라먹는다).

**`scripts/amo-probe.mjs`** — 읽기 전용. 애드온 상세(`status`, `slug`, `current_version`,
`latest_unlisted_version`)와 `filter=all_with_unlisted` 버전 목록의 최근 다섯 개를 `file.status`
와 함께 찍는다. 같은 자격 증명 규칙. `store-probe.mjs` 가 CWS 의 응답 모양을 잡아냈듯, 첫 제출 뒤
`readSignedFile` 이 읽는 필드가 진짜 있는지 한 번 보는 용도다.

**`.gitignore`** — `.env.submit`, `*.xpi`.

## 6. 리스팅 문서 — `docs/store/amo/`

Chrome 파일은 제자리에 두고 (`docs/store/checklist.md` 등은 CLAUDE.md 가 경로로 여러 번 부른다)
`assets/` 를 공유한다. `docs/store/README.md` 에 행 하나를 더해 여기를 가리킨다.

| 파일 | 내용 |
| --- | --- |
| `README.md` | 색인. AMO 와 CWS 가 다른 점 셋 — 개인정보 정책은 본문, 소스 zip 필수, 첫 제출만 사람 |
| `checklist.md` | 런북. §1 계정 (Firefox 계정, 2FA, 개발자 약관, API 키 — 이미 있음), §2 아카이브 (`pnpm zip`, 두 zip 확인), §3 첫 제출 (Developer Hub → "Submit a New Add-on" → On this site, 두 zip 업로드), §4 리스팅 필드 (`listing.md`), §5 개인정보 본문 (`PRIVACY.md`), §6 리뷰어 노트 (`reviewer-notes.md`), §7 게시 후 (README 다섯 판의 정확한 diff), §8 이후 릴리스와 복구 표, "일어나지 않을 일" |
| `listing.md` | 필드와 값 (아래), 스크린샷 순서와 캡션, 재활용의 비용 |
| `description.en.md` | 문안 (아래), Chrome 문안과의 차이를 줄 단위로 |
| `reviewer-notes.md` | "Notes to reviewer" 에 붙일 빌드 재현 지시문 |

**`listing.md` 의 값:**

| 필드 | 값 |
| --- | --- |
| Name | `HeaderLab` — manifest 에서 옴 |
| Add-on URL (slug) | `headerlab` — 실측 비어 있음 |
| Summary | manifest.description 이 채워 줌, 119/250 자. `tests/unit/manifest.test.ts` 의 132자 상한이 AMO 의 250 안에 든다 |
| Description | `description.en.md` |
| Categories | `web-development`. 둘째 칸은 비움 — Chrome 도 하나다. `privacy-security` 를 더할지는 오너의 몫 |
| License | `Apache-2.0` |
| Homepage | `https://github.com/say8425/headerlab` |
| Support site | `https://github.com/say8425/headerlab/issues` |
| Support email | 없음 (오너의 몫 — Chrome 도 없다) |
| Icon | `public/icon/active-128.png`, full-bleed. AMO 는 Chrome 처럼 패딩을 요구하지 않고 아이콘을 둥근 틀에 꽉 채워 그린다. 두 스토어 아이콘을 맞추고 싶으면 `assets/store-icon-128.png` 로 바꾸면 된다 — 같은 글리프다 |
| Screenshots | `assets/screenshot-{1..5}-*.png`, 1280×800 — AMO 의 권장 크기와 정확히 같다. 캡션은 Chrome `listing.md` 의 "What it shows" 열 |
| Privacy policy | `PRIVACY.md` 본문을 평문으로 (§7) |
| Compatibility | Firefox desktop 만. Android 는 선언하지 않는다 — 748×600 팝업은 모바일용이 아니다 |
| Experimental / Requires payment | No / No |
| Data collection | manifest 의 `data_collection_permissions: none` 이 리스팅에 "does not collect data" 로 뜬다 — 입력하지 않는다 |

**재활용의 비용, 적어 두는 것:** 다섯 스크린샷은 Chrome 팝업이고 레일에 **Agent bridge 행**이
있다. Firefox 팝업에는 그 행이 없다. 오너의 지시로 재활용하되 캡션은 그 행을 언급하지 않고,
`checklist.md` 와 §13 이 Firefox 촬영(`tests/support/firefox.ts` 의 `screenshot()`)을 후속으로
남긴다.

**`description.en.md`** — Chrome 문안을 기준으로 줄 단위 차이만 둔다. `storeListing.test.ts` 의
같은 규칙(verbatim 목록, Markdown 없음, 모양 스냅샷)을 받는다:

- 첫 줄: "using Chrome's own declarativeNetRequest engine" → "using the browser's own
  declarativeNetRequest engine".
- 요청 타입 불릿: "Eight of Chrome's resource types" → "Eight request types"; "which Chrome's own
  default quietly leaves out" → "which the browser's own default quietly leaves out".
- "DRIVE IT FROM AN AI CODING AGENT" 절은 헤딩을 지키되 두 문단을 하나로 줄인다: 도구와 스킬이
  있다는 것, 그리고 **"That bridge is Chrome-only for now: Firefox closes native-messaging ports
  when an extension's event page goes idle, so this Firefox build does not offer it and asks
  for no nativeMessaging permission."** Firefox 사용자가 쓸 수 없는 기능을 첫 화면에서 파는
  것은 리스팅이 거짓말하는 방식이다.
- "Your rules live in Chrome's own extension storage" → "in the browser's own extension storage".
- 나머지 줄은 바이트 단위로 같다. 모양 스냅샷은 플랜에서 계산해 고정한다.

**`reviewer-notes.md`** — 붙일 본문:

> Built with WXT 0.21 (Vite) and Tailwind CSS v4, so the package is bundled; the sources archive
> is the repository at the release tag, produced by `wxt zip -b firefox`. To reproduce: Node 24
> (the repository pins it in `.nvmrc`, which the archive omits as a dotfile), then
> `corepack enable` (pnpm 11.20.0 from `package.json`'s `packageManager`),
> `pnpm install --frozen-lockfile`, `pnpm build:firefox`. The output in `.output/firefox-mv3/`
> is the uploaded package. The extension makes no network calls:
> `grep -rE 'fetch\(|XMLHttpRequest|WebSocket|sendBeacon' .output/firefox-mv3` returns nothing,
> and `tests/unit/bundle.test.ts` asserts the same against every build.

## 7. `PRIVACY.md`

브라우저 중립으로 다시 쓴다. 바뀌는 문장과 바뀌지 않는 약속:

- 첫 문단: "a Chrome extension" → "a browser extension for Chrome and Firefox".
- 근거 문단: Chrome Web Store 의 인용은 두고, AMO 도 리스팅에 개인정보 정책 본문을 요구한다는 문장을
  더한다. 그래서 이 문서가 두 스토어에 같은 글로 간다.
- 저장소: "Chrome's extension storage (`chrome.storage.local`)" → "your browser's extension
  storage — `chrome.storage.local` in Chrome, `browser.storage.local` in Firefox".
- 엔진: "Chrome's own `declarativeNetRequest` engine" → "the browser's own `declarativeNetRequest`
  engine".
- grep 블록: `.output/chrome-mv3 .output/firefox-mv3` 둘 다. 명령은 `pnpm build` 뒤에 그대로 참이다.
- 사이트 접근: `chrome://extensions` 옆에 `about:addons`.
- 브릿지 절: 제목 그대로, 첫 문장에 **"Chrome only."** — Firefox 빌드는 이 기능을 제공하지 않고
  `nativeMessaging` 권한을 선언하지도 않는다. 이유는 한 줄 (이벤트 페이지가 유휴 시 포트를 닫는다).
- AMO 데이터 수집 선언: "On Firefox Add-ons the listing's data-collection declaration is *none*,
  and it comes from the extension's manifest rather than from a form."
- 보존·삭제: "Uninstalling HeaderLab removes everything the browser was holding for it."
- 날짜: `_Last updated: 2026-09-10_`.

리스팅에 붙이는 평문 판은 만들지 않는다 — AMO 의 필드는 제한된 Markdown 을 받으므로 이 파일을 그대로
붙이고, 체크리스트가 그렇게 말한다. 코드 스팬과 링크가 어떻게 그려지는지는 첫 제출 때 눈으로 본다.

## 8. README 다섯 판

리스팅이 없는 동안 뱃지와 링크를 넣으면 뱃지는 "not found" 를, 링크는 404 를 그린다. Chrome 때와
같은 순서로 간다 — 게시 뒤에 `checklist.md` §7 이 정확한 diff 를 들고 있다. 지금 바꾸는 것:

- **Install 도입 문장:** "Chrome from the store, Firefox by loading a build — a signed Firefox
  release is next." → "Chrome from the store, Firefox from the release page while the Firefox
  Add-ons listing is in review."
- **`### Release page`:** "attaches `headerlab-<version>-chrome.zip`" → 셋을 이름 붙여 적는다 —
  `-chrome.zip`, `-firefox.zip`, `-sources.zip` (the archive Mozilla reviews, attached so anyone
  can see it).
- **`### Firefox`:** 임시 로드 경로가 `.output/firefox-mv3/manifest.json` 뿐 아니라 릴리스의
  `-firefox.zip` 도 받는다는 것 (about:debugging 은 zip 파일을 직접 받는다). "There is no signed
  Firefox build yet" 은 "The Firefox Add-ons listing is in review; until it is live, release
  Firefox will not install this permanently." 로.
- **`### Build it yourself`:** Node 24 와 corepack 을 명시하고 `pnpm build:firefox` 를 한 줄 더한다 —
  AMO 리뷰어가 sources zip 안의 이 파일을 읽는다.
- **Development 명령 블록:** `pnpm amo:submit`, `pnpm amo:probe` 두 줄.
- 네 번역판은 같은 네 곳을 각자의 말로. `tests/unit/readmeLiterals.test.ts` 와
  `packages/headerlab/test/docs.test.mjs` 는 이 절을 보지 않는다 (전자는 팝업 리터럴, 후자는
  `headerlab ` 명령) — 그래서 번역판의 드리프트는 사람이 읽어야 한다.

## 9. CLAUDE.md

- **Commands:** `pnpm zip` 세 아카이브, `pnpm amo:submit`, `pnpm amo:probe`.
- **Release:** 릴리스 잡이 세 아카이브를 붙인다는 것과 이유, 제출 잡이 둘이고 나란히 돈다는 것,
  `cws-submit.yml` 개명, Chrome 단계의 `*-chrome.zip`.
- **새 절 "Firefox Add-ons (AMO)":** §2 의 실측(토큰 필드, 404 둘, 프로필 200, zip 내용물과
  제외 뒤 수치, `pollUntil` 5초/10분, JWT 5분 상한), `wxt submit` 이 못 하는 둘과 그 답,
  `firefox-amo` 환경의 구성, 채널 변수, 첫 제출은 사람, 재현 검사를 **생략한 오너 결정
  (2026-09-10)** 과 그 뜻 — AMO 리뷰가 diff 로 반려하면 그것이 첫 신호다 —, 스크린샷 재활용의
  비용, 복구 표.
- **Known gaps:** sources zip 의 재현성은 아무것도 검사하지 않는다; Firefox 스크린샷 없음.
- **Chrome Web Store 절:** "A `wxt submit` step is not what does this" 옆에 Firefox 는 정반대라는 한
  문장.

## 10. 가드

**`tests/unit/storeSubmit.test.ts`** — 파일을 둘 더 읽고 (`cws-submit.yml`, `amo-submit.yml`)
다음을 고정한다. 기존 단언은 이름만 따라간다.

- 환경 이름: `cws-submit.yml` 의 `environment:` 는 정확히 `['chrome-web-store']`, `amo-submit.yml`
  은 정확히 `['firefox-amo']`. 오타는 실패하지 않고 보호 규칙 없는 환경을 만든다 — 기존 주석 그대로.
- 시크릿 격리: `FIREFOX_JWT_ISSUER`·`FIREFOX_JWT_SECRET` 은 `amo-submit.yml` 에만, `CRX_SIGNING_KEY`·
  `CWS_SERVICE_ACCOUNT_JSON` 은 `cws-submit.yml` 에만, `release-please.yml` 에는 넷 다 없다.
- 순서: AMO 워크플로에서 거부 단계 < 다운로드 < `scripts/amo-submit.mjs`.
- 트리거: 둘 다 `workflow_call:` 과 `workflow_dispatch:` 가 있고 `release:`·`tags:` 는 없다.
- 호출: `release-please.yml` 에 `cws-submit:` 와 `amo-submit:` 잡이 각각 `needs: release-please`,
  `uses: ./.github/workflows/<file>`, `extension_released` 게이트, tag·version 전달. 각 callee 의
  `tag:`/`version:` 이 6칸 들여쓰기로 정확히 둘.
- `ref: ${{ inputs.ref || inputs.tag }}` 가 둘 다에.
- **Chrome 단계가 `*-chrome.zip` 을 명시**: `cws-submit.yml` 에 `.output/*.zip` 이 없고
  `*-chrome.zip` 이 두 번. zip 이 셋인 지금 옛 glob 은 `unzip` 이 둘째 인자를 멤버 패턴으로 읽는
  방식으로 조용히 틀린다.
- **gecko id 일치**: `amo-submit.yml` 의 `FIREFOX_EXTENSION_ID` 값이
  `readBuildFile('firefox', 'manifest.json')` 의 `browser_specific_settings.gecko.id` 와 같다.
- `.gitignore` 에 `.env.submit` 과 `*.xpi`.
- 플로팅 메이저 규칙에 새 파일 둘을 더한다.

**`tests/unit/amo.test.ts`** — `claimSet`(300 초과 throw, 기본 60), `signingInput`(헤더 고정,
base64url 무패딩), `endpoints`, `parseHash`(다른 알고리즘 throw), `readSignedFile` 판정표 전부
(채널 불일치·public·unreviewed·disabled·미지의 값), `archiveNames`, `issuerLooksValid`,
`manifestMatches`.

**`tests/unit/storeListing.test.ts`** — `docs/store/amo/description.en.md` 에 같은 셋: verbatim
목록(같은 여섯), Markdown 없음, 모양 스냅샷. 그리고 하나 더: 문안에 `Chrome-only` 가 있다 —
브릿지를 Firefox 사용자에게 파는 문안이 다시 들어오면 여기서 빨개진다.

**변이 검증** (플랜의 과제로): `readSignedFile` 이 미지의 상태를 `ready` 로 읽게 바꾸면 amo.test 가
빨갛다; `cws-submit.yml` 의 패턴을 `*.zip` 으로 되돌리면 storeSubmit.test 가 빨갛다;
`amo-submit.yml` 의 id 마지막 글자를 바꾸면 빨갛다.

## 11. 저장소 밖 — 환경과 첫 제출

**환경 (플랜의 마지막 과제, `gh` 로, 값은 출력하지 않는다):**

```bash
gh api -X PUT repos/say8425/headerlab/environments/firefox-amo \
  -F can_admins_bypass=false \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/say8425/headerlab/environments/firefox-amo/deployment-branch-policies \
  -f name=main -f type=branch
op read 'op://Personal/Firefox AMO Token/username' | gh secret set FIREFOX_JWT_ISSUER --env firefox-amo
op read 'op://Personal/Firefox AMO Token/password' | gh secret set FIREFOX_JWT_SECRET --env firefox-amo
gh variable set FIREFOX_CHANNEL --env firefox-amo --body listed
```

확인은 `gh secret list --env firefox-amo`(이름과 시각만)와 환경 조회 (`can_admins_bypass: false`,
브랜치 정책 `main` 하나). `chrome-web-store` 와 같은 모양이다.

**첫 제출 (오너, `docs/store/amo/checklist.md`):** 계정 절차 → `pnpm zip` 으로 두 zip → Developer
Hub 에서 "On this site" 로 두 zip 업로드 → 리스팅 필드·개인정보 본문·리뷰어 노트 → 제출. 그 뒤
`pnpm amo:probe` 로 `readSignedFile` 이 읽을 필드가 응답에 실제로 있는지 본다. 그때부터 릴리스 PR
머지가 AMO 제출까지 한다.

## 12. 결정 기록

| 결정 | 이유 | 틀리면 드는 비용 |
| --- | --- | --- |
| 접근법 A — 재사용 워크플로 + `wxt submit` (B: 손수 클라이언트, C: 릴리스 잡 안에서 직접) | 요청이 `wxt submit`; B 는 있는 것을 다시 쓰는 일, C 는 시크릿을 `contents: write`·`id-token: write` 잡에 넣고 재시도 경로가 없다 | 제출 잡에 `pnpm install` 이 필요해 시크릿을 쥔 잡이 커진다 |
| 첫 제출은 사람 (오너 결정 2026-09-10) | `wxt submit` 은 애드온을 만들지 못하고, 약관·2FA 는 어차피 웹 | 한 번의 수동 작업 |
| unlisted 는 채널 선택 + 서명 xpi 첨부, `update_url` 없음 (오너 결정) | 채널을 바꿀 수 있게 하되 자체 배포 인프라(갱신 매니페스트 호스팅, 채널별 manifest)는 만들지 않는다 | unlisted 로 설치한 사용자는 자동 갱신이 없다 — Chrome 의 "릴리스 페이지" 경로와 같은 성격 |
| 재현 검사 생략 (오너 결정) | main 푸시마다 1분 | AMO 리뷰가 diff 로 반려하면 그것이 첫 신호이고, 태그는 이미 잘린 뒤다 |
| sources zip 을 릴리스에 첨부 | Mozilla 가 본 것 = 누구나 받는 것; AMO 잡이 재빌드하지 않는다 | 릴리스 페이지에 ~1.5 MB 하나 더 |
| `docs/**` 만 제외 | 빌드 입력이 없고 PNG 1.2 MB; `packages/**` 는 workspace 가 이름으로 부른다 | 리뷰어가 CLAUDE.md 를 본다 — 공개 파일이다 |
| `store-submit.yml` → `cws-submit.yml` | 스토어가 둘 | CLAUDE.md·체크리스트·테스트의 언급 열 곳 남짓을 같이 고친다 |
| `amo-submit.mjs` 가 로컬·CI 의 하나뿐인 진입점 | `pack-crx.mjs` 와 같은 모양; 채널·아카이브·검사 로직이 YAML 과 스크립트에 두 번 있지 않다 | 워크플로 단계 하나가 셋을 한다 — 로그가 그만큼 길다 |
| 채널 기본 `listed`, 환경 변수로 바꾸고 dispatch 입력이 우선 | 릴리스는 채널을 모른다; 사람이 바꿀 자리는 하나 | — |
| 아이콘은 full-bleed `active-128.png` | AMO 는 패딩을 요구하지 않는다 | 두 스토어 아이콘이 다르게 보인다 — `store-icon-128.png` 로 바꾸면 끝 |
| 스크린샷은 Chrome 다섯 장 재활용 (오너 지시) | 1280×800 이 AMO 권장과 같다 | 브릿지 행이 찍혀 있다; §13 |
| 카테고리 하나 (`web-development`) | Chrome 도 하나 | 둘째는 오너가 Hub 에서 |
| 개인정보 정책은 PRIVACY.md 그대로 | AMO 필드가 제한된 Markdown 을 받는다 | 첫 제출 때 렌더링을 눈으로 본다 |
| README 뱃지·링크는 게시 뒤 | 없는 리스팅을 가리키면 거짓 | 체크리스트 §7 이 diff 를 든다 |

## 13. 범위 밖과 후속

- 첫 제출 자동화 (`POST /api/v5/addons/addon/` 과 previews) — 한 번 쓰고 버릴 수백 줄.
- `update_url` 자체 배포 — 갱신 매니페스트 호스팅, 채널별 manifest 모드.
- sources zip 재현 검사 (오너 결정으로 생략; 다시 열 조건은 AMO 반려 한 번).
- Firefox 에서 찍은 스크린샷 다섯 장 — `tests/support/firefox.ts` 의 `screenshot()` 이 이미 있다.
- README 다섯 판의 AMO 뱃지·링크·Install 첫 경로 — `docs/store/amo/checklist.md` §7.
- GitHub 저장소 설명 ("Chrome extension (MV3)…") — 오너가 `gh repo edit --description` 으로.
- 둘째 카테고리, support email — 오너의 Hub 결정.

## 14. 릴리스 산술

이 브랜치는 `feat:` 로 스쿼시되고 `packages/headerlab` 에 닿지 않는다. 열려 있는 #82
(`extension 1.8.0`) 가 흡수하고, #87 (`cli 0.4.0`) 은 그대로다.

**순서가 있다.** `amo-submit.yml` 은 애드온이 있어야 돌고, AMO 는 같은 버전을 두 번 받지 않는다.
그래서 첫 수동 제출은 **#82 를 머지하기 전에**, main 의 `pnpm zip` 이 만드는 `1.7.0` 아카이브로
한다 (Firefox 지원은 이미 main 에 있고 버전 문자열만 1.7.0 이다). 그러면 1.8.0 이 CI 가 올리는 첫
버전이 된다. 반대로 #82 를 먼저 머지하면 1.8.0 의 `amo-submit` 잡은 404 로 빨개지고 — 설계된
실패다, 애드온이 없다 — 그 뒤 1.8.0 을 손으로 올리면 dispatch 재실행은 "버전이 이미 있다" 로
막히므로, 자동 경로의 첫 실행이 1.9.0 으로 밀린다. §11 의 환경도 같은 이유로 **이 PR 이 머지되기
전에** 만든다: 없으면 GitHub 이 이름만 같은 빈 환경을 조용히 만들고 거부 단계가 빈 시크릿을 잡아
빨개진다 — 조용하지는 않지만 한 릴리스를 낭비한다.
