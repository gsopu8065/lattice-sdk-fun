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

    try:
        print("Camera ready; warming up for two seconds.", flush=True)
        time.sleep(2)

        while running:
            frame = camera.capture_array("lores")
            gray = np.mean(frame, axis=2).astype(np.uint8)
            now = time.monotonic()

            if recording and now >= clip_deadline:
                camera.stop_recording()
                recording = False
                print(f"Saved {args.clip_seconds}-second motion clip.", flush=True)
                print(f"CLIP_SAVED\t{output_path}", flush=True)

            if previous_frame is not None and not recording:
                fraction = changed_fraction(gray, previous_frame, args.pixel_threshold)
                if fraction >= args.motion_threshold:
                    consecutive_motion_frames += 1
                else:
                    consecutive_motion_frames = 0

                if consecutive_motion_frames >= 2:
                    filename = datetime.now().strftime("motion-%Y%m%d-%H%M%S-%f.h264")
                    output_path = args.output_dir / filename
                    camera.start_recording(
                        H264Encoder(bitrate=4_000_000),
                        FileOutput(str(output_path)),
                    )
                    recording = True
                    clip_deadline = time.monotonic() + args.clip_seconds
                    consecutive_motion_frames = 0
                    print(f"Motion detected; recording {output_path}", flush=True)

            previous_frame = gray
    finally:
        if recording:
            camera.stop_recording()
        camera.stop()
        camera.close()
        print("Camera stopped.", flush=True)


if __name__ == "__main__":
    main()
