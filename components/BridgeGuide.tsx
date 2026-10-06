import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { bridgeInstallCommand } from '@/lib/view/bridge';

export interface BridgeGuideProps {
  /** The id the browser assigned this install — see {@link bridgeInstallCommand}. */
  extensionId: string;
  /** Chrome's own account of the last failed connect, or null. */
  error: string | null;
  /**
   * Asks the background worker to try the port again. Resolves `false` when
   * the request itself could not be delivered; the outcome of the retry is
   * not here, it arrives as the row's own state.
   */
  onRetry: () => Promise<boolean>;
}

type CopyState = 'ready' | 'copied' | 'selected';
type RetryState = 'ready' | 'retrying' | 'failed';

const COPY_LABELS: ReadonlyArray<readonly [CopyState, string]> = [
  ['ready', 'Copy'],
  ['copied', 'Copied'],
  ['selected', 'Selected'],
];

/**
 * What the Agent bridge row says when it cannot be reached: the command that
 * fixes the usual cause, with this install's id already in it, and what to do
 * after running it.
 *
 * It lives in a popover rather than in the rail because the rail has no height
 * to give: an error-only box there once collapsed the site list to nothing
 * (ScopeRail's `bridgeUnreachable` docblock).
 *
 * The remedy leads and Chrome's string trails it, for the reason
 * `bridgeTitle` gives: Chrome reports one message for a missing manifest, a
 * manifest naming another extension and an interpreter it cannot start, so the
 * string alone diagnoses nothing.
 */
export function BridgeGuide({ extensionId, error, onRetry }: BridgeGuideProps) {
  const command = bridgeInstallCommand(extensionId);
  const commandRef = useRef<HTMLElement>(null);
  const [copy, setCopy] = useState<CopyState>('ready');
  const [retry, setRetry] = useState<RetryState>('ready');

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopy('copied');
    } catch {
      // Never "Copied" for a copy that did not happen. Selecting the text
      // leaves the person one keystroke from the same result, and the button
      // says that is what happened.
      const node = commandRef.current;
      const selection = window.getSelection();
      if (node !== null && selection !== null) {
        const range = document.createRange();
        range.selectNodeContents(node);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      setCopy('selected');
    }
  };

  const onRetryClick = async () => {
    setRetry('retrying');
    setRetry((await onRetry()) ? 'ready' : 'failed');
  };

  return (
    <div className="grid gap-2 text-[12px] leading-4" data-testid="bridge-guide">
      <p className="font-semibold">The CLI cannot reach this extension yet.</p>
      <p className="text-muted-foreground">1. In a terminal, run:</p>
      <div className="flex items-start gap-1.5 rounded-md bg-foreground py-1.5 pr-1.5 pl-2 text-background">
        <code
          ref={commandRef}
          data-testid="bridge-command"
          className="min-w-0 flex-1 font-mono text-[11px] leading-[15px] select-all"
        >
          {/* Word by word, so a line may break only between words: a hyphen is
              a break opportunity, and `--extension-id` split across lines
              reads as two flags. The id alone may break anywhere — it is
              wider than the box. The text is still exactly `command`. */}
          {command.split(' ').map((word, i) => (
            <span key={i}>
              {i > 0 && ' '}
              <span
                className={word === extensionId ? '[overflow-wrap:anywhere]' : 'whitespace-nowrap'}
              >
                {word}
              </span>
            </span>
          ))}
        </code>
        <button
          type="button"
          data-testid="bridge-copy"
          onClick={() => void onCopy()}
          className="grid shrink-0 cursor-pointer rounded px-1.5 py-1 text-[11px] leading-none font-semibold text-background ring-background/40 hover:bg-background/15 focus-visible:ring-2 focus-visible:outline-none"
        >
          {/* Every label shares one grid cell, so the button is as wide as the
              widest of them in every state. Sized to its current word, `Copy`
              becoming `Copied` narrowed the command beside it and could move
              where its lines break, under the pointer that just clicked. The
              others are hidden from sight and from the button's name. */}
          {COPY_LABELS.map(([state, label]) => (
            <span
              key={state}
              aria-hidden={state === copy ? undefined : true}
              className={`col-start-1 row-start-1 text-center${state === copy ? '' : ' invisible'}`}
            >
              {label}
            </span>
          ))}
        </button>
      </div>
      <p className="text-muted-foreground">2. Then reopen this popup, or:</p>
      <Button
        size="xs"
        variant="outline"
        className="justify-self-start"
        data-testid="bridge-retry"
        disabled={retry === 'retrying'}
        onClick={() => void onRetryClick()}
      >
        {retry === 'retrying' ? 'Retrying…' : 'Retry now'}
      </Button>
      {retry === 'failed' && (
        <p className="text-destructive" data-testid="bridge-retry-failed">
          The retry could not be sent. Reopen this popup to try again.
        </p>
      )}
      <p className="text-muted-foreground">
        No <code className="font-mono">headerlab</code> command? Run{' '}
        <code className="font-mono">npm i -g headerlab</code> first.
      </p>
      {error !== null && (
        <p
          className="border-t border-border pt-1.5 font-mono text-[10.5px] leading-[14px] break-words text-muted-foreground"
          data-testid="bridge-chrome-error"
        >
          Chrome: {error}
        </p>
      )}
    </div>
  );
}
