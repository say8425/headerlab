import { z } from 'zod';

/**
 * zod, configured once, before any schema exists.
 *
 * zod 4 builds a faster parser for each `z.object` by compiling a function from
 * a string, but only after probing whether that is allowed:
 * `try { new Function('') } catch { … }`. An extension page's MV3 content
 * security policy forbids it, so on both browsers the probe can only fail — and
 * zod's own source notes that a strict CSP still reports the caught attempt as a
 * `securitypolicyviolation`. It is also what Firefox Add-ons' validator flagged
 * as "The Function constructor is eval" in both bundles of the 1.7.0 upload.
 *
 * `jitless` skips the probe and the compilation outright. zod reads the flag
 * when a `z.object` is *constructed* (`v4/core/schemas.js`), not when it parses,
 * so it has to be set before either schema module builds anything. That is why
 * `lib/model/schema.ts` and `lib/bridge/protocol.ts` import `z` from here rather
 * than from 'zod': an imported module's body runs before its importer's, so the
 * flag is set first whichever of the two loads first. The zod-config unit test holds
 * every shipped file to that. (Named in prose, not by path: a shipped source quoting a
 * path under the test tree is what the build-freshness carve-out guard refuses.)
 *
 * The probe's code stays in the bundle — zod ships it unconditionally — so the
 * validator's warning stays too. What goes is the attempt.
 */
z.config({ jitless: true });

export { z };
