export interface ExtractedFrame {
  index: number;
  timestamp: number;
  dataUrl: string;
  base64: string;
}

export async function extractFramesFromVideo(
  file: File,
  count = 8
): Promise<ExtractedFrame[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.src = url;
    video.muted = true;
    video.preload = "metadata";

    video.onloadedmetadata = async () => {
      const duration = video.duration;
      const frames: ExtractedFrame[] = [];

      // Timestamps: 10%–85% of video, evenly spaced
      const start = duration * 0.10;
      const end = duration * 0.85;
      const step = (end - start) / (count - 1);
      const timestamps = Array.from({ length: count }, (_, i) =>
        parseFloat((start + i * step).toFixed(2))
      );

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;

      for (let i = 0; i < timestamps.length; i++) {
        await seekTo(video, timestamps[i]);
        canvas.width = Math.min(video.videoWidth, 1280);
        canvas.height = Math.round(
          (canvas.width / video.videoWidth) * video.videoHeight
        );
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        const base64 = dataUrl.split(",")[1];
        frames.push({ index: i, timestamp: timestamps[i], dataUrl, base64 });
      }

      URL.revokeObjectURL(url);
      resolve(frames);
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load video"));
    };
  });
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      // Small delay to ensure frame is rendered
      setTimeout(resolve, 80);
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = time;
  });
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
