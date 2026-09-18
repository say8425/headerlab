# Firefox Add-ons — submission checklist

Run top to bottom, once. Steps 1 and 2 are account work; step 3 is the one
submission a person makes; from step 8 on, merging the release PR does it.

Everything to paste lives beside this file:

| File | Covers |
| --- | --- |
| `listing.md` | Every field on the form, the images, the screenshot captions |
| `description.en.md` | The detailed description |
| `reviewer-notes.md` | Notes to Reviewer — how to rebuild the package |
| `../../../PRIVACY.md` | The privacy policy, pasted as text |
| `../assets/` | The five screenshots, shared with the Chrome listing |

---

## 1. Account and API key

- [ ] A Firefox Account, signed in at <https://addons.mozilla.org/developers/>.
      AMO requires two-factor authentication on developer accounts; set it up
      before the first submission rather than being stopped by it mid-form.
- [ ] Accept the **Firefox Add-on Distribution Agreement** the first time the
      Hub asks; AMO's documentation has uploads wait on it. What was measured
      is only the account's state: on 2026-09-09 the profile endpoint answered
      `is_addon_developer: false`, which is what "never submitted" looks like.
- [x] API credentials — <https://addons.mozilla.org/developers/addon/api/key/>
      — generated 2026-09-09 and stored in 1Password as **Firefox AMO Token**
      (Personal vault): `username` is the JWT issuer (`user:<id>:<key>`),
      `password` is the JWT secret. Measured working the same day: a JWT signed
      with them got `200` from `/api/v5/accounts/profile/`. `pnpm amo:probe`
      reads them from 1Password and asks for the add-on — `404` until step 3
      creates it — measured on 2026-09-11, an authenticated 404, not a 401.
      `op` reads through the 1Password app's CLI integration, so there is no
      `op signin`: the app asks for biometrics on the first read, and `op whoami`
      reporting "not signed in" before that means nothing.

---

## 2. Prepare the archives

- [ ] `pnpm check:all` and `pnpm test:e2e` — the same gates as Chrome.
- [ ] `pnpm zip` → three files. `wxt zip` does not remove older ones, so
      every command below names the current version's archive rather than
      globbing for it — a leftover would otherwise answer instead:

      ```bash
      V=$(node -p "require('./package.json').version")
      pnpm zip
      ls -l .output/headerlab-"$V"-*.zip
      ```

      Expect `headerlab-$V-chrome.zip`, `-firefox.zip` and `-sources.zip`.

- [ ] Confirm the Firefox archive carries the gecko block and the two
      install-time permissions, and no `host_permissions`:

      ```bash
      V=$(node -p "require('./package.json').version")
      unzip -p ".output/headerlab-$V-firefox.zip" manifest.json | python3 -m json.tool
      ```

      `browser_specific_settings.gecko.id` must be `headerlab@say8425.github.io`,
      `permissions` exactly `["storage", "declarativeNetRequestWithHostAccess"]`,
      `optional_permissions` absent. `tests/unit/manifest.test.ts` pins all of
      it, so a green `pnpm check` already proves this; the command is here
      because it is the one claim the listing rests on.

- [ ] Confirm the sources archive carries no `docs/` and does carry the lockfile:

      ```bash
      V=$(node -p "require('./package.json').version")
      unzip -Z1 ".output/headerlab-$V-sources.zip" | grep -c '^docs/'        # must be 0
      unzip -Z1 ".output/headerlab-$V-sources.zip" | grep -c '^pnpm-lock.yaml$'  # must be 1
      ```

      Both lines, not just the first: an absence check alone passes on a
      missing archive.

---

## 3. The first submission — by hand, and the order matters

`wxt submit` begins by fetching the add-on, so it cannot create one; and AMO
refuses a version it already holds. So:

