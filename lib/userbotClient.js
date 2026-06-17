/** GramJS client — scraper ulanadi, bot crosspost uchun o'qiydi */

let activeClient = null;

function setActiveClient(client) {
  activeClient = client;
}

function clearActiveClient() {
  activeClient = null;
}

function getActiveClient() {
  return activeClient?.connected ? activeClient : null;
}

module.exports = { setActiveClient, clearActiveClient, getActiveClient };
