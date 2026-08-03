/**
 * Read state only for now — Task 5 adds expand and edit.
 *
 * The value wraps to two lines at rest rather than truncating to one: design
 * §8.2 changed this after a review found long values were only legible once
 * you clicked into them.
 */
export function ValueCell({ value }: { value: string }) {
  if (value.length === 0) {
    return (
      <span data-testid="row-value" className="hl-val hl-val-empty">
        — <span className="hl-unit">no value</span>
      </span>
    );
  }
  return (
    <span data-testid="row-value" className="hl-val">
      {value}
    </span>
  );
}
