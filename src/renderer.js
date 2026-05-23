import { readFileSync } from "node:fs";
import opentype from "opentype.js";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { applyArtworkPolicy } from "./artwork-manager.js";

const WIDTH = 480;
const HEIGHT = 160;
const FONT_FAMILY = "XboxCard, Segoe UI, Ubuntu, Cantarell, sans-serif";
const TEXT_FONTS = loadTextFonts();
const h = React.createElement;

export function renderCard(presence) {
  return `<?xml version="1.0" encoding="UTF-8"?>
${renderToStaticMarkup(h(XboxNowPlayingCard, { presence: normalizeArtworkForRender(presence) }))}`;
}

function normalizeArtworkForRender(presence) {
  if (
    presence.coverImageUrl !== undefined &&
    presence.featureImageUrl !== undefined
  ) {
    return presence;
  }

  return applyArtworkPolicy(presence);
}

function XboxNowPlayingCard({ presence }) {
  const isOnline = presence.isOnline;
  const activityKind = presence.activityKind || "unknown";
  const isGame = activityKind === "game";
  const isPlaying = isOnline && isGame && !!presence.titleName;
  const featureMode = presence.featureMode || "compact";

  const title =
    presence.titleName ||
    (!isOnline && presence.lastSeenTitleName) ||
    (isOnline ? "Exploring Dashboard" : "Currently Offline");
  const platform = presence.platformName || presence.deviceType || "Xbox";
  const lastSeenText = getLastSeenText(presence);
  const lastSeenTitle = presence.lastSeenTitleName || presence.titleName || "";
  const featureArtUrl = presence.featureImageUrl || "";

  const statusColor = isOnline ? "#107c10" : "#52525b";
  const glowColor = isOnline ? "#22c55e" : "#52525b";

  let statusText = lastSeenText || "LAST SEEN";
  if (isPlaying) {
    statusText = `PLAYING ON ${platform.toUpperCase()}`;
  } else if (isOnline && isXboxAppActivity(presence)) {
    statusText = `${getXboxAppPlatformLabel(presence).toUpperCase()} ONLINE`;
  } else if (isOnline && activityKind === "app") {
    statusText = `USING ${title.toUpperCase()}`;
  } else if (isOnline && activityKind === "unknown" && presence.titleName) {
    statusText = `ACTIVE ON ${platform.toUpperCase()}`;
  } else if (isOnline) {
    statusText = `ONLINE ON ${platform.toUpperCase()}`;
  }

  const sessionDuration = getSessionDuration(presence);

  // Layout constants
  const coverSize = 100;
  const coverX = 30;
  const coverY = 30;
  const textX = 156;

  return h(
    "svg",
    {
      width: WIDTH,
      height: HEIGHT,
      viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
      fill: "none",
      xmlns: "http://www.w3.org/2000/svg",
      className: "noSelect",
      role: "img",
      "aria-label": `${presence.gamertag} Xbox now playing`,
    },
    h(
      "defs",
      null,
      h(
        "style",
        null,
        ".noSelect{user-select:none;-webkit-user-select:none}.titleText{user-select:text;-webkit-user-select:text}",
      ),
      h(
        "linearGradient",
        {
          id: "featureAlphaFade",
          x1: "208",
          y1: "0",
          x2: "392",
          y2: "0",
          gradientUnits: "userSpaceOnUse",
        },
        h("stop", { offset: "0", stopColor: "#ffffff", stopOpacity: "0" }),
        h("stop", { offset: "0.34", stopColor: "#ffffff", stopOpacity: "0" }),
        h("stop", {
          offset: "0.74",
          stopColor: "#ffffff",
          stopOpacity: "0.44",
        }),
        h("stop", { offset: "1", stopColor: "#ffffff", stopOpacity: "0.78" }),
      ),
      h(
        "linearGradient",
        {
          id: "featureBottomAlpha",
          x1: "360",
          y1: "36",
          x2: "360",
          y2: "160",
          gradientUnits: "userSpaceOnUse",
        },
        h("stop", { offset: "0", stopColor: "#000000", stopOpacity: "0" }),
        h("stop", { offset: "0.68", stopColor: "#000000", stopOpacity: "0.1" }),
        h("stop", { offset: "1", stopColor: "#000000", stopOpacity: "0.56" }),
      ),
      h(
        "filter",
        {
          id: "ambientGlow",
          x: "-50%",
          y: "-50%",
          width: "200%",
          height: "200%",
        },
        h("feGaussianBlur", { stdDeviation: "20", result: "blur" }),
      ),
      h(
        "filter",
        { id: "shadow", x: "-10%", y: "-10%", width: "120%", height: "120%" },
        h("feDropShadow", {
          dx: "0",
          dy: "4",
          stdDeviation: "6",
          floodColor: "#000000",
          floodOpacity: "0.4",
        }),
      ),
      h(
        "clipPath",
        { id: "cardClip" },
        h("rect", {
          width: WIDTH,
          height: HEIGHT,
          rx: "14",
        }),
      ),
      h(
        "clipPath",
        { id: "featureClip" },
        h("path", {
          d: "M278 0H480V160H206L278 0Z",
        }),
      ),
      h(
        "clipPath",
        { id: "compactFeatureClip" },
        h("circle", {
          cx: "480",
          cy: "0",
          r: "94",
        }),
      ),
      h(
        "mask",
        {
          id: "featureMask",
          maskUnits: "userSpaceOnUse",
          x: "206",
          y: "0",
          width: "274",
          height: "160",
        },
        h("rect", {
          x: "206",
          y: "0",
          width: "274",
          height: "160",
          fill: "url(#featureAlphaFade)",
        }),
      ),
      h(
        "radialGradient",
        {
          id: "compactFeatureFade",
          cx: "480",
          cy: "0",
          r: "106",
          gradientUnits: "userSpaceOnUse",
        },
        h("stop", { offset: "0", stopColor: "#ffffff", stopOpacity: "0.78" }),
        h("stop", {
          offset: "0.54",
          stopColor: "#ffffff",
          stopOpacity: "0.54",
        }),
        h("stop", { offset: "0.78", stopColor: "#ffffff", stopOpacity: "0.2" }),
        h("stop", { offset: "1", stopColor: "#ffffff", stopOpacity: "0" }),
      ),
      h(
        "mask",
        {
          id: "compactFeatureMask",
          maskUnits: "userSpaceOnUse",
          x: "360",
          y: "0",
          width: "120",
          height: "108",
        },
        h("rect", {
          x: "360",
          y: "0",
          width: "120",
          height: "108",
          fill: "url(#compactFeatureFade)",
        }),
      ),
      h(
        "clipPath",
        { id: "coverClip" },
        h("rect", {
          x: coverX,
          y: coverY,
          width: coverSize,
          height: coverSize,
          rx: "12",
        }),
      ),
    ),

    h(
      "g",
      { clipPath: "url(#cardClip)" },
      h("rect", {
        width: WIDTH,
        height: HEIGHT,
        fill: "#000000",
      }),

      h(FeatureArt, { featureMode, featureArtUrl }),

      // Ambient Glow behind cover
      h("circle", {
        cx: coverX + coverSize / 2,
        cy: coverY + coverSize / 2,
        r: "45",
        fill: glowColor,
        filter: "url(#ambientGlow)",
        opacity: isXboxAppActivity(presence) ? "0" : isOnline ? "0.25" : "0.1",
      }),

      // Game Art
      h(
        "g",
        { filter: "url(#shadow)" },
        h(CoverArt, { presence, coverX, coverY, coverSize }),
      ),

      // Outline over the cover art to simulate inner shadow / physical edge
      h("rect", {
        x: coverX,
        y: coverY,
        width: coverSize,
        height: coverSize,
        rx: "12",
        fill: "none",
        stroke: "rgba(255, 255, 255, 0.1)",
        strokeWidth: "1",
      }),

      // --- TEXT LAYOUT ---

      // Status Line
      isPlaying
        ? h(XboxLogoMark, { x: textX, y: 40, size: 16, color: "#22c55e" })
        : h("circle", { cx: textX + 4, cy: 48, r: "4", fill: statusColor }),

      isOnline
        ? h(
            Text,
            {
              x: isPlaying ? textX + 22 : textX + 16,
              y: 52,
              fill: "#a1a1aa",
              fontSize: "11",
              fontWeight: "700",
              letterSpacing: "0.1em",
            },
            statusText,
          )
        : h(LastSeenLine, {
            x: textX + 16,
            y: 52,
            when: statusText,
            title: lastSeenTitle,
          }),

      // Game Title
      h(
        Text,
        {
          x: textX,
          y: 81,
          fill: "#ffffff",
          fontSize: "20",
          fontWeight: "800",
          className: "titleText",
        },
        truncate(title, 26),
      ),

      // Gamertag
      isOnline && sessionDuration
        ? h(GamertagSessionLine, {
            x: textX,
            y: 107,
            gamertag: presence.gamertag || "Xbox Player",
            duration: sessionDuration,
          })
        : h(GamertagText, {
            x: textX,
            y: 107,
            gamertag: presence.gamertag || "Xbox Player",
            maxWidth: 190,
          }),
    ),
  );
}

