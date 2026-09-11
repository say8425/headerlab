# Detailed description — Firefox Add-ons, English

Paste the block below into **Describe Add-on → Description** in the Developer
Hub. It is plain text: AMO renders a little Markdown and Chrome renders none,
so the same plain text goes to both and the bullets and headings are literal
characters here as there.

```text
HeaderLab sets, appends and removes HTTP request and response headers on the sites you choose, using the browser's own declarativeNetRequest engine. It holds no access to any site until you grant it.

WHAT IT DOES

• Set, append or remove any header, on the request side or the response side.
• Scope by site. Sites are matched by host, so what the popup shows is what goes on the wire.
• Apply everywhere, as an explicit mode. It costs access to all sites, and the switch does not ask for it — a separate Grant button does.
• Filter by request type. Eight request types, each its own checkbox, main_frame included — which the browser's own default quietly leaves out.
• Pause everything with one switch. The toolbar icon greys out to match, and stays grey across a restart.

DRIVE IT FROM AN AI CODING AGENT

HeaderLab ships an optional command line tool and a skill for Claude Code and Codex, so an agent can read and change your header rules while it works. That bridge is Chrome-only for now: Firefox closes native-messaging ports when an extension's event page goes idle, so this Firefox build does not offer it and asks for no nativeMessaging permission.

WHAT IT DOES NOT DO

• No network calls. No analytics, no telemetry, no remote configuration, no update pings.
• No content scripts. Nothing is injected into any page, and the extension never sees a page's contents.
• No remote code, no CDN, no web fonts, no remote images. Nothing is fetched from outside the package.
• Nothing leaves your machine. Your rules live in the browser's own extension storage.

https://github.com/say8425/headerlab

Open source, Apache-2.0.
```

## How this differs from the Chrome copy, line by line

`../description.en.md` is the source; this is that text with four lines
changed and one removed. `tests/unit/storeListing.test.ts` lists the four
verbatim and fails on a fifth, so edit the Chrome copy first and carry the
change here — not the other way round.

| Chrome | Here | Why |
| --- | --- | --- |
| using Chrome's own declarativeNetRequest engine | using the browser's own declarativeNetRequest engine | Firefox has the same engine under the same name |
| Eight of Chrome's resource types … which Chrome's own default quietly leaves out | Eight request types … which the browser's own default quietly leaves out | The checklist offers the same eight on both; main_frame is off by default in both |
| Two agent paragraphs: the tool, then "It costs you no control" | One paragraph: the tool, then "That bridge is Chrome-only for now …" | A Firefox user cannot use it; selling it above the fold would be the listing lying. The reason is one clause, measured in docs/research/2026-09-08-firefox-marionette-spike.md |
| Your rules live in Chrome's own extension storage | Your rules live in the browser's own extension storage | `browser.storage.local` on Firefox |

Everything else is byte-identical, on purpose: the owner cut the Chrome copy to
this shape on 2026-08-22 and every argument in `../description.en.md`'s notes
applies here unchanged — no competitor named, every claim checkable from the
package, nothing repeated for search.
