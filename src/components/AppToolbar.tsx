import type { ChangeEventHandler } from 'react'

type AppToolbarProps = {
  audioFileAccept: string
  audioLoaded: boolean
  onAudioFileChange: ChangeEventHandler<HTMLInputElement>
  onClearAudio: () => void
  onFileChange: ChangeEventHandler<HTMLInputElement>
  onToggleHotkeys: () => void
  showHotkeysPopover: boolean
}

export function AppToolbar({
  audioFileAccept,
  audioLoaded,
  onAudioFileChange,
  onClearAudio,
  onFileChange,
  onToggleHotkeys,
  showHotkeysPopover,
}: AppToolbarProps) {
  return (
    <header className="toolbar">
      <div>
        <h1>IMU Motion CSV Analyzer + labeler</h1>
        <p>timestamp + accel + gyro + gravity with zoom, pan, selection, and playback.</p>
      </div>
      <div className="toolbarActions">
        <label className="fileInput">
          <span>Load CSV</span>
          <input type="file" accept=".csv,text/csv" onChange={onFileChange} />
        </label>
        <label className="fileInput">
          <span>Load Audio</span>
          <input type="file" accept={audioFileAccept} onChange={onAudioFileChange} />
        </label>
        <button onClick={onClearAudio} disabled={!audioLoaded}>
          Clear Audio
        </button>
        <div className="hotkeysPopoverWrap">
          <button
            className="iconButton"
            aria-label="Keyboard shortcuts"
            aria-expanded={showHotkeysPopover}
            onClick={onToggleHotkeys}
          >
            i
          </button>
          {showHotkeysPopover && (
            <div className="hotkeysPopover" role="dialog" aria-label="Keyboard shortcuts">
              <h3>Hotkeys</h3>
              <p>
                <kbd>Space</kbd>: Play/Pause
              </p>
              <p>
                <kbd>Esc</kbd>: Clear selection
              </p>
              <p>
                <kbd>Esc</kbd> twice: Reset view
              </p>
              <p>
                <kbd>Cmd</kbd> + <kbd>Enter</kbd>: Zoom to selection
              </p>
              <p>
                <kbd>Ctrl/Cmd</kbd> + wheel: Zoom graph
              </p>
              <p>
                <kbd>Alt</kbd> + wheel: Pan graph
              </p>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
