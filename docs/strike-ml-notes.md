# Strike ML Notes

This is the distilled version of what is most likely to improve strike detection with the current single-sensor setup.

Current model inputs already include:

- raw accel: `ax`, `ay`, `az`
- raw gyro: `gx`, `gy`, `gz`
- gravity: `grx`, `gry`, `grz`
- magnitudes: `acc_mag`, `gyro_mag`

## Highest-Value Improvements

### 1. Add `jerk_mag`

Definition:

- `jerk_mag = change in acceleration magnitude over time`

Why it matters:

- a strike is usually not just a high acceleration moment
- it is often the first sudden change in acceleration
- jerk is much better at highlighting impact onset than plain acceleration magnitude alone

Why this is the best next feature:

- easy to derive from existing data
- no new hardware needed
- directly matches how impact is visually identified in the charts

If only one new feature is added, it should be `jerk_mag`.

### 2. Label exact `impact index`

Current strike-range labels are useful, but they are still broad.

Why this matters:

- the model needs to learn where impact actually begins, not only that a strike exists somewhere inside a window
- exact impact labels would help the model distinguish:
  - pre-strike buildup
  - impact onset
  - post-impact decay

Why this is likely the best labeling improvement:

- better labels often help more than adding many more features
- this directly supports more precise strike timing
- it matches the current app work around impact detection

## Recommendation

If you want the most practical next step, do these in order:

1. Add and save `jerk_mag`
2. Start labeling exact `impact index` for at least part of the dataset

That gives the best chance of improving strike identification without adding more sensors or making the pipeline too complex.