function XboxLogoMark({ x, y, size, color }) {
  return h(
    "svg",
    {
      viewBox: "0 0 372.36823 372.57281",
      x,
      y,
      width: size,
      height: size,
      "aria-hidden": "true",
    },
    h(
      "g",
      { transform: "translate(-1.5706619,12.357467)" },
      h("path", {
        d: "M 169.18811,359.44924 C 140.50497,356.70211 111.4651,346.40125 86.518706,330.1252 65.614374,316.48637 60.893704,310.87967 60.893704,299.69061 c 0,-22.47524 24.711915,-61.84014 66.992496,-106.71584 24.01246,-25.48631 57.46022,-55.36001 61.0775,-54.55105 7.0309,1.57238 63.25048,56.41053 84.29655,82.2252 33.28077,40.82148 48.58095,74.24535 40.808,89.14682 -5.9087,11.32753 -42.57224,33.4669 -69.50775,41.97242 -22.19984,7.01011 -51.35538,9.9813 -75.37239,7.68108 z M 32.660004,276.3228 C 15.288964,249.67326 6.5125436,223.43712 2.2752336,185.49086 c -1.39917002,-12.53 -0.89778,-19.69701 3.17715,-45.41515 5.0788204,-32.05404 23.3330104,-69.136381 45.2671304,-91.957616 9.34191,-9.719732 10.17624,-9.956543 21.56341,-6.120482 13.828357,4.658436 28.595936,14.857457 51.498366,35.56661 l 13.36254,12.082873 -7.2969,8.96431 C 95.97448,140.22403 60.217254,199.2085 46.741444,235.70071 c -7.32599,19.83862 -10.28084,39.75281 -7.12868,48.04363 2.12818,5.59752 0.17339,3.51093 -6.95276,-7.42154 z m 304.915426,4.53255 c 1.71605,-8.37719 -0.4544,-23.76257 -5.5413,-39.28002 -11.01667,-33.60598 -47.83964,-96.12421 -81.65282,-138.63054 L 239.73699,89.563875 251.25285,78.989784 c 15.03631,-13.806637 25.47602,-22.073835 36.74025,-29.094513 8.88881,-5.540156 21.59109,-10.444558 27.05113,-10.444558 3.36626,0 15.21723,12.298726 24.78421,25.720611 14.81725,20.787711 25.71782,45.986976 31.24045,72.219686 3.56833,16.9498 3.8657,53.23126 0.57486,70.13935 -2.70068,13.87582 -8.40314,31.87484 -13.9661,44.08195 -4.16823,9.14657 -14.53521,26.91044 -19.0783,32.69074 -2.33569,2.97175 -2.33761,2.96527 -1.02393,-3.4477 z M 172.25917,33.104812 c -15.60147,-7.922671 -39.6696,-16.427164 -52.96493,-18.715209 -4.66097,-0.802124 -12.61193,-1.249474 -17.6688,-0.994114 -10.969613,0.55394 -10.479662,-0.0197 7.11783,-8.3336652 14.63023,-6.912081 26.83386,-10.976696 43.40044,-14.455218 18.6362,-3.9130858 53.66559,-3.9590088 72.00507,-0.0944 19.80818,4.174105 43.13297,12.854085 56.27623,20.9423862 l 3.90633,2.403927 -8.96247,-0.452584 c -17.81002,-0.899366 -43.76575,6.295879 -71.63269,19.857459 -8.40538,4.090523 -15.71788,7.357511 -16.25,7.25997 -0.53211,-0.09754 -7.38426,-3.43589 -15.22701,-7.418555 z",
        fill: color,
      }),
    ),
  );
}

