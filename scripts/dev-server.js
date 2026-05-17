import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { handleCardRequest, shutdownCardHandler } from "../src/card-handler.js";
import { getConfig } from "../src/config.js";
import { logError, logInfo, logWarn } from "../src/logger.js";

const config = getConfig();
let isShuttingDown = false;

const server = http.createServer(async (request, response) => {
  const startedAt = Date.now();
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    logInfo(`[http] ${request.method} ${url.pathname}${url.search}`);

    if (url.pathname === "/api/health" || url.pathname === "/health") {
      sendJson(response, 200, { ok: true });
      logResponse(request, response, startedAt);
      return;
    }

    if (url.pathname === "/api/card") {
      await handleCardRequest(request, response);
      logResponse(request, response, startedAt);
      return;
    }

    if (url.pathname === "/favicon.ico") {
      sendStaticImage(response, "/img/favicon.ico");
      logResponse(request, response, startedAt);
      return;
    }

    if (url.pathname.startsWith("/img/")) {
      sendStaticImage(response, url.pathname);
      logResponse(request, response, startedAt);
      return;
    }

    sendText(response, 404, "Not found");
    logResponse(request, response, startedAt);
  } catch (error) {
    logError("Request failed:", error);
    sendText(response, 500, "Internal server error");
    logResponse(request, response, startedAt);
  }
});

server.listen(config.port, () => {
  logInfo(`Local preview listening on http://localhost:${config.port}`);
});

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

async function shutdown(signal) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  logInfo(`Received ${signal}; shutting down local preview...`);

  server.close(async (error) => {
    if (error) {
      logError("HTTP server close failed:", error);
      process.exitCode = 1;
    }

    await shutdownCardHandler().catch((closeError) => {
      logError("Card handler shutdown failed:", closeError);
      process.exitCode = 1;
    });

    logInfo("Local preview stopped.");
    process.exit();
  });

  server.closeIdleConnections?.();
  setTimeout(() => {
    logWarn("Forcing local preview shutdown after timeout.");
    server.closeAllConnections?.();
    process.exit(1);
  }, 5000).unref();
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendStaticImage(response, pathname) {
  const filename = path.basename(pathname);
  const filePath = path.join(process.cwd(), "img", filename);
  if (!fs.existsSync(filePath)) {
    sendText(response, 404, "Not found");
    return;
  }

  const extension = path.extname(filename).toLowerCase();
  const contentTypes = {
    ".ico": "image/x-icon",
    ".png": "image/png",
    ".svg": "image/svg+xml; charset=utf-8",
  };

  response.writeHead(200, {
    "Content-Type": contentTypes[extension] || "application/octet-stream",
    "Cache-Control": "public, max-age=86400",
  });
  fs.createReadStream(filePath).pipe(response);
}

function logResponse(request, response, startedAt) {
  const elapsedMs = Date.now() - startedAt;
  logInfo(`[http] ${request.method} ${response.statusCode} ${elapsedMs}ms`);
}
