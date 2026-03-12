# Hurley Motion CSV Analyzer

A browser-based tool for inspecting Apple Watch/Core Motion CSV logs, spotting motion segments, and replaying movement in a 3D scene.

Built with React, TypeScript, Vite, and Three.js.

## What It Does

- Loads motion CSV files with acceleration, gyroscope, and gravity channels
- Renders synchronized time-series charts for:
  - `Acceleration`: `ax`, `ay`, `az`
  - `Gyroscope`: `gx`, `gy`, `gz`
  - `Gravity`: `grx`, `gry`, `grz`
- Supports chart interaction:
  - Pan and zoom
  - Drag-select time ranges
  - Playhead scrubbing
- Lets you assign labels to selected ranges manually
- Exports labeled ranges to CSV for downstream classification workflows
- Replays selected or visible data in a Three.js 3D trajectory viewer

## CSV Requirements

Required header fields (order can vary, names must match):

```csv
timestamp,ax,ay,az,gx,gy,gz,grx,gry,grz
```

Example row:

```csv
1772830585.522370,0.011660,0.046078,-0.010078,-0.049581,-0.115448,-0.073396,-0.049746,-0.063000,-0.996773
```

Units:

- `ax`, `ay`, `az` (`userAcceleration`): `g`
- `gx`, `gy`, `gz` (`rotationRate`): `rad/s`
- `grx`, `gry`, `grz` (`gravity`): `g`

## Quick Start

```bash
npm install
npm run dev
```

Open the local URL from Vite (typically `http://localhost:5173`).

## Scripts

```bash
npm run dev      # start dev server
npm run build    # type-check + production build
npm run preview  # preview production build
npm run lint     # run ESLint
```

## Usage Flow

1. Click **Load CSV** and choose your data file.
2. Explore charts with mouse wheel (pan) or `Ctrl/Cmd + wheel` (zoom).
3. Drag in a chart to create a selection.
4. Choose playback source:
   - **Visible Range**
   - **Selected Range**
5. Use **Play / Pause / Rewind** and drag the red playhead to scrub.
6. In 3D view, toggle auto-follow, coordinate labels, and fullscreen as needed.

## Labeling Workflow

Range overlays are manual:

1. Drag in a chart to create a selection.
2. Enter a label name (or load a previous labels CSV with **Load Labels CSV**).
3. Click **Add Selected Range**.
4. Export all labels with **Export Labels CSV**.

The exported CSV includes:
- `label`
- `startIndex`, `endIndex`
- `startTimeSec`, `endTimeSec`
- `durationSec`
- `sampleCount`

Export is sorted by `startTimeSec` so rows are always in timeline order.
The importer accepts this same CSV schema.

## Trajectory Model

Trajectory is estimated in `computeTrajectory()` (`src/lib/sensor.ts`) using dead reckoning:

- Gyro integration for orientation
- Gravity-based tilt correction
- Filtered acceleration integration to velocity and position
- Damping and deadband to reduce drift

Long sequences will still accumulate positional error.

## Project Structure

```text
src/
  App.tsx                      # main state, layout, and orchestration
  components/
    PlaybackPanel.tsx          # Three.js scene + playback controls
    SensorChartCard.tsx        # interactive chart card per sensor group
  lib/
    sensor.ts                  # CSV parsing, chart utilities, trajectory
    labels.ts                  # manual label range types + overlay colors
```

## Known Limitations

- Dead-reckoning drift increases over time
- No magnetometer fusion (yaw drift possible)
- Labels are manual and depend on user consistency
- Timestamp quality strongly affects integration stability

## Data Capture Tip

For Apple Watch logging, prefer `motion.timestamp` over wall-clock timestamps for better integration consistency.