function Text({ children, ...props }) {
  const text = normalizeTextChildren(children);
  const textPath = createTextPath(text, props);
  if (textPath) {
    return textPath;
  }

  return h(
    "text",
    {
      fontFamily: FONT_FAMILY,
      ...props,
    },
    children,
  );
}

function loadTextFonts() {
  try {
    return {
      regular: parseFontFile(
        new URL("../fonts/Selawik-Regular.ttf", import.meta.url),
      ),
      semiBold: parseFontFile(
        new URL("../fonts/Selawik-SemiBold.ttf", import.meta.url),
      ),
      bold: parseFontFile(
        new URL("../fonts/Selawik-Bold.ttf", import.meta.url),
      ),
    };
  } catch (error) {
    console.error("[renderer] Failed to load text fonts:", error);
    return null;
  }
}

function parseFontFile(url) {
  const buffer = readFileSync(url);
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
  return opentype.parse(arrayBuffer);
}

function normalizeTextChildren(children) {
  if (typeof children === "string" || typeof children === "number") {
    return String(children);
  }

  if (Array.isArray(children) && children.length === 1) {
    return normalizeTextChildren(children[0]);
  }

  return null;
}

function createTextPath(text, props) {
  if (!TEXT_FONTS || text === null || text === "") {
    return null;
  }

  const {
    x = 0,
    y = 0,
    fill = "#ffffff",
    fontSize = "16",
    fontWeight = "400",
    letterSpacing = 0,
    textAnchor = "start",
    textLength,
    lengthAdjust,
    fontFamily,
    children,
    ...restProps
  } = props;

  const font = getPathFont(fontWeight, fontFamily);
  if (!font) {
    return null;
  }

  const size = Number.parseFloat(fontSize);
  if (!Number.isFinite(size) || size <= 0) {
    return null;
  }

  const spacing = parseLetterSpacing(letterSpacing, size);
  const xNumber = Number.parseFloat(x);
  const yNumber = Number.parseFloat(y);
  if (!Number.isFinite(xNumber) || !Number.isFinite(yNumber)) {
    return null;
  }

  const naturalWidth = getPathTextWidth(font, text, size, spacing);
  const targetWidth = Number.parseFloat(textLength);
  const scaleX =
    Number.isFinite(targetWidth) &&
    targetWidth > 0 &&
    naturalWidth > 0 &&
    lengthAdjust === "spacingAndGlyphs"
      ? targetWidth / naturalWidth
      : 1;
  const anchoredX = getAnchoredTextX(
    xNumber,
    naturalWidth * scaleX,
    textAnchor,
  );
  const pathData = getTextPathData(
    font,
    text,
    anchoredX,
    yNumber,
    size,
    spacing,
  );
  if (!pathData) {
    return null;
  }

  const transform =
    scaleX === 1
      ? restProps.transform
      : `${restProps.transform ? `${restProps.transform} ` : ""}translate(${roundSvgNumber(anchoredX)} 0) scale(${roundSvgNumber(scaleX)} 1) translate(${-roundSvgNumber(anchoredX)} 0)`;

  return h("path", {
    ...restProps,
    d: pathData,
    fill,
    transform,
  });
}

