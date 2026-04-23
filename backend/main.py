from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


BACKEND_ROOT = Path(__file__).resolve().parent
DEFAULT_MODEL_ROOT = BACKEND_ROOT / "models"
DEFAULT_CHECKPOINT = DEFAULT_MODEL_ROOT / "strike_cnn_11ch.pt"
DEFAULT_FEATURE_MEAN = DEFAULT_MODEL_ROOT / "feature_mean_11ch.npy"
DEFAULT_FEATURE_STD = DEFAULT_MODEL_ROOT / "feature_std_11ch.npy"
DEFAULT_FEATURE_COLS = ["ax", "ay", "az", "gx", "gy", "gz", "grx", "gry", "grz", "acc_mag", "gyro_mag"]
DEFAULT_STRIDE = int(os.getenv("STRIKE_MODEL_STRIDE", "8"))
DEFAULT_THRESHOLD = float(os.getenv("STRIKE_MODEL_THRESHOLD", "0.5"))
DEFAULT_LABEL_END_PADDING = int(os.getenv("STRIKE_MODEL_LABEL_END_PADDING", "0"))
BATCH_SIZE = 256


class PointInput(BaseModel):
    timestamp: float
    ax: float
    ay: float
    az: float
    gx: float
    gy: float
    gz: float
    grx: float
    gry: float
    grz: float


class InferRequest(BaseModel):
    points: list[PointInput]


class StrikeWindowPrediction(BaseModel):
    windowStart: int
    windowEnd: int
    centerIndex: int
    centerTimeSec: float
    probability: float


class InferResponse(BaseModel):
    modelVersion: str
    label: str
    labelMode: str
    labelEndPadding: int
    windowSize: int
    stride: int
    defaultThreshold: float
    windowPredictions: list[StrikeWindowPrediction]


class HealthResponse(BaseModel):
    status: str
    modelVersion: str
    windowSize: int
    stride: int
    defaultThreshold: float


