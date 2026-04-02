const AI_URL = process.env.REACT_APP_AI_SERVICE_URL || "http://localhost:8000/api";

export async function analyzeUrls(urls) {
  const resp = await fetch(`${AI_URL}/analyze-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  });
  if (!resp.ok) throw new Error("Analysis failed");
  return resp.json();
}