function getPathFont(fontWeight, fontFamily) {
  if (
    String(fontFamily || "")
      .toLowerCase()
      .includes("mono")
  ) {
    return null;
  }

  const weight = Number.parseInt(fontWeight, 10);
  if (weight >= 700) {
    return TEXT_FONTS.bold;
  }

  if (weight >= 600) {
    return TEXT_FONTS.semiBold;
  }

  return TEXT_FONTS.regular;
}

function parseLetterSpacing(value, fontSize) {
  const text = String(value ?? "0").trim();
  if (!text || text === "0") {
    return 0;
  }

  if (text.endsWith("em")) {
    const em = Number.parseFloat(text);
    return Number.isFinite(em) ? em * fontSize : 0;
  }

  const px = Number.parseFloat(text);
  return Number.isFinite(px) ? px : 0;
}

function getPathTextWidth(font, text, fontSize, letterSpacing) {
  return (
    font.getAdvanceWidth(text, fontSize) +
    Math.max(0, Array.from(text).length - 1) * letterSpacing
  );
}

function getAnchoredTextX(x, width, textAnchor) {
  if (textAnchor === "middle") {
    return x - width / 2;
  }

  if (textAnchor === "end") {
    return x - width;
  }

  return x;
}

function getTextPathData(font, text, x, y, fontSize, letterSpacing) {
  if (!letterSpacing) {
    return font.getPath(text, x, y, fontSize).toPathData({
      decimalPlaces: 2,
      flipY: false,
    });
  }

  let cursorX = x;
  return Array.from(text)
    .map((character) => {
      const pathData = font
        .getPath(character, cursorX, y, fontSize)
        .toPathData({ decimalPlaces: 2, flipY: false });
      cursorX += font.getAdvanceWidth(character, fontSize) + letterSpacing;
      return pathData;
    })
    .join("");
}

