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
2. Run `headerlab bridge install --load-path <the unpacked extension directory>`.
3. The popup now reads **Bridge live**.

## Commands

`headerlab site add|rm|all-sites`, `headerlab rule add|rm|toggle`, `headerlab pause`,
`headerlab resume`, `headerlab state set <file|->`, and `headerlab bridge
install|uninstall|status` for managing the native messaging host manifest itself. The
full reference — error codes, flags, and what each command does and does not do — lives
in the [extension's README](https://github.com/say8425/headerlab#agent-bridge) and in
`packages/plugin/skills/headerlab/SKILL.md` in the same repository.

## License

Apache-2.0. See [LICENSE](./LICENSE).
