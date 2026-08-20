import { Plus } from 'lucide-react';
import { RuleCard } from './RuleCard';
import { rowKey } from '@/lib/compile/validate';
import type { Diagnostic, HeaderRule } from '@/lib/model/types';
import type { RuleTally } from '@/lib/view/rules';

export interface RulePanelProps {
  rules: readonly HeaderRule[];
  /**
   * The profile `rules` come from. Needed because `byRow` is keyed by profile
   * *and* row — a row id alone is not unique across profiles, and treating it
   * as though it were let one profile's broken row suppress another's healthy
   * header. See `rowKey` in `lib/compile/validate.ts`.
   */
  profileId: string;
  byRow: ReadonlyMap<string, Diagnostic[]>;
  /**
   * Put the caret in the first rule's name on mount.
   *
   * Named for what it does rather than for when it happens. Its predecessor
   * was called `firstRun` and was not: it meant "exactly one rule and it is
   * empty", which is also true for someone who has used the product for a week
   * and deleted everything but one blank row.
   */
  autoFocusFirstRule: boolean;
  onPatchRule: (ruleId: string, patch: Partial<HeaderRule>) => void;
  onDeleteRule: (ruleId: string) => void;
  onAddRule: () => void;
  /** How many rules are going out, and what is holding the rest. */
  tally: RuleTally;
  /**
   * Which of the whole-set verdicts is holding the rules, or null.
   *
   * Read for one thing only: suppressing the "N sites need access" clause when
   * a missing grant is *already* the whole story, so the line does not say it
   * twice.
   */
  blockedBy: 'sites' | 'scope' | 'pause' | 'access' | null;
  /** Scoping hosts that have no permission yet. */
  sitesNeedingAccess: number;
}

/**
 * The right-hand panel, which is nothing but rules.
 *
 * That is the whole point of the split. Every diagnostic the old build stacked
 * above the grid — filter warnings, permission prompts — is about *scope*, and
 * scope lives in the rail, so nothing can push the rules down the screen. Only
 * a problem belonging to a specific rule appears here, inside that rule's own
 * card.
 *
 * Rules are one list in the order the user put them in, not split by request
 * and response: the direction pill on each card says which it is, so grouping
 * would spend a header on something already legible from the row.
 *
 * **The list is the only thing here that scrolls.** The well below the head is
 * sized to the panel rather than to its contents — `flex-1`, never a
 * `max-height`.
 *
 * The head used to carry a second "New rule" button so the action was
 * reachable from any scroll position. It is gone (owner's call): the ghost row
 * at the end of the list is the same action, and two controls doing one thing
 * is a duplicate the head does not need to spend width on. The trade is real
 * and worth naming — with a long list you now scroll to the bottom to add —
 * and it is the accepted one.
 *
 * Both `min-h-0`s below are belt and braces, measured to be exactly that —
 * removing either changes nothing (e2e stays at 7 passed). They are inert for
 * **two different reasons**, and neither one generalises, so each is stated
 * where it applies rather than once for both:
 *
 * - On the `<section>`: `popup-root` is a **row** flex container
 *   (`App.tsx`, `flex h-full`), so a child's automatic minimum size applies to
 *   the *main* axis, which is horizontal. `min-height: auto` was never in play
 *   here at all — the class does nothing because it is on the cross axis. What
 *   is doing real work in that same class list is the `min-w-0` beside it.
 * - On the well: `scroll-list` already declares `min-height: 0` (style.css), so
 *   this is a duplicate of a declaration the utility carries. Independently of
 *   that, the well's `overflow` is not `visible`, which by itself makes its
 *   automatic minimum size zero.
 *
 * **Neither reason is a general rule, and the rail is the counterexample.**
 * `ScopeRail`'s sites column is a child of a *column* flex container whose own
 * `overflow` *is* `visible`, and the three siblings around its list are
 * `shrink-0` — so its automatic minimum size is their full height, and its
 * `min-h-0` is load-bearing. Dropping it puts 676px of rail in a 600px box
 * (measured; e2e guards that case). Reading either bullet above as "a scroll
 * container makes `min-h-0` unnecessary" and applying it there is exactly how
 * that regression gets shipped.
 */
