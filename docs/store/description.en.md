# Detailed description — English (`en`)

Paste the block below into **Store listing → Description**, with the language
dropdown set to English. It is plain text: the store keeps line breaks and
renders nothing else, so the bullets and headings are literal characters.

```text
HeaderLab sets, appends and removes HTTP request and response headers on the sites you choose, using Chrome's own declarativeNetRequest engine.

It asks for nothing at install. The manifest requests exactly two permissions — "storage" and "declarativeNetRequestWithHostAccess" — and no host access at all. A site can only be modified after you press Grant on the row that names it, and you can take that back from Chrome at any time.

WHAT IT DOES

• Set, append or remove any header, on the request side or the response side.
• Scope by site. Sites are matched by host, so a port or a path is dropped when the site is added — what the popup shows is what goes on the wire.
• Apply everywhere, as an explicit mode rather than an empty site list. The mode costs access to all sites, and the switch does not ask for it: a separate Grant button does, and until you press it the row says so.
• Filter by request type. Eight of Chrome's resource types, each its own checkbox. main_frame is on by default, because Chrome's own default quietly leaves it out.
• Pause everything with one switch. The toolbar icon greys out to match, and is still grey after the browser restarts.
• Follows your operating system's light or dark setting, before the first frame is drawn.

NOTHING FAILS QUIETLY

Anything that would stop a rule going out is said on that rule's own row and counted beside the Rules heading — a missing permission, an unusable hostname, a header name Chrome will reject.

The count does not flatter itself. A rule scoped only to hosts you have not granted is counted blocked, never live, and the hosts still waiting are named beside it.

That matters more than it sounds. Chrome accepts or rejects a rule set as a whole rather than rule by rule, so one bad row can stop every other row from applying. HeaderLab names the row and says what to do instead.

WHAT IT DOES NOT DO

• No network calls. No analytics, no telemetry, no remote configuration, no update pings.
• No content scripts. Nothing is injected into any page, and the extension never receives a page's contents.
• No remote code. Nothing is fetched or executed from outside the package.
• No external resources. No CDN, no web fonts, no remote images.
• Nothing leaves your machine. Your rules are kept in Chrome's own extension storage.

The source is public, so none of the above has to be taken on trust:
https://github.com/say8425/headerlab

OPTIONAL: DRIVING IT FROM A TERMINAL

A separate, optional command line tool can apply rule changes for you — useful if you would rather type than click, or want an AI coding assistant to set a header while it works. It stays off until you turn on its switch in the popup, it needs a helper program you install yourself, and it talks over a local socket on your own machine rather than over a network. Leave the switch alone and none of it runs.

Open source, Apache-2.0.
```

## Notes for whoever edits this

**No competitor is named, deliberately.** The project exists because a widely
used header extension was pulled from the store over a hidden tracker, and that
history is the reason its trust posture is what it is. Naming it in a listing
reads as disparagement under the store's listing policies and buys nothing the
checkable claims above do not already buy. Keep the argument, drop the name.

**Every claim here is verifiable from the package**, which is the point. "No
network calls" is `tests/unit/bundle.test.ts` reading the built bundle; "exactly
two permissions" is `tests/unit/manifest.test.ts`; the blocked count is what the
third screenshot photographs. If a claim stops being checkable, cut it rather
than soften it.

**Keep it out of keyword-spam territory.** The store's listing policy forbids
repeating terms to game search. The header vocabulary here appears because the
sentences need it, not to accumulate matches.