- [ ] **Do this before the next extension release PR is merged** — as of
      2026-09-11 that is #82, `extension 1.8.0`. The archives from step 2 carry
      the version `main` is at, 1.7.0 (the Firefox build is on `main`; only the
      version string is old), and that is the version to submit by hand. 1.8.0
      is then the first one `amo-submit.yml` uploads. Merge #82 first and its
      AMO job goes red on a 404 — designed: there is no add-on — and once 1.8.0
      has been uploaded by hand instead, a dispatch re-run is refused as a
      duplicate, so the automated path's first run slips to the release after.
      `pnpm amo:probe` says which versions AMO already holds.
- [ ] Developer Hub → **Submit a New Add-on** → **On this site** (listed) or
      **On your own** (unlisted — the signed file comes back to you; see §8).
      Upload `headerlab-<version>-firefox.zip`.
- [ ] When asked whether the add-on uses build tools: **yes**, and upload
      `headerlab-<version>-sources.zip`. This is required, not optional — the
      package is bundled — and a reviewer rebuilds it (`reviewer-notes.md`).
- [ ] Let validation finish before filling anything in.

---

## 4. Describe the add-on

Work through `listing.md`. In short:

- [ ] Name comes from the manifest; leave it.
- [ ] Add-on URL: `headerlab`.
- [ ] Summary is pre-filled from the manifest; leave it (119 of 250).
- [ ] Description: `description.en.md`, as plain text.
- [ ] Categories: **Web Development**. Second slot: owner's call.
- [ ] Support website: `https://github.com/say8425/headerlab/issues`.
      Homepage: `https://github.com/say8425/headerlab`. Support email: owner's
      call; none on Chrome.
- [ ] License: **Apache License 2.0**.
- [ ] Icon: `public/icon/active-128.png` (`listing.md` says why not the padded
      one). Screenshots: the five, in order, with the captions from `listing.md`.
- [ ] Compatibility: Firefox desktop only.

---

## 5. Privacy policy

- [ ] Paste the block from `privacy.en.md` into the **Privacy Policy** field,
      or send it with the call `listing.md` names. It is text here, not a URL,
      and AMO renders no Markdown — measured on 2026-09-18 across six listed
      add-ons with a policy, not one uses any. Edit `../../../PRIVACY.md`
      first and carry the change into `privacy.en.md`; a test holds the two
      together.
- [ ] The data-collection declaration needs nothing from you: it comes from the
      manifest (`data_collection_permissions: none`) and the listing renders it
      as "does not collect data".

---

## 6. Notes to reviewer

- [ ] Paste `reviewer-notes.md`'s block. The build instructions are also in the
      README inside the sources archive, under "Build it yourself" — a reviewer
      who reads only the archive still finds them.

---

## 7. After it is published

Done on 2026-09-18, the day the first version was approved. Kept because a
second listing would need all of it again.

- [x] The five READMEs carry a Firefox Add-ons badge beside the Chrome one:

      ```markdown
      [![Firefox Add-ons](https://img.shields.io/amo/v/headerlab?logo=firefox&logoColor=%23FF7139&color=%23FF7139&label=firefox%20add-ons)](https://addons.mozilla.org/firefox/addon/headerlab/)
      ```

- [x] Their Install sections open with both stores, carry a `### Firefox Add-ons`
      route beside the Chrome one, and keep the temporary-load instructions for
      people running a build of their own rather than as a warning about an
      unsigned zip.
- [x] `README.md` in this directory names the listing, its id and its slug
      instead of saying it does not exist.
- [x] The icon and the homepage URL, filled through the API.
- [ ] The screenshots: **three of five** are up with their captions
      (`scoped`, `permission`, `blocked`), measured on the listing. AMO's upload
      throttle answered the fourth with an hour's wait, so `allsites` and `dark`
      follow once it lifts. `listing.md` has the calls and the throttle.
- [ ] The privacy policy is still empty on the listing (`has_privacy_policy`
      is `false`). AMO takes it as text rather than as a URL, and `PRIVACY.md`
      is Markdown: decide between pasting it as it is and keeping a plain-text
      rendition beside it. §5 says what the field is for.
