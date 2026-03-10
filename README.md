# Motion CSV Analyzer

Interactive web tool for analyzing Apple Watch motion logs (`acceleration`, `gyro`, `gravity`) and visualizing motion playback in 3D.

The app is built with React + TypeScript + Vite and includes:
- zoomable time-series charts
- section selection and playback scrubbing
- Three.js trail playback with coordinate markers
- side-by-side layout (3D view + graphs)

## What This Project Does

- Loads CSV files with motion samples.
- Plots three grouped charts:
  - `Acceleration`: `ax, ay, az`
  - `Gyroscope`: `gx, gy, gz`
  - `Gravity`: `grx, gry, grz`
- Lets you pan/zoom charts and select ranges.
- Replays selected/visible range in 3D using a derived trajectory.

## Expected CSV Format

Header must contain exactly these columns:

```csv
timestamp,ax,ay,az,gx,gy,gz,grx,gry,grz
```

Example row:

```csv
1772830585.522370,0.011660,0.046078,-0.010078,-0.049581,-0.115448,-0.073396,-0.049746,-0.063000,-0.996773
```

### Units (Apple Watch / Core Motion)

- `ax, ay, az` (`userAcceleration`): in **g**, gravity already removed.
- `gx, gy, gz` (`rotationRate`): in **rad/s**.
- `grx, gry, grz` (`gravity`): in **g**.

## Quick Start

### 1) Install

```bash
npm install
```

### 2) Run development server

```bash
npm run dev
```

### 3) Build production bundle

```bash
npm run build
```

### 4) Preview production build

```bash
npm run preview
```

### 5) Lint

```bash
npm run lint
```

## How to Use

1. Click **Load CSV** and select your file.
2. Use chart controls:
   - **Zoom In / Zoom Out / Reset View**
   - **Zoom To Selection / Clear Selection**
3. Interact directly on charts:
   - Wheel pan (or Ctrl/Cmd + wheel to zoom)
   - Drag to select section
   - Drag red playhead line to scrub playback frame
4. Use playback panel:
   - **Visible Range** or **Selected Range**
   - **Play / Pause / Rewind**
   - **Reset 3D View / Fullscreen**

## 3D Playback Notes

- A faint **ghost trajectory** shows full path for current playback window.
- A red trail shows progressed playback path.
- Small coordinate labels are placed every few seconds.
- Camera follows the moving point; manual camera interaction updates follow offset.

## Trajectory Model (Approximate)

Trajectory is estimated from sensor data in `computeTrajectory()`:

- Integrates gyro for orientation.
- Uses gravity for tilt correction (complementary correction).
- Uses `userAcceleration` directly (no gravity subtraction).
- Applies low-pass filtering + deadband on acceleration.
- Converts g to m/s² with `9.80665`.
- Integrates velocity and position with damping to reduce drift.

This is dead-reckoning, so long segments can still drift.

## Project Structure

```text
src/
  App.tsx                       # Top-level state and layout
  App.css                       # App styling and responsive layout
  components/
    SensorChartCard.tsx         # One collapsible chart card (A/G/Gravity)
    PlaybackPanel.tsx           # Three.js playback and controls
  lib/
    sensor.ts                   # CSV parsing + trajectory/model utilities
```

## Known Limitations

- Timestamp quality strongly affects integration stability.
- No magnetometer fusion, so yaw can drift.
- Dead-reckoning is inherently noisy over longer durations.

## Recommended Data Capture Improvements

On Apple Watch, prefer `motion.timestamp` over wall-clock time for integration stability.

Current logging pattern (for reference):

```swift
let timestamp = Date().timeIntervalSince1970
let acceleration = motion.userAcceleration
let gyro = motion.rotationRate
let gravity = motion.gravity
```

Switching to `motion.timestamp` is recommended for best trajectory quality.
