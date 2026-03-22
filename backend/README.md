# FastAPI Strike Inference Backend

This backend runs the original PyTorch strike model through FastAPI and serves the frontend at `/api/strike`.

## Setup

From the repo root:

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Model Files

You must place the trained model files in `backend/models/` yourself:

- `backend/models/strike_cnn_11ch.pt`
- `backend/models/feature_mean_11ch.npy`
- `backend/models/feature_std_11ch.npy`

These are not bundled in this repo.

If you want to store them somewhere else, you can override the paths with env vars:

- `STRIKE_MODEL_CHECKPOINT`
- `STRIKE_MODEL_FEATURE_MEAN`
- `STRIKE_MODEL_FEATURE_STD`

Optional runtime overrides:

- `STRIKE_MODEL_STRIDE`
- `STRIKE_MODEL_THRESHOLD`
- `STRIKE_MODEL_LABEL_END_PADDING`

## Run

From the repo root:

```bash
backend/.venv/bin/uvicorn backend.main:app --reload
```

The service listens on `http://127.0.0.1:8000` by default and exposes:

- `GET /api/strike/health`
- `POST /api/strike/infer`

## Frontend Integration

In local dev, Vite proxies `/api/strike` to `http://127.0.0.1:8000` by default.

You can override targets with:

- `STRIKE_API_PROXY_TARGET` for the Vite dev proxy
- `VITE_STRIKE_API_URL` for the frontend fetch base URL
