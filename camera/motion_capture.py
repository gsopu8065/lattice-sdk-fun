#!/usr/bin/env python3

import argparse
from datetime import datetime
from pathlib import Path
import signal
import time

import numpy as np
from picamera2 import Picamera2
from picamera2.encoders import H264Encoder
from picamera2.outputs import FileOutput


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--clip-seconds", required=True, type=int)
    parser.add_argument("--no-motion-interval", required=True, type=int)
    parser.add_argument("--motion-threshold", required=True, type=float)
    parser.add_argument("--pixel-threshold", required=True, type=int)
    parser.add_argument("--fps", required=True, type=int)
    return parser.parse_args()


def changed_fraction(current, previous, pixel_threshold):
    difference = np.abs(current.astype(np.int16) - previous.astype(np.int16))
    return float(np.count_nonzero(difference > pixel_threshold)) / difference.size


def main():
    args = parse_args()
    running = True

    def stop(_signum, _frame):
        nonlocal running
        running = False

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)

    camera = Picamera2()
    configuration = camera.create_video_configuration(
        main={"size": (1280, 720)},
        lores={"size": (320, 240), "format": "RGB888"},
        controls={"FrameRate": args.fps},
    )
    camera.configure(configuration)
    camera.start()

    recording = False
    previous_frame = None
    consecutive_motion_frames = 0
    clip_deadline = 0.0
    next_idle_recording = time.monotonic() + args.no_motion_interval
    last_diagnostic = 0.0
    output_path = None
    recording_reason = ""

    def start_recording(reason, now):
        nonlocal recording, clip_deadline, next_idle_recording, output_path, recording_reason
        prefix = "motion" if reason == "motion" else "idle"
        filename = datetime.now().strftime(f"{prefix}-%Y%m%d-%H%M%S-%f.h264")
        output_path = args.output_dir / filename
        camera.start_recording(
            H264Encoder(bitrate=4_000_000),
            FileOutput(str(output_path)),
        )
        recording = True
        recording_reason = reason
        clip_deadline = now + args.clip_seconds
        if reason == "motion":
            next_idle_recording = now + args.no_motion_interval
            print(f"Motion detected; recording {output_path}", flush=True)
        else:
            next_idle_recording = now + args.no_motion_interval
            print(
                f"No motion detected for {args.no_motion_interval} seconds; "
                f"recording fallback clip {output_path}",
                flush=True,
            )

    try:
        print(
            "Camera ready; warming up for two seconds. "
            f"Motion threshold: {args.motion_threshold:.3%}; "
            f"pixel threshold: {args.pixel_threshold}. "
            f"Fallback clip interval: {args.no_motion_interval} seconds.",
            flush=True,
        )
        time.sleep(2)

        while running:
            frame = camera.capture_array("lores")
            gray = np.mean(frame, axis=2).astype(np.uint8)
            now = time.monotonic()

            if recording and now >= clip_deadline:
                camera.stop_recording()
                recording = False
                print(f"Saved {args.clip_seconds}-second {recording_reason} clip.", flush=True)
                print(f"CLIP_SAVED\t{output_path}", flush=True)

            if previous_frame is not None:
                fraction = changed_fraction(gray, previous_frame, args.pixel_threshold)
                if now - last_diagnostic >= 5:
                    seconds_until_idle_clip = max(0.0, next_idle_recording - now)
                    print(
                        f"Motion check: {fraction:.3%} of pixels changed "
                        f"(trigger: {args.motion_threshold:.3%}). "
                        f"Recording: {recording}. "
                        f"Next fallback clip in {seconds_until_idle_clip:.0f}s unless motion starts one first.",
                        flush=True,
                    )
                    last_diagnostic = now

                if not recording and fraction >= args.motion_threshold:
                    consecutive_motion_frames += 1
                elif not recording:
                    consecutive_motion_frames = 0

                if not recording and consecutive_motion_frames >= 2:
                    start_recording("motion", now)
                    consecutive_motion_frames = 0

            if not recording and now >= next_idle_recording:
                start_recording("idle", now)

            previous_frame = gray
    finally:
        if recording:
            camera.stop_recording()
        camera.stop()
        camera.close()
        print("Camera stopped.", flush=True)


if __name__ == "__main__":
    main()
