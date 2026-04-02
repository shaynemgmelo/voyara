import { useState } from "react";

export default function TravelSegment({ segment }) {
  const [mode, setMode] = useState("walking");

  if (!segment) return null;

  const data = segment[mode];
  if (!data) return null;

  const isWalking = mode === "walking";

  return (
    <div className="flex items-center gap-2 py-0.5 px-2 ml-2">
      <div className="flex-1 border-t border-dashed border-gray-200" />
      <button
        onClick={() => setMode(isWalking ? "driving" : "walking")}
        className="group flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-50 hover:bg-gray-100 transition-all"
        title={`Switch to ${isWalking ? "driving" : "walking"}`}
      >
        <span className="text-xs">{isWalking ? "🚶" : "🚗"}</span>
        <span className="text-[10px] font-semibold text-gray-600 group-hover:text-gray-900 transition-colors">
          {data.duration_text}
        </span>
        <span className="text-[9px] text-gray-400 font-medium">
          • {data.distance_text}
        </span>
        <svg className="w-2.5 h-2.5 text-gray-300 group-hover:text-gray-500 transition-colors" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 10l5 5 5-5" />
        </svg>
      </button>
      <div className="flex-1 border-t border-dashed border-gray-200" />
    </div>
  );
}
