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

  // Poll every 2s, up to 3 minutes. Stop IMMEDIATELY on any terminal signal
  // — ready / error / expired / repeated-404 / network error — so a stale
  // job_id (e.g. from a worker restart) can never spam the server in a tight
  // loop. Consecutive failures are also capped so we give up gracefully.
  const maxWaitMs = 180_000;
  const pollMs = 2000;
  const maxConsecutiveFailures = 3;
  const started = Date.now();
  let consecutiveFailures = 0;

  while (Date.now() - started < maxWaitMs) {
    await new Promise((r) => setTimeout(r, pollMs));

    let statusResp;
    try {
      statusResp = await fetch(`${AI_URL}/analyze-url/status/${job_id}`);
    } catch (e) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= maxConsecutiveFailures) {
        throw new Error("Network unavailable during deep analysis");
      }
      continue;
    }

    // Any non-2xx treated as terminal — avoids tight 404 loops when the
    // worker restarted and the in-memory job store was wiped.
    if (!statusResp.ok) {
      throw new Error(`Job unavailable (${statusResp.status})`);
    }
    consecutiveFailures = 0;

    const info = await statusResp.json();

    if (onProgress && info.stage) {
      onProgress(info.stage, info.elapsed || 0);
    }

    if (info.status === "ready") return info.result;
    if (info.status === "error") {
      throw new Error(info.error || "Deep analysis failed");
    }
    // New terminal state from backend: worker restart wiped the job store.
    if (info.status === "expired") {
      throw new Error(info.error || "Job expired — please retry");
    }
  }

  throw new Error("Deep analysis timed out");
}
