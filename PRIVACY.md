# HeaderLab Privacy Policy

_Last updated: 2026-09-11_

HeaderLab is a browser extension for Chrome and Firefox that adds, changes and
removes HTTP request and response headers on websites you choose.

**Nothing HeaderLab stores is sent to its developer, to any server, or to any
third party.** The extension makes no network calls of any kind.

This policy is short because there is little to describe. It is written anyway
because both stores ask for one. The Chrome Web Store requires an extension to
disclose how it handles user data "even when data is processed or stored locally
on a user's device and is not transmitted to external servers or third parties"
— which is exactly HeaderLab's situation — and Firefox Add-ons takes the same
policy as text on the listing. One document, the same words in both places.

## What HeaderLab stores

All of it is created by you, in the extension's own popup, and all of it stays
on your computer in your browser's extension storage — `chrome.storage.local`
in Chrome, `browser.storage.local` in Firefox:

- **Header rules** — the header name, the value, whether the rule applies to the
  request or the response, whether it sets, appends or removes, and whether it
  is switched on.
- **The site list** — the hostnames you have scoped your rules to, and whether
  "All sites" mode is on.
- **The request-type filter** — which of the browser's request types your rules
  apply to.
- **Switch positions** — whether the whole rule set is paused, and, in Chrome
  only, whether the optional agent bridge is enabled.
- **The last error**, if a rule set failed to register, so the popup can tell you
  why. This is the browser's own message, held in session storage and gone when
  the browser closes.

There are no accounts, no sign-in, and no identifiers of any kind. HeaderLab
does not know who you are.

## What HeaderLab does not collect

- **No analytics or telemetry.** No usage statistics, no crash reports, no
  installation pings.
- **No browsing history.** HeaderLab is never told which pages you visit. It
  only knows the hostnames you typed into it yourself.
- **No page contents.** Nothing is injected into any page. Headers are changed by
  the browser's own `declarativeNetRequest` engine, which applies your rules
  inside the browser and never hands request or response contents to the
  extension.
- **No remote code.** Nothing is downloaded or executed from outside the
  installed package.

The shipped bundle contains no call to `fetch`, `XMLHttpRequest`, `WebSocket`,
`sendBeacon` or `EventSource`. You do not have to take that on trust — build the
extension from source and search both outputs:

```bash
pnpm build
grep -rE 'fetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource' .output/chrome-mv3 .output/firefox-mv3
```

That returns nothing. An automated test asserts the same thing against every
build. On Firefox Add-ons, the listing's data-collection declaration — *none* —
comes from the extension's own manifest rather than from a form.

## One thing worth understanding

**A header value you enter is sent to the sites you scope it to.** That is what
the extension is for. If you create a rule that adds
`Authorization: Bearer abc123` and scope it to `api.example.com`, then the
browser attaches that header to requests going to `api.example.com`, exactly as
you asked.

Two consequences follow, and neither is hidden:

1. **You decide the destination.** A rule applies only to hosts you have granted
   access to, one at a time, through the Grant button in the popup. The value
   goes to that site and nowhere else. It is never sent to the developer.
2. **Values are stored as you typed them.** Your browser's extension storage is
   not encrypted by HeaderLab. Anyone with access to your browser profile on
   your computer can read the values you have saved. If a credential is one you
   would not want sitting in a local file, use a short-lived one.

## Site access

HeaderLab requests no host access when it is installed. Access to a site is
granted by you, per site, at the moment you press Grant, and the browser — not
HeaderLab — records that grant. You can withdraw it at any time, from
`chrome://extensions` in Chrome or `about:addons` in Firefox, without
uninstalling anything.

"All sites" mode is an explicit choice that needs access to all sites. Turning
the switch on does not request that access; a separate Grant button does, and
until you press it the popup says the mode is not in effect.

## The optional agent bridge

**Chrome only.** In Chrome, HeaderLab can optionally be driven from a terminal,
so that you — or a coding assistant working on your behalf — can change rules
without opening the popup.

It is **off** unless you turn it on, and it needs a separate helper program that
you install yourself. When it is on, the extension talks to that program through
Chrome's native messaging, and the program listens on a unix domain socket
inside your own user directory. **No network socket is involved and nothing
leaves your machine.** If you never turn the switch on, none of it runs.

The Firefox build does not offer the bridge and does not declare the
`nativeMessaging` permission: Firefox closes native-messaging ports when an
extension's event page goes idle, so the bridge as designed cannot run there.
The popup on Firefox shows no bridge switch.

## Retention and deletion

Data lives until you remove it. Deleting a rule removes it. Removing a site
removes it. Uninstalling HeaderLab removes everything the browser was holding
for the extension. There is no copy anywhere else to ask about.

## Children

HeaderLab is a developer tool. It is not directed at children and collects
nothing from anyone.

## Changes

If this policy changes, the new version is committed to the repository below and
the date at the top changes with it. The file's history is the changelog.

## Contact

Questions, or anything in this document that looks wrong:

- <https://github.com/say8425/headerlab/issues>
