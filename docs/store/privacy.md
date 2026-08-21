# Chrome Web Store — Privacy tab

Every answer the **Privacy practices** tab asks for. Paste the quoted blocks;
they are written to be read by a reviewer in a hurry.

One judgment call in here is **not** mine to make and is marked as such — see
"The one decision to make yourself" at the end.

---

## Single purpose

> HeaderLab modifies HTTP request and response headers for websites the user
> has explicitly chosen. Every part of the interface serves that one purpose:
> the rule editor defines the header changes, the site list scopes them, the
> request-type filter narrows which requests they touch, and the pause switch
> turns them off. The extension does nothing else — it has no other feature, no
> content of its own, and no second mode of operation.

---

## Permission justifications

The manifest declares two permissions at install and two more as optional. Each
needs its own box filled in.

### `storage`

> Stores the user's own configuration: their header rules, the list of sites
> those rules are scoped to, the request-type filter, and whether the rule set
> is paused. Manifest V3 suspends the service worker routinely, so without
> persistent storage the extension would forget every rule the user had made.
> Everything written is written with `chrome.storage` and stays on the device;
> the extension makes no network calls of any kind.

### `declarativeNetRequestWithHostAccess`

> This is the API that performs the extension's single purpose. It registers the
> user's header rules with Chrome's own network stack so that Chrome applies
> them.
>
> The `WithHostAccess` variant is chosen deliberately over plain
> `declarativeNetRequest`: it applies a rule only on hosts the user has already
> granted access to, so a rule cannot take effect on a site the user has not
> approved. It also never delivers request or response contents to the
> extension — the header change happens inside the browser, and the extension
> learns nothing about the traffic.

### Host permission: `<all_urls>` (declared under `optional_host_permissions`)

> Not granted at install, and not requested by default. It backs one feature —
> "All sites" mode — for users who want their rules to apply everywhere instead
> of to a named list of hosts.
>
> Turning the mode on does not request the permission. A separate Grant button
> does, and until the user presses it the popup states that the mode is not in
> effect and no rules are going out. A user who never turns the mode on is never
> asked for this permission.
>
> The manifest has to declare the origin as optional because Chrome refuses
> `permissions.request()` for any origin the manifest did not declare. Declaring
> it grants nothing on its own.

### `nativeMessaging` (declared under `optional_permissions`)

> Not granted at install. It backs an optional feature that lets the user apply
> rule changes from a terminal instead of the popup — useful for scripted setups
> and for a local coding assistant acting on the user's behalf.
>
> The permission is requested only when the user turns on the "Agent bridge"
> switch in the popup. It connects to a native messaging host that the user
> installs themselves as a separate program; that program listens on a unix
> domain socket inside the user's own directory and opens no network connection.
> If the switch is never turned on, none of this code runs.

---

## Remote code

**Answer: No, I am not using remote code.**

If the reviewer asks for justification:

> All executable code ships inside the package. Nothing is fetched, evaluated or
> loaded from a remote source at any point.
>
> The built bundle contains no call to `fetch`, `XMLHttpRequest`, `WebSocket`,
> `sendBeacon` or `EventSource`. This is asserted against the build by an
> automated test in the repository, and it is checkable by anyone from source:
> `pnpm build` then
> `grep -rE 'fetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource' .output/chrome-mv3`
> returns nothing.

---

## Data use

### What to disclose

The store's rule is explicit and catches a lot of developers out:

> Extensions are required to disclose how they handle user data, **even when
> data is processed or stored locally on a user's device and is not transmitted
> to external servers or third parties.**

So "we store it locally and send it nowhere" is a disclosure, not an exemption.
It is also why the privacy policy URL below is required rather than optional.

### Certifications — tick all three

All three are true without qualification:

- ☑ I do not sell or transfer user data to third parties, apart from the
  approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my
  item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for
  lending purposes

### Data types

| Category | Answer | Why |
| --- | --- | --- |
| Personally identifiable information | **No** | No name, address, email or identifier is asked for or derived. No accounts and no sign-in. |
| Health information | **No** | — |
| Financial and payment information | **No** | — |
| Authentication information | **See the decision below** | The extension provides a free-text header value field, and the commonest real use of it is an `Authorization` token. |
| Personal communications | **No** | — |
| Location | **No** | — |
| Web history | **No** | The extension is never told which pages are visited. It knows only the hostnames the user typed into it. |
| User activity | **No** | No clicks, keystrokes, mouse movement or usage events are recorded. |
| Website content | **No** | Nothing is injected into any page. `declarativeNetRequestWithHostAccess` never hands request or response contents to the extension. |

---

## Privacy policy URL

**Required**, for the reason quoted above. Submit:

```
https://github.com/say8425/headerlab/blob/main/PRIVACY.md
```

That file is in this repository. Keep it and the disclosures on this page saying
the same thing — the store expects the two to agree, and a mismatch is a common
rejection.

---

## The one decision to make yourself

**Should "Authentication information" be ticked?**

HeaderLab does not collect credentials in the ordinary sense. It has no login,
solicits nothing, and reads nothing from any page. But it does put a free-text
box on screen and store what is typed there, and the single commonest thing
people type into a header-editing tool is a bearer token. That value is then
attached by Chrome to requests going to the host the user scoped it to.

**The case for ticking it.** The store's wording covers handling, and handling
covers local storage. A user's auth token really is sitting in
`chrome.storage.local`, unencrypted, because the extension put it there. Ticking
it and explaining the situation is the reading that cannot be called a
non-disclosure later.

**The case against.** The extension neither obtains nor interprets the value —
it is user-authored configuration, the way a text editor's file contents are not
the editor's data collection. Ticking it puts "collects authentication
information" on a public listing for an extension that transmits nothing to
anyone, which misleads in the opposite direction.

**My recommendation is to tick it**, and to say in the box beside it:

> The extension provides a field in which a user may enter any HTTP header value,
> including an authorization token. Whatever is entered is stored locally in
> Chrome's extension storage and attached to requests going to the hosts that
> user has explicitly scoped the rule to. It is never transmitted to the
> developer or to any third party, and the extension makes no network calls. The
> extension does not read, parse or derive credentials from any page.

Ticking costs a line on the listing. Not ticking risks an argument you would be
having after the fact, about a box you could have ticked in ten seconds. But it
is your listing and your call — `PRIVACY.md` describes the behaviour honestly
either way.
