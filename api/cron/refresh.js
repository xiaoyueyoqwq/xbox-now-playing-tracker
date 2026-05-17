import { handleCronRefreshRequest } from "../../src/cron-handler.js";

export default async function handler(request, response) {
  await handleCronRefreshRequest(request, response);
}
