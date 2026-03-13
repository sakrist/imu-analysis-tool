# IMU Motion CSV Analyzer

Browser tool to inspect IMU CSV logs, label motion ranges, and replay motion in a 3D trajectory view.

## Features

- Load CSV with acceleration, gyroscope, and gravity channels
- Synchronized charts with pan, zoom, selection, and playhead scrubbing
- Manual range labeling and labels CSV import/export
- Playback from selected or visible range
- 3D trajectory replay (Three.js)

## CSV Input

Required headers (order can vary):

```csv
timestamp,ax,ay,az,gx,gy,gz,grx,gry,grz
```

Example:

```csv
1772830585.522370,0.011660,0.046078,-0.010078,-0.049581,-0.115448,-0.073396,-0.049746,-0.063000,-0.996773
```

Units:

- `ax`, `ay`, `az`: `g`
- `gx`, `gy`, `gz`: `rad/s`
- `grx`, `gry`, `grz`: `g`

## Run

```bash
npm install
npm run dev
```

Default local URL: `http://localhost:5173`

## Scripts

```bash
npm run dev
npm run build
npm run preview
npm run lint
```

## Basic Use

1. Load a CSV file.
2. Pan/zoom charts and drag to select a range.
3. Add a label for the selected range.
4. Export labels CSV when done.
5. Use playback controls for chart + 3D replay.

## Labels CSV Schema

Export/import schema:

- `label`
- `startIndex`, `endIndex`
- `startTimeSec`, `endTimeSec`
- `durationSec`
- `sampleCount`

Rows are exported sorted by `startTimeSec`.

## Notes

- Trajectory uses dead reckoning and will drift over longer sequences.
- No magnetometer fusion (yaw drift is expected).
- Better timestamps improve replay and integration stability.