export function RulePanel({
  rules,
  profileId,
  byRow,
  autoFocusFirstRule,
  onPatchRule,
  onDeleteRule,
  onAddRule,
  tally,
  blockedBy,
  sitesNeedingAccess,
}: RulePanelProps) {
  // **The count lives here, not in the rail (owner's call, 2026-08-20).** It
  // was the rail's opening card — a 24px number over a second line naming what
  // was held — and it cost the rail 48px at the top, which is the part of the
  // popup that runs out first as the site list grows. The panel head had the
  // room and was carrying one word.
  //
  // One line, not two: the head is `h-7`, and the count and its detail read as
  // one sentence at this size. The number keeps its own emphasis so "is it on"
  // is still answerable at a glance, and only the detail truncates — the count
  // is short, always relevant, and must never be the half that gets cut.
  const detail: string[] = [];
  if (tally.off > 0) detail.push(`${tally.off} off`);
  if (tally.unfinished > 0) detail.push(`${tally.unfinished} unfinished`);
  if (tally.blocked > 0) detail.push(`${tally.blocked} blocked`);
  // Only when something still goes out; with nothing granted the blocked
  // count above already carries the whole story.
  if (sitesNeedingAccess > 0 && blockedBy !== 'access')
    detail.push(
      sitesNeedingAccess === 1 ? '1 site needs access' : `${sitesNeedingAccess} sites need access`,
    );
  const detailLine = detail.join(' · ');

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-background p-3">
      <header className="mb-2.5 flex h-7 shrink-0 items-center gap-[7px]">
        <h2 className="text-[14px] leading-[18px] font-semibold tracking-[-0.014em] text-foreground">
          Rules
        </h2>
        <span className="flex-1" />
        {/* `tabular-nums` so the number does not jitter the words beside it as
            rules go live one at a time. */}
        <div
          className="flex min-w-0 items-center gap-[5px] text-[11px] leading-[14px] font-medium text-foreground-2 tabular-nums"
          data-testid="readout"
        >
          {tally.total === 0 ? (
            <span className="shrink-0">nothing configured yet</span>
          ) : (
            <>
              {/* The neutral dot the rail's line used to carry, kept with the
                  same meaning: something is switched off by hand. */}
              {tally.off > 0 && (
                <span className="size-1.5 shrink-0 rounded-full bg-input" aria-hidden="true" />
              )}
              <span className="shrink-0">
                <b className="font-semibold text-foreground">{tally.live}</b> of {tally.total} live
              </span>
              {detailLine !== '' && (
                <span className="min-w-0 truncate" data-testid="subcount" title={detailLine}>
                  · {detailLine}
                </span>
              )}
            </>
          )}
        </div>
      </header>

      {/* The well, and the scroll container, as one element.
          Rules are contiguous bands separated by 1px of the well's own tone
          (`RuleCard`'s `mb-px`) rather than by a drawn outline, so the well has
          no padding of its own and no gap between rows — the tone step *is*
          the separator, and a gap would break the band into floating cards
          again. `scroll-list` reserves the scrollbar's 8px in every state, so
          the rows do not jump sideways the moment a tenth rule arrives; here
          that reserve lands inside the well, where it costs no alignment
          against anything outside it. */}
      <div
        data-testid="rule-list"
        className="scroll-list flex min-h-0 flex-1 flex-col rounded-[10px] bg-tray"
      >
        {rules.map((rule, index) => (
          <RuleCard
            key={rule.id}
            rule={rule}
            diagnostics={byRow.get(rowKey(profileId, rule.id)) ?? []}
            autoFocus={autoFocusFirstRule && index === 0}
            onPatch={(patch) => onPatchRule(rule.id, patch)}
            onDelete={() => onDeleteRule(rule.id)}
          />
        ))}

        {/* The next row, not a banner. It keeps the rule row's pitch and its
            left gutter, so the dashed plus sits in the switch's column and the
            row reads as the slot the next rule will occupy — the mockup's own
            reasoning for toning it as a slot (`.te-ghost`) rather than
            outlining it as a button. `shrink-0` because a flex column will
            otherwise squeeze the last child to make room, which is what turns
            a fixed row into a 20px sliver at the bottom of a full list.

            `h-[52px]`. This number has now drifted twice from the minimum a
            `RuleCard` row actually renders at, in two consecutive tasks, in
            opposite directions: 51.5px → 54px when Task 11 stacked the
            operation chip under the direction badge (adding a 2px gap
            between them), then back to 52px when Task 12 fused that same
            gap away (`RuleCard.tsx`'s gutter — badge + chip, no gap between
            them — is `18 + 18 = 36px`; `52px` is that plus the row's own
            `py-2`). The second drift was this exact comment's own
            prediction going unheeded — it said to re-measure and update
            this literal when the gutter changed size again, and the gutter
            changed size again. The e2e suite's "the ghost row at the end of
            the list matches a minimum rule row's height" now asserts this
            row's height against a real rule row's height directly, rather
            than against either literal, so a third drift fails a test
            instead of waiting for someone to notice a screenshot looks 2px
            off. */}
        {/* The focus ring is drawn **inward** on this one control, and that is
            a clipping fix rather than a style preference. The well above is a
            scroll container — `scroll-list` is `overflow-y: auto`, which forces
            `overflow-x` to compute to a clipping value however it is written,
            so it cannot be told to let a ring through. This button is the only
            focusable thing inside it that is *itself* flush with that edge
            (every control on a rule row is inset by the row's own padding), so
            the global `:focus-visible` outline — 2px at `outline-offset: 1px`,
            i.e. 3px outside the border box — had all 3px of its left arc cut
            off. Measured: room 0 on the left, 8 on the right, the 8 being the
            scrollbar gutter, which is why only one side looked wrong.
            `outline-offset: -2px` puts the whole ring inside the border box, so
            the room it needs is zero and no geometry moves. The alternative —
            padding the well — shifts every rule row inward and narrows the
            list, to fix one control.

            `cursor-pointer` for the reason `AddSiteField` already records at
            its own `+`: a `<button>` takes the browser's arrow by default —
            there is no `cursor` rule in the build at all, this is the UA
            sheet — and an arrow over a full-width row says "not clickable" at
            exactly the moment the row is inviting a click.

            The `!` is load-bearing and is not a specificity fight. style.css's
            `:focus-visible` is **unlayered**, and Tailwind v4 emits utilities
            inside `@layer utilities`; unlayered CSS beats layered CSS whatever
            the selectors say, so the plain utility lost and the measured
            offset stayed at 1px. Verified by measuring the computed style with
            the class present, not by reading the class list. */}
        <button
          className="mb-px flex h-[52px] shrink-0 cursor-pointer items-center gap-2.5 bg-tray pr-2 pl-3 text-left focus-visible:[outline-offset:-2px]!"
          aria-label="New rule at end"
          onClick={onAddRule}
        >
          <span
            className="flex h-[18px] w-[30px] shrink-0 items-center justify-center rounded-[4px] border border-dashed border-boundary text-muted-foreground"
            aria-hidden="true"
          >
            <Plus className="size-3" />
          </span>
          <span className="text-[12px] leading-4 font-semibold text-foreground-2">New rule</span>
        </button>
      </div>
    </section>
  );
}
