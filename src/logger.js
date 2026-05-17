export function logInfo(message, ...args) {
  console.info(formatMessage(message), ...args);
}

export function logWarn(message, ...args) {
  console.warn(formatMessage(message), ...args);
}

export function logError(message, ...args) {
  console.error(formatMessage(message), ...args);
}

function formatMessage(message) {
  return `[${formatTime(new Date())}] ${message}`;
}

function formatTime(date) {
  return [
    date.getHours(),
    date.getMinutes(),
    date.getSeconds()
  ].map((part) => String(part).padStart(2, "0")).join(":");
}
