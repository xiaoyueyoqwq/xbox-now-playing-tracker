import http from "node:http";
import { handleCardRequest } from "../src/card-handler.js";
import { getConfig } from "../src/config.js";

const config = getConfig();

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (url.pathname === "/api/health" || url.pathname === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/card") {
      await handleCardRequest(request, response);
      return;
    }

    sendText(response, 404, "Not found");
  } catch (error) {
    console.error(error);
    sendText(response, 500, "Internal server error");
  }
});

server.listen(config.port, () => {
  console.log(`Local preview listening on http://localhost:${config.port}`);
});

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
