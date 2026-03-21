# IMU Motion CSV Analyzer

Browser tool to inspect IMU CSV logs, label motion ranges, and replay motion in a 3D trajectory view.

Live URL: `https://sakrist.github.io/imu-analysis-tool/`

## Features

- Load CSV with acceleration, gyroscope, and gravity channels
- Run the bundled strike CNN in-browser and overlay predicted strike ranges
- Optionally load audio (`.m4a`, `.wav`, `.mp3`, `.caff`/`.caf`) with playback controls
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

## Strike Model

The app bundles a browser-friendly export of the `watch-strike-cnn` strike detector at [`public/models/strike-cnn-v1.json`](public/models/strike-cnn-v1.json).

- Model input: `70` samples per window
- Window stride: `8`
- Feature order: `ax, ay, az, gx, gy, gz, grx, gry, grz, acc_mag, gyro_mag`
- Threshold: configurable in the UI, default `0.50`

The model runs automatically after you load a CSV. Predictions stay separate from manual labels and can be shown or hidden as chart overlays.

To regenerate the bundled model artifact from the training repo checkpoint:

```bash
/Users/sakrist/Developer/watch-strike-cnn/.venv/bin/python scripts/export_strike_model.py
```

## Basic Use

1. Load a CSV file.
2. Optional: load an audio file recorded with the same session.
3. Pan/zoom charts and drag to select a range.
4. Add a label for the selected range.
5. Export labels CSV when done.
6. Use playback controls for chart + 3D replay (audio plays/pauses with playback).

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