function GamertagSessionLine({ x, y, gamertag, duration }) {
  const gamertagText = getDisplayGamertag(gamertag);
  const gamertagWidth = estimateTextWidth(gamertagText, 15, 0);
  const maxGamertagWidth = 116;
  const visibleGamertagWidth = Math.min(gamertagWidth, maxGamertagWidth);
  const separatorX = x + visibleGamertagWidth + 12;
  const labelX = separatorX + 14;
  const valueX = labelX + 52;

  return h(
    "g",
    null,
    h(
      Text,
      {
        x,
        y,
        fill: "#e4e4e7",
        fontSize: "15",
        fontWeight: "600",
        textLength: roundSvgNumber(visibleGamertagWidth),
        lengthAdjust: "spacingAndGlyphs",
      },
      gamertagText,
    ),
    h(
      Text,
      {
        x: roundSvgNumber(separatorX),
        y,
        fill: "#52525b",
        fontSize: "12",
        fontWeight: "800",
      },
      "•",
    ),
    h(
      Text,
      {
        x: roundSvgNumber(labelX),
        y,
        fill: "#737373",
        fontSize: "10",
        fontWeight: "800",
        letterSpacing: "0.04em",
      },
      "SESSION",
    ),
    h(
      Text,
      {
        x: roundSvgNumber(valueX),
        y,
        fill: "#8b8b95",
        fontSize: "10",
        fontWeight: "800",
        letterSpacing: "0.04em",
      },
      formatDurationMinutes(duration.totalSeconds),
    ),
  );
}

function GamertagText({ x, y, gamertag, maxWidth }) {
  const gamertagText = getDisplayGamertag(gamertag);
  const gamertagWidth = estimateTextWidth(gamertagText, 15, 0);
  const visibleWidth = Math.min(gamertagWidth, maxWidth);

  return h(
    Text,
    {
      x,
      y,
      fill: "#e4e4e7",
      fontSize: "15",
      fontWeight: "600",
      textLength: roundSvgNumber(visibleWidth),
      lengthAdjust: "spacingAndGlyphs",
    },
    gamertagText,
  );
}

function getDisplayGamertag(gamertag) {
  return String(gamertag || "Xbox Player").slice(0, 16);
}

function FeatureArt({ featureMode, featureArtUrl }) {
  if (!featureArtUrl) {
    return null;
  }

  if (featureMode === "compact") {
    return h(
      "g",
      {
        clipPath: "url(#compactFeatureClip)",
        mask: "url(#compactFeatureMask)",
      },
      h("image", {
        x: "356",
        y: "-10",
        width: "132",
        height: "98",
        href: featureArtUrl,
        preserveAspectRatio: "xMidYMid slice",
        opacity: "0.78",
      }),
    );
  }

  return h(
    "g",
    { clipPath: "url(#featureClip)", mask: "url(#featureMask)" },
    h("image", {
      x: "206",
      y: "0",
      width: "274",
      height: "160",
      href: featureArtUrl,
      preserveAspectRatio: "xMidYMid slice",
      opacity: "0.86",
    }),
    h("rect", {
      x: "206",
      y: "0",
      width: "274",
      height: "160",
      fill: "url(#featureBottomAlpha)",
    }),
  );
}

function LastSeenLine({ x, y, when, title }) {
  const detail = formatLastSeenDetail(when, title);

  return h(
    Text,
    {
      x,
      y,
      fill: "#a1a1aa",
      fontSize: "11",
      fontWeight: "700",
      letterSpacing: "0.08em",
    },
    detail.toUpperCase(),
  );
}

