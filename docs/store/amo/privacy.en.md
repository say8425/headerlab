# Privacy policy — Firefox Add-ons, English

Paste the block below into **Manage Authors & Licenses → Privacy Policy** in the
Developer Hub, or send it with `PATCH /api/v5/addons/addon/headerlab/eula_policy/`
(`listing.md` has the call). It is `../../../PRIVACY.md` as plain text.

**Why a second copy at all.** Chrome's form takes a URL and gets `PRIVACY.md`
on `main`; AMO's takes the text itself, and it renders no Markdown — a `#` or a
backtick reaches the reader as itself. Measured on 2026-09-18 across six listed
add-ons with a privacy policy (uBlock Origin, Privacy Badger, Dark Reader,
Bitwarden, Ghostery, and Multi-Account Containers, which has none): **not one
uses Markdown.** They are plain paragraphs with capitalised headings, and two
carry raw `<a href>` links. This file follows them.

**Edit `PRIVACY.md` first, then carry the change here.**
`tests/unit/storeListing.test.ts` holds this file to the same no-Markdown rule
as the store descriptions, and requires both files to name the same things —
the API, the two storage areas, the Grant button, the two extension pages, the
permission the Firefox build does not declare — so a claim dropped from either
side turns it red.

```text
HEADERLAB PRIVACY POLICY

Last updated: 2026-09-11

HeaderLab is a browser extension for Chrome and Firefox that adds, changes and removes HTTP request and response headers on websites you choose.

Nothing HeaderLab stores is sent to its developer, to any server, or to any third party. The extension makes no network calls of any kind.

This policy is short because there is little to describe. It is written anyway because both stores ask for one. The Chrome Web Store requires an extension to disclose how it handles user data "even when data is processed or stored locally on a user's device and is not transmitted to external servers or third parties", which is exactly HeaderLab's situation, and Firefox Add-ons takes the policy as text on this listing.

WHAT HEADERLAB STORES

All of it is created by you, in the extension's own popup, and all of it stays on your computer in your browser's extension storage: chrome.storage.local in Chrome, browser.storage.local in Firefox.

• Header rules. The header name, the value, whether the rule applies to the request or the response, whether it sets, appends or removes, and whether it is switched on.
• The site list. The hostnames you have scoped your rules to, and whether "All sites" mode is on.
• The request-type filter. Which of the browser's request types your rules apply to.
• Switch positions. Whether the whole rule set is paused, and, in Chrome only, whether the optional agent bridge is enabled.
• The last error, if a rule set failed to register, so the popup can tell you why. This is the browser's own message, held in session storage and gone when the browser closes.

There are no accounts, no sign-in, and no identifiers of any kind. HeaderLab does not know who you are.

WHAT HEADERLAB DOES NOT COLLECT

• No analytics or telemetry. No usage statistics, no crash reports, no installation pings.
• No browsing history. HeaderLab is never told which pages you visit. It only knows the hostnames you typed into it yourself.
• No page contents. Nothing is injected into any page. Headers are changed by the browser's own declarativeNetRequest engine, which applies your rules inside the browser and never hands request or response contents to the extension.
• No remote code. Nothing is downloaded or executed from outside the installed package.

The shipped bundle contains no call to fetch, XMLHttpRequest, WebSocket, sendBeacon or EventSource. You do not have to take that on trust: build the extension from source and search both build outputs. An automated test asserts the same thing against every build. On Firefox Add-ons, the listing's data-collection declaration, none, comes from the extension's own manifest rather than from a form.

ONE THING WORTH UNDERSTANDING

A header value you enter is sent to the sites you scope it to. That is what the extension is for. If you create a rule that adds an Authorization header and scope it to api.example.com, the browser attaches that header to requests going to api.example.com, exactly as you asked.

Two consequences follow, and neither is hidden.

• You decide the destination. A rule applies only to hosts you have granted access to, one at a time, through the Grant button in the popup. The value goes to that site and nowhere else. It is never sent to the developer.
• Values are stored as you typed them. Your browser's extension storage is not encrypted by HeaderLab. Anyone with access to your browser profile on your computer can read the values you have saved. If a credential is one you would not want sitting in a local file, use a short-lived one.

SITE ACCESS

HeaderLab requests no host access when it is installed. Access to a site is granted by you, per site, at the moment you press Grant, and the browser, not HeaderLab, records that grant. You can withdraw it at any time, from about:addons in Firefox or chrome://extensions in Chrome, without uninstalling anything.

"All sites" mode is an explicit choice that needs access to all sites. Turning the switch on does not request that access. A separate Grant button does, and until you press it the popup says the mode is not in effect.

THE OPTIONAL AGENT BRIDGE

Chrome only. In Chrome, HeaderLab can optionally be driven from a terminal, so that you, or a coding assistant working on your behalf, can change rules without opening the popup. It is off unless you turn it on, and it needs a separate helper program that you install yourself. When it is on, the extension talks to that program through Chrome's native messaging, and the program listens on a unix domain socket inside your own user directory. No network socket is involved and nothing leaves your machine. If you never turn the switch on, none of it runs.

The Firefox build does not offer the bridge and does not declare the nativeMessaging permission, because Firefox closes native-messaging ports when an extension's event page goes idle. The popup on Firefox shows no bridge switch.

RETENTION AND DELETION

Data lives until you remove it. Deleting a rule removes it. Removing a site removes it. Uninstalling HeaderLab removes everything the browser was holding for the extension. There is no copy anywhere else to ask about.

CHILDREN

HeaderLab is a developer tool. It is not directed at children and collects nothing from anyone.

CHANGES

If this policy changes, the new version is committed to the repository below and the date at the top changes with it. The file's history is the changelog.

CONTACT

Questions, or anything in this document that looks wrong:
https://github.com/say8425/headerlab/issues

The same policy with its source history:
https://github.com/say8425/headerlab/blob/main/PRIVACY.md
```
