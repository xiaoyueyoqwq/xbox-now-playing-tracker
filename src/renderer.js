import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const WIDTH = 520;
const HEIGHT = 150;
const FONT_FAMILY = "Segoe UI, Ubuntu, Cantarell, sans-serif";
const h = React.createElement;

export function renderCard(presence) {
  return `<?xml version="1.0" encoding="UTF-8"?>${renderToStaticMarkup(
    h(XboxNowPlayingCard, { presence }),
  )}`;
}

function XboxNowPlayingCard({ presence }) {
  const title = presence.titleName || (presence.isOnline ? "Online on Xbox" : "Not playing right now");
  const subtitle = getNowPlayingText(presence);
  const fetchedAt = presence.fetchedAt ? `Updated ${formatTimestamp(presence.fetchedAt)}` : "";
  const accent = presence.isOnline ? "#3bc65a" : "#8a95a5";

  return h(
    "svg",
    {
      width: WIDTH,
      height: HEIGHT,
      viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
      fill: "none",
      xmlns: "http://www.w3.org/2000/svg",
      role: "img",
      "aria-label": `${presence.gamertag} Xbox now playing`,
    },
    h(
      "defs",
      null,
      h(
        "linearGradient",
        {
          id: "bg",
          x1: "0",
          y1: "0",
          x2: WIDTH,
          y2: HEIGHT,
          gradientUnits: "userSpaceOnUse",
        },
        h("stop", { stopColor: "#111827" }),
        h("stop", { offset: "0.54", stopColor: "#182235" }),
        h("stop", { offset: "1", stopColor: "#0f3b25" }),
      ),
      h(
        "filter",
        { id: "shadow", x: "-20%", y: "-30%", width: "140%", height: "160%" },
        h("feDropShadow", {
          dx: "0",
          dy: "8",
          stdDeviation: "10",
          floodColor: "#000000",
          floodOpacity: "0.22",
        }),
      ),
    ),
    h("rect", { width: WIDTH, height: HEIGHT, rx: "14", fill: "url(#bg)" }),
    h("circle", { cx: "462", cy: "32", r: "84", fill: "#107c10", opacity: "0.18" }),
    h("circle", { cx: "60", cy: "132", r: "70", fill: "#2dd36f", opacity: "0.10" }),
    h(
      "g",
      { filter: "url(#shadow)" },
      h("rect", { x: "24", y: "24", width: "102", height: "102", rx: "18", fill: "#0b1220", stroke: "#263246" }),
      h(TitleArt, { presence, accent }),
    ),
    h("circle", { cx: "136", cy: "43", r: "5", fill: accent }),
    h(Text, { x: "150", y: "48", fill: "#d8ffe0", fontSize: "16", fontWeight: "700" }, presence.gamertag || "Xbox player"),
    h(Text, { x: "150", y: "82", fill: "#ffffff", fontSize: "24", fontWeight: "800" }, truncate(title, 28)),
    h(Text, { x: "150", y: "109", fill: "#b9c5d6", fontSize: "14" }, truncate(subtitle, 42)),
    h(Text, { x: "150", y: "130", fill: "#7f8da1", fontSize: "12" }, fetchedAt),
  );
}

function Text({ children, ...props }) {
  return h(
    "text",
    {
      fontFamily: FONT_FAMILY,
      ...props,
    },
    children,
  );
}

function TitleArt({ presence, accent }) {
  if (presence.titleArtUrl) {
    return h("image", {
      x: "30",
      y: "30",
      width: "90",
      height: "90",
      href: presence.titleArtUrl,
      preserveAspectRatio: "xMidYMid slice",
      clipPath: "inset(0 round 14px)",
    });
  }

  return h("path", {
    d: "M75 42C56.8 42 42 56.8 42 75s14.8 33 33 33 33-14.8 33-33-14.8-33-33-33Zm-18.4 14.8c4.7-4 11-6.5 18.4-6.5s13.7 2.5 18.4 6.5c-5.3 1.2-11.1 4.4-18.4 10.1-7.3-5.7-13.1-8.9-18.4-10.1Zm-6.3 18.1c0-4.1 1.1-7.9 3.1-11.2 5.6.7 10.4 3.7 16.7 8.9-6.2 5.7-10.8 11.7-13.2 18.6-4.1-4-6.6-9.8-6.6-16.3Zm24.7 24.8c-4.1 0-7.9-1-11.1-2.9 1.9-6.7 5.6-12.5 11.1-17.8 5.5 5.3 9.2 11.1 11.1 17.8-3.2 1.9-7 2.9-11.1 2.9Zm18.1-8.5c-2.4-6.9-7-12.9-13.2-18.6 6.3-5.2 11.1-8.2 16.7-8.9 2 3.3 3.1 7.1 3.1 11.2 0 6.5-2.5 12.3-6.6 16.3Z",
    fill: accent,
  });
}

function truncate(value, maxLength) {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function getNowPlayingText(presence) {
  if (presence.titleName) {
    return `Playing ${presence.titleName}`;
  }

  if (presence.isOnline) {
    return presence.deviceType ? `Online on ${presence.deviceType}` : "Online on Xbox";
  }

  return "Not playing right now";
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().replace("T", " ").slice(0, 16);
}
