export function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateShort(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function formatDuration(minutes) {
  if (!minutes) return "";
  if (minutes < 60) return `${minutes}min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

export function renderStars(rating) {
  if (!rating) return "";
  return `${"★".repeat(Math.round(rating))}${"☆".repeat(5 - Math.round(rating))}`;
}

export function categoryIcon(category) {
  const icons = {
    restaurant: "🍽️",
    attraction: "🏛️",
    hotel: "🏨",
    transport: "🚌",
    activity: "🎯",
    shopping: "🛍️",
    other: "📍",
  };
  return icons[category] || icons.other;
}
