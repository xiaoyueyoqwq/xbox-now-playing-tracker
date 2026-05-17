import { refreshAllowedGamertags } from "./card-handler.js";
import { getConfig } from "./config.js";
import { logWarn } from "./logger.js";

const config = getConfig();

export async function handleCronRefreshRequest(request, response) {
  if (!config.cronSecret) {
    sendJson(response, 503, {
      ok: false,
      error: "CRON_SECRET is not configured.",
    });
    return;
  }

  if (!isAuthorizedCronRequest(request)) {
    logWarn("[security] blocked cron refresh reason=unauthorized");
    sendJson(response, 401, {
      ok: false,
      error: "Unauthorized.",
    });
    return;
  }

  const result = await refreshAllowedGamertags({ force: true });
  sendJson(response, result.ok ? 200 : 207, result);
}

function isAuthorizedCronRequest(request) {
  const authorization = request.headers.authorization || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  return token && token === config.cronSecret;
}

function sendJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}
