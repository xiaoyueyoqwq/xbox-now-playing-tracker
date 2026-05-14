import { handleCardRequest } from "../src/card-handler.js";

export default async function handler(request, response) {
  await handleCardRequest(request, response);
}