function formatLastSeenDetail(when, title, maxLength = 35) {
  if (!title) {
    return truncate(when, maxLength);
  }

  const prefix = truncate(when, maxLength);
  const titleText = truncate(title, getLastSeenTitleLength(title));
  return `${prefix} · ${titleText}`;
}

function getLastSeenTitleLength(title) {
  const normalizedTitle = String(title ?? "").trim();
  if (normalizedTitle.length <= 5) {
    return normalizedTitle.length;
  }

  return 6;
}

function CoverArt({ presence, coverX, coverY, coverSize }) {
  if (presence.coverKind === "logo" && presence.coverImageUrl) {
    const logoSize = coverSize * 0.5;
    const logoOffset = (coverSize - logoSize) / 2;

    return h(
      "g",
      null,
      h("rect", {
        x: coverX,
        y: coverY,
        width: coverSize,
        height: coverSize,
        rx: "12",
        fill: "#18181b",
      }),
      h("image", {
        x: coverX + logoOffset,
        y: coverY + logoOffset,
        width: logoSize,
        height: logoSize,
        href: presence.coverImageUrl,
        preserveAspectRatio: "xMidYMid meet",
      }),
    );
  }

  if (presence.coverImageUrl) {
    return h("image", {
      x: coverX,
      y: coverY,
      width: coverSize,
      height: coverSize,
      href: presence.coverImageUrl,
      preserveAspectRatio: "xMidYMid slice",
      clipPath: "url(#coverClip)",
    });
  }

  // Fallback dark box with centered logo
  return h(
    "g",
    null,
    h("rect", {
      x: coverX,
      y: coverY,
      width: coverSize,
      height: coverSize,
      rx: "12",
      fill: "#18181b",
    }),
    h(XboxLogoMark, {
      x: coverX + 30,
      y: coverY + 30,
      size: 40,
      color: "#d4d4d8",
    }),
  );
}

function truncate(value, maxLength) {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function estimateTextWidth(value, fontSize, letterSpacing = 0) {
  const text = String(value ?? "");
  const baseWidth = Array.from(text).reduce((total, character) => {
    if (/[A-Z0-9#]/.test(character)) {
      return total + fontSize * 0.64;
    }

    if (/[il.,'|]/.test(character)) {
      return total + fontSize * 0.32;
    }

    if (/\s/.test(character)) {
      return total + fontSize * 0.34;
    }

    return total + fontSize * 0.55;
  }, 0);

  return baseWidth + Math.max(0, text.length - 1) * letterSpacing;
}

function roundSvgNumber(value) {
  return Math.round(value * 10) / 10;
}

function getSessionDuration(presence) {
  if (presence.activityKind !== "game" || !presence.titleName) {
    return null;
  }

  return formatPlayDuration(presence.sessionStartedAt);
}

function isXboxAppActivity(presence) {
  return presence.activityReason === "known-xbox-app";
}

function getXboxAppPlatformLabel(presence) {
  const value = String(
    presence.platformName || presence.deviceType || "",
  ).toLowerCase();
  if (value.includes("android")) {
    return "Android";
  }

  if (value.includes("ios")) {
    return "iOS";
  }

  if (
    value.includes("pc") ||
    value.includes("win32") ||
    value.includes("windows")
  ) {
    return "PC";
  }

  return presence.platformName || presence.deviceType || "Xbox App";
}

function getLastSeenText(presence, now = Date.now()) {
  const timestamp = Date.parse(presence.lastSeenAt || presence.fetchedAt);
  if (!timestamp || Number.isNaN(timestamp) || timestamp > now) {
    return "LAST SEEN";
  }

  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (elapsedSeconds < 60) {
    return "LAST SEEN JUST NOW";
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `LAST SEEN ${elapsedMinutes}M AGO`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `LAST SEEN ${elapsedHours}H AGO`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `LAST SEEN ${elapsedDays}D AGO`;
}

function formatPlayDuration(startedAt, now = Date.now()) {
  const startedAtMs = Date.parse(startedAt);
  if (!startedAtMs || Number.isNaN(startedAtMs) || startedAtMs > now) {
    return null;
  }

  const totalSeconds = Math.max(0, Math.floor((now - startedAtMs) / 1000));
  return {
    text: formatDurationSeconds(totalSeconds),
    totalSeconds,
  };
}

function formatDurationSeconds(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function formatDurationMinutes(totalSeconds) {
  return `${Math.floor(totalSeconds / 60)}M`;
}
