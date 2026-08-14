# headerlab

A CLI that drives the [HeaderLab Chrome extension](https://github.com/say8425/headerlab)
over native messaging — scope a rule to sites, add/remove/toggle header rules, pause or
resume the whole rule set, or replace stored state wholesale, all from a terminal. Every
reply is one JSON object on stdout, success or failure, with the exit code following it.

```bash
npm i -g headerlab
```

That puts `headerlab` on your PATH. It has zero runtime dependencies.

## The CLI cannot turn the bridge on

`chrome.permissions.request()` requires a user gesture to resolve — Chrome enforces
this, HeaderLab does not choose it. There is no `headerlab bridge enable`, and there
will not be one that works: a person has to press **Enable** on the popup's bridge row,
behind Chrome's own consent dialog, before any command below can reach the extension.

**Turning it on** is three steps:

1. Press **Enable** on the popup's bridge row.
2. Run `headerlab bridge install --extension-id <id>`, taking the id from
   `chrome://extensions`.
3. The popup now reads **Bridge live**.

The installer echoes back the id it used. Nothing inside the CLI can check that against
what Chrome actually loaded, and the manifest it writes accepts exactly one origin with no
wildcard — so if the two disagree, Chrome reports it with the same message it uses for a
manifest that is not there at all. Comparing the echoed id against the extensions page is
the only check there is.

If you loaded the extension unpacked, `--extension-id` still works and is still the
safer instruction; `--load-path <dir>` computes the id from that directory's path
instead, and a symlink or a differently spelled path to the same directory produces a
different id.

## Verifying what you installed

Releases published from GitHub Actions carry
[provenance](https://docs.npmjs.com/generating-provenance-statements) — a signed statement
of which commit and which workflow built the tarball:

```bash
npm audit signatures
```

**The first published version is the exception, and it says so rather than hoping you do
not check.** npm is retiring the tokens that let CI publish without a one-time password
(direct publishing goes away around January 2027), and npm only lets you configure the
replacement — trusted publishing over OIDC — for a package that already exists. So the
first version was published by hand and has no attestation. Every version after it is built and
signed by the workflow in this repository.

This extension exists because [ModHeader](https://github.com/modheader) was pulled from
the Chrome Web Store after a hidden tracker was found in it. A CLI that can change your
browser's headers should be checkable by someone who trusts none of its authors, and that
command is how.

## When the bridge stops working after an upgrade

`headerlab bridge install` writes a small launcher that names this package's host entry
by absolute path. Anything that moves or removes the installed copy invalidates it —
`npm uninstall -g headerlab`, `npm i -g headerlab@next`, or an nvm switch that relocates
the global prefix. Chrome reports the resulting failure the same way it reports every
other native-messaging problem, so nothing will tell you which one it was except:

```bash
headerlab bridge status
```

It reports `entryMissing` when the launcher points at a file that is no longer there.
Re-running `headerlab bridge install` fixes it.

## Commands

`headerlab site add|rm|all-sites`, `headerlab rule add|rm|toggle`, `headerlab pause`,
`headerlab resume`, `headerlab state set <file|->`, and `headerlab bridge
install|uninstall|status` for managing the native messaging host manifest itself.

The full reference — error codes, flags, and what each command does and does not do —
is in the [extension's README](https://github.com/say8425/headerlab#agent-bridge) and in
[the agent skill](https://github.com/say8425/headerlab/blob/main/packages/plugin/skills/headerlab/SKILL.md).

## License

Apache-2.0. See [LICENSE](./LICENSE).
