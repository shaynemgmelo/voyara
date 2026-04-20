const AI_URL = process.env.REACT_APP_AI_SERVICE_URL || "http://localhost:8000/api";

/**
 * Fast preview — caption/oEmbed only. Returns in ≤15s.
 */
export async function analyzeUrls(urls) {
  const resp = await fetch(`${AI_URL}/analyze-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  });
  if (!resp.ok) throw new Error("Analysis failed");
  return resp.json();
}

/**
 * Deep analyze — starts a background job that runs audio transcription
 * + on-screen OCR in addition to captions. Polls until done.
 *
 * @param {string[]} urls
 * @param {(stage: string, elapsed: number) => void} onProgress
 */
export async function analyzeUrlsDeep(urls, onProgress) {
  const startResp = await fetch(`${AI_URL}/analyze-url/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  });
  if (!startResp.ok) throw new Error("Failed to start deep analysis");
  const { job_id } = await startResp.json();
  if (!job_id) throw new Error("No job_id returned");

  // Poll every 2s, up to 3 minutes
  const maxWaitMs = 180_000;
  const pollMs = 2000;
  const started = Date.now();

  while (Date.now() - started < maxWaitMs) {
    await new Promise((r) => setTimeout(r, pollMs));

    const statusResp = await fetch(`${AI_URL}/analyze-url/status/${job_id}`);
    if (!statusResp.ok) {
      if (statusResp.status === 404) throw new Error("Job expired");
      continue;
    }
    const info = await statusResp.json();

    if (onProgress && info.stage) {
      onProgress(info.stage, info.elapsed || 0);
    }

    if (info.status === "ready") return info.result;
    if (info.status === "error") {
      throw new Error(info.error || "Deep analysis failed");
    }
  }

  throw new Error("Deep analysis timed out");
}