- [ ] `gh repo edit --description` — the repository description still names
      Chrome alone.

---

## 8. Releasing from here on

Merging the release PR is the whole of it. `release-please.yml` cuts the tag,
attaches the three archives, and calls `cws-submit.yml` and `amo-submit.yml`
side by side. For Firefox:

- **A green run means AMO validated the upload and created the version.** On
  `listed`, approval is Mozilla's and arrives by email. On `unlisted`, the run
  has also waited for the signature and attached `headerlab-<v>-firefox.xpi`
  to the release.
- **The channel is the `firefox-amo` environment's `FIREFOX_CHANNEL` variable**
  (`listed` when unset). A manual `workflow_dispatch` run takes the channel as
  an input and wins over the variable. Unlisted installs do not auto-update:
  the manifest carries no `update_url`, by decision (spec §12).
- **Never re-cut a version to fix a store failure.** Same table as Chrome:

  | The failure was in | Do this |
  | --- | --- |
  | AMO's write throttle (`429`, "Expected available in N seconds") | Wait out the N it names, **ask `pnpm amo:probe` what AMO now holds**, then re-run `amo-submit.yml` against the same tag with `ref` empty. On 1.8.0 the refused call was the version-create, with the upload and validation already past, so the re-run repeated the whole flow and duplicated nothing. Read that as one measurement rather than a rule: a `429` inside the unlisted channel's signature poll arrives *after* the version exists, and a blind re-run would then meet the duplicate refusal the row below describes |
  | the network, the credentials, AMO | Re-run `amo-submit.yml` against the same tag, `ref` empty. AMO refuses a duplicate version, so a run that failed *after* creating the version cannot be repeated — check `pnpm amo:probe` first |
  | the scripts themselves | Fix on `main`, then re-run with `ref: main` while `main` still carries the tag's version |
  | the scripts, but `main` has moved on | Neither. `gh release download extension-v<v> -p '*-firefox.zip' -p '*-sources.zip' -D .output`, then `node scripts/amo-submit.mjs --channel <c> --expect-version <v>` locally, `<c>` being the environment's `FIREFOX_CHANNEL` — the script defaults to `listed` and never reads that variable itself — with the credentials read from 1Password |

One-time setup, outside the repository, done 2026-09-11 with the secrets piped
straight from 1Password: environment `firefox-amo` with
deployment branch rule `Branch → main` and "Allow administrators to bypass"
off, secrets `FIREFOX_JWT_ISSUER` and `FIREFOX_JWT_SECRET` piped from the
1Password item, variable `FIREFOX_CHANNEL=listed` — the same shape as
`chrome-web-store`. Values never touch the terminal:

```bash
gh api -X PUT repos/say8425/headerlab/environments/firefox-amo -F can_admins_bypass=false \
  -F 'deployment_branch_policy[protected_branches]=false' \
  -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api -X POST repos/say8425/headerlab/environments/firefox-amo/deployment-branch-policies \
  -f name=main -f type=branch
op read 'op://Personal/Firefox AMO Token/username' | gh secret set FIREFOX_JWT_ISSUER --env firefox-amo
op read 'op://Personal/Firefox AMO Token/password' | gh secret set FIREFOX_JWT_SECRET --env firefox-amo
gh variable set FIREFOX_CHANNEL --env firefox-amo --body listed
```

**The environment must exist before this change's first release runs.** A
workflow naming an environment that does not exist gets an empty one created
for it, with no rules and no secrets; the refusal step then fails the job on
the empty issuer — loudly, but after the tag.

---

## Things that will not happen, so do not wait for them

- **`amo-submit.yml` will not create the add-on.** That is §3, once.
- **Nothing here waits for a review verdict.** AMO emails; there is no webhook
  and `wxt submit` returns as soon as the version exists.
- **The sources archive is not checked for reproducibility before the tag.**
  Owner's call (2026-09-10): a reviewer's diff is the first measurement. If
  one ever comes back with differences, that is the day to add the check.
