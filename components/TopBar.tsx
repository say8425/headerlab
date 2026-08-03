export interface TopBarProps {
  paused: boolean;
  onTogglePause: (paused: boolean) => void;
}

export function TopBar({ paused, onTogglePause }: TopBarProps) {
  return (
    <div className="hl-topbar">
      <span className="hl-brand">
        Header<b>Lab</b>
      </span>
      <span className="hl-runstate" data-testid="runstate" data-paused={paused || undefined}>
        <span className="hl-fdot" />
        {paused ? 'Paused' : 'Running'}
      </span>
      <button
        className="hl-pause"
        aria-label={paused ? 'Resume all' : 'Pause all'}
        onClick={() => onTogglePause(!paused)}
      >
        {paused ? 'Resume all' : 'Pause all'}
      </button>
    </div>
  );
}
