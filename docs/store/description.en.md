# Detailed description — English (`en`)

Paste the block below into **Store listing → Description**, with the language
dropdown set to English. It is plain text: the store keeps line breaks and
renders nothing else, so the bullets and headings are literal characters.

```text
HeaderLab sets, appends and removes HTTP request and response headers on the sites you choose, using Chrome's own declarativeNetRequest engine. It holds no access to any site until you grant it.

WHAT IT DOES

• Set, append or remove any header, on the request side or the response side.
• Scope by site. Sites are matched by host, so what the popup shows is what goes on the wire.
• Apply everywhere, as an explicit mode. It costs access to all sites, and the switch does not ask for it — a separate Grant button does.
• Filter by request type. Eight of Chrome's resource types, each its own checkbox, main_frame included — which Chrome's own default quietly leaves out.
• Pause everything with one switch. The toolbar icon greys out to match, and stays grey across a restart.

DRIVE IT FROM AN AI CODING AGENT

HeaderLab ships an optional command line tool and a skill for Claude Code and Codex, so an agent can read and change your header rules while it works. Ask in your own words — add an X-Debug header and scope it to staging.example.com, or stop sending Referer to the API — and the result appears in the popup as if you had typed it there.

It costs you no control: the bridge stays off until you flip its switch in the popup, the tool can neither turn itself on nor grant a site — Chrome takes both only from your own click — and it talks over a local socket, never a network.

WHAT IT DOES NOT DO

• No network calls. No analytics, no telemetry, no remote configuration, no update pings.
• No content scripts. Nothing is injected into any page, and the extension never sees a page's contents.
• No remote code, no CDN, no web fonts, no remote images. Nothing is fetched from outside the package.
• Nothing leaves your machine. Your rules live in Chrome's own extension storage.

https://github.com/say8425/headerlab

Open source, Apache-2.0.
```

## Notes for whoever edits this

**The store's own instruction for this field is "focus on explaining what the
item does and why users should install it."** That is why the agent bridge sits
in the middle under a heading of its own rather than last under an "optional"
one — it is the thing here a popup-only header editor cannot offer, and burying
it spent the listing's best argument on its least-read line.

**This listing is deliberately short, and the cuts were the owner's, 2026-08-22.**
Four things went in one pass: an opening paragraph of concrete use cases, the
whole "nothing fails quietly" section, the sentence introducing the repository
URL, and the install-time permission paragraph. Do not restore any of them as a
tidy-up; each was read on screen and removed.

**One of those cuts has a cost worth knowing before you edit around it.** The
permission paragraph was the only place the listing said the extension asks for
nothing at install, and it carried `"storage"` and
`"declarativeNetRequestWithHostAccess"` as literal strings. Both are gone from
the listing, and the two entries pinning them in
`tests/unit/storeListing.test.ts` went with them — a guard whose subject is gone
rather than a guard relaxed. What survives of the trust posture is the first
line's "holds no access to any site until you grant it", the Grant button named
in the all-sites bullet, the four "what it does not do" bullets, and the agent
section stating the bridge's limits in the same breath as its capability. If the
paragraph ever comes back, put those two entries back with it; the lookahead on
`declarativeNetRequest` is still there and its comment says why.

**No competitor is named, deliberately.** The project exists because a widely
used header extension was pulled from the store over a hidden tracker, and that
history is the reason its trust posture is what it is. Naming it in a listing
reads as disparagement under the store's listing policies and buys nothing the
checkable claims above do not already buy. Keep the argument, drop the name.

**Every claim here is verifiable from the package**, which is the point. "No
network calls" is `tests/unit/bundle.test.ts` reading the built bundle; the
manifest's exact permission list is `tests/unit/manifest.test.ts`, still pinned
there even though the listing no longer quotes it; the eight resource types and
`main_frame`'s default are what the screenshots photograph. If a claim stops
being checkable, cut it rather than soften it.

**Keep it out of keyword-spam territory.** The store's listing policy forbids
repeating terms to game search. The header vocabulary here appears because the
sentences need it, not to accumulate matches.