class StrikeCNN(nn.Module):
    def __init__(self, model_spec: dict):
        super().__init__()
        layers: list[nn.Module] = []
        in_channels = int(model_spec["in_channels"])

        for out_channels, kernel_size, use_pool in zip(
            model_spec["conv_channels"],
            model_spec["conv_kernel_sizes"],
            model_spec["pool_after"],
        ):
            padding = int(kernel_size) // 2
            layers.extend(
                [
                    nn.Conv1d(in_channels, int(out_channels), kernel_size=int(kernel_size), padding=padding),
                    nn.BatchNorm1d(int(out_channels)),
                    nn.ReLU(),
                ]
            )
            if use_pool:
                layers.append(nn.MaxPool1d(2))
            in_channels = int(out_channels)

        layers.append(nn.AdaptiveAvgPool1d(1))
        self.features = nn.Sequential(*layers)
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Linear(int(model_spec["conv_channels"][-1]), int(model_spec["hidden_dim"])),
            nn.ReLU(),
            nn.Dropout(float(model_spec["dropout"])),
            nn.Linear(int(model_spec["hidden_dim"]), 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.features(x)
        x = self.classifier(x)
        return x.squeeze(1)


class StrikeInferenceService:
    def __init__(self) -> None:
        checkpoint_path = Path(os.getenv("STRIKE_MODEL_CHECKPOINT", DEFAULT_CHECKPOINT))
        feature_mean_path = Path(os.getenv("STRIKE_MODEL_FEATURE_MEAN", DEFAULT_FEATURE_MEAN))
        feature_std_path = Path(os.getenv("STRIKE_MODEL_FEATURE_STD", DEFAULT_FEATURE_STD))

        checkpoint = torch.load(checkpoint_path, map_location="cpu")
        model_spec = dict(checkpoint["model_spec"])
        self.feature_cols = list(checkpoint.get("feature_cols", DEFAULT_FEATURE_COLS))
        self.window_size = int(checkpoint.get("window_size", 70))
        self.stride = int(checkpoint.get("stride", DEFAULT_STRIDE))
        self.default_threshold = float(checkpoint.get("default_threshold", DEFAULT_THRESHOLD))
        self.label_end_padding = int(checkpoint.get("label_end_padding", DEFAULT_LABEL_END_PADDING))
        self.label = str(checkpoint.get("label", "strike"))
        self.label_mode = str(checkpoint.get("label_mode", "center"))
        self.model_version = str(checkpoint.get("version", "strike_cnn_11ch.pt"))
        self.feature_mean = np.load(feature_mean_path).reshape(-1).astype(np.float32)
        self.feature_std = np.load(feature_std_path).reshape(-1).astype(np.float32)

        if len(self.feature_cols) != len(self.feature_mean) or len(self.feature_cols) != len(self.feature_std):
            raise ValueError("feature_cols, feature_mean, and feature_std must have the same length")

        self.model = StrikeCNN(model_spec)
        self.model.load_state_dict(checkpoint["model_state_dict"])
        self.model.eval()

    def _feature_value(self, point: PointInput, feature: str) -> float:
        if feature in {"ax", "ay", "az", "gx", "gy", "gz", "grx", "gry", "grz"}:
            return float(getattr(point, feature))
        if feature == "acc_mag":
            return float(np.hypot(point.ax, np.hypot(point.ay, point.az)))
        if feature == "gyro_mag":
            return float(np.hypot(point.gx, np.hypot(point.gy, point.gz)))
        raise ValueError(f"Unsupported feature column: {feature}")

    def _build_feature_matrix(self, points: list[PointInput]) -> np.ndarray:
        feature_matrix = np.empty((len(points), len(self.feature_cols)), dtype=np.float32)

        for point_index, point in enumerate(points):
            for feature_index, feature in enumerate(self.feature_cols):
                feature_matrix[point_index, feature_index] = self._feature_value(point, feature)

        return (feature_matrix - self.feature_mean) / self.feature_std

    def infer(self, points: list[PointInput]) -> InferResponse:
        if len(points) < self.window_size:
            return InferResponse(
                modelVersion=self.model_version,
                label=self.label,
                labelMode=self.label_mode,
                labelEndPadding=self.label_end_padding,
                windowSize=self.window_size,
                stride=self.stride,
                defaultThreshold=self.default_threshold,
                windowPredictions=[],
            )

        features = self._build_feature_matrix(points)
        starts = list(range(0, len(points) - self.window_size + 1, self.stride))
        predictions: list[StrikeWindowPrediction] = []
        base_timestamp = points[0].timestamp

        with torch.no_grad():
            for batch_offset in range(0, len(starts), BATCH_SIZE):
                batch_starts = starts[batch_offset : batch_offset + BATCH_SIZE]
                batch_windows = np.stack([features[start : start + self.window_size].T for start in batch_starts]).astype(
                    np.float32
                )
                logits = self.model(torch.from_numpy(batch_windows))
                probabilities = torch.sigmoid(logits).cpu().numpy()

                for start_index, probability in zip(batch_starts, probabilities, strict=True):
                    end_index = start_index + self.window_size - 1
                    center_index = start_index + self.window_size // 2
                    predictions.append(
                        StrikeWindowPrediction(
                            windowStart=start_index,
                            windowEnd=end_index,
                            centerIndex=center_index,
                            centerTimeSec=float(points[center_index].timestamp - base_timestamp),
                            probability=float(probability),
                        )
                    )

        return InferResponse(
            modelVersion=self.model_version,
            label=self.label,
            labelMode=self.label_mode,
            labelEndPadding=self.label_end_padding,
            windowSize=self.window_size,
            stride=self.stride,
            defaultThreshold=self.default_threshold,
            windowPredictions=predictions,
        )


@lru_cache(maxsize=1)
def get_service() -> StrikeInferenceService:
    return StrikeInferenceService()


app = FastAPI(title="Strike CNN Inference Service")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/strike/health", response_model=HealthResponse)
def health() -> HealthResponse:
    service = get_service()
    return HealthResponse(
        status="ok",
        modelVersion=service.model_version,
        windowSize=service.window_size,
        stride=service.stride,
        defaultThreshold=service.default_threshold,
    )


@app.post("/api/strike/infer", response_model=InferResponse)
def infer(request: InferRequest) -> InferResponse:
    return get_service().infer(request.points)
