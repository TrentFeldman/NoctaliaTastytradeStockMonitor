// websocketTest.js
import fs from "fs/promises";

const BASE_URL = "https://api.tastyworks.com";
const ACCOUNT_STREAMER_URL = "wss://streamer.tastyworks.com";
const USER_AGENT = "stock-api/0.1";
const TEST_DURATION_MS = 30_000;

let ws = null;
let lastUpdateTime = null;

// ---------- helpers ----------

function parseKeyFile(rawText) {
  const keys = {};

  for (const rawLine of rawText.split("\n")) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim();

    keys[key] = value;
  }

  return keys;
}

async function loadApiKeys() {
  const rawText = await fs.readFile("./api.key", "utf-8");
  const keys = parseKeyFile(rawText);

  const refreshToken = keys.REFRESH_TOKEN;
  const clientId = keys.CLIENT_ID;
  const clientSecret = keys.CLIENT_SECRET;

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error(
      "Missing REFRESH_TOKEN, CLIENT_ID, or CLIENT_SECRET in api.key"
    );
  }

  return { refreshToken, clientId, clientSecret };
}

async function parseJsonResponse(response, label) {
  const text = await response.text();

  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${label} returned non-JSON: ${response.status} ${text}`);
  }

  if (!response.ok) {
    throw new Error(
      `${label} failed: ${response.status} ${JSON.stringify(json, null, 2)}`
    );
  }

  return json;
}

function money(value) {
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  return `$${num.toFixed(2)}`;
}

function findFieldDeep(obj, wantedKey) {
  if (!obj || typeof obj !== "object") return undefined;

  if (Object.prototype.hasOwnProperty.call(obj, wantedKey)) {
    return obj[wantedKey];
  }

  for (const value of Object.values(obj)) {
    const found = findFieldDeep(value, wantedKey);
    if (found !== undefined) return found;
  }

  return undefined;
}

// ---------- REST API ----------

async function getAccessToken({ refreshToken, clientId, clientSecret }) {
  const response = await fetch(`${BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,

      // This should match what your OAuth app / refresh token is allowed to use.
      // If this ever breaks token refresh, remove this line and rely on the
      // scopes already attached to your refresh token.
      scope: "read trade market-data",
    }),
  });

  const json = await parseJsonResponse(response, "Token request");

  if (!json.access_token) {
    throw new Error(`Token response did not include access_token`);
  }

  return json.access_token;
}

async function fetchAccounts(accessToken) {
  const response = await fetch(`${BASE_URL}/customers/me/accounts`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
    },
  });

  return parseJsonResponse(response, "Accounts request");
}

async function fetchBalances(accountNumber, accessToken) {
  const response = await fetch(`${BASE_URL}/accounts/${accountNumber}/balances`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
    },
  });

  return parseJsonResponse(response, "Balances request");
}

// ---------- ACCOUNT WEBSOCKET ----------

function createAccountStreamer({ accessToken, accountNumber, onMessage }) {
  let requestId = 0;
  let heartbeatTimer = null;
  let closedByUs = false;

  function nextRequestId() {
    requestId += 1;
    return requestId;
  }

    function send(action, value) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        console.warn(`⚠ Cannot send ${action}; websocket is not open`);
        return;
    }

    const payload = {
        action,
        "auth-token": `Bearer ${accessToken}`,
        "request-id": String(nextRequestId()),
        source: "tastytrade-api-js-sdk",
    };

    if (value !== undefined) {
        payload.value = value;
    }

    console.log("→ sending:", JSON.stringify(payload));
    ws.send(JSON.stringify(payload));
    }

  function startHeartbeat() {
    heartbeatTimer = setInterval(() => {
      send("heartbeat");
    }, 20_000);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  ws = new WebSocket(ACCOUNT_STREAMER_URL);

  ws.onopen = () => {
    console.log("✓ Account WebSocket connected");

    // For one account, Tasty's SDK sends the account number as a string.
    // For multiple accounts, it sends an array.
    send("connect", accountNumber);

    console.log(`✓ Sent connect request for account ${accountNumber}`);
    startHeartbeat();
  };

  ws.onmessage = (event) => {
    let json;

    try {
      json = JSON.parse(String(event.data));
    } catch (error) {
      console.error("✗ Could not parse websocket message:", error.message);
      console.error("Raw message:", event.data);
      return;
    }

    const messages = Array.isArray(json.results) ? json.results : [json];

    for (const message of messages) {
      onMessage(message);
    }
  };

  ws.onerror = (event) => {
    console.error("✗ Account WebSocket error:", event?.message ?? event);
  };

  ws.onclose = (event) => {
    stopHeartbeat();

    if (closedByUs) {
      console.log("✓ Account WebSocket closed cleanly");
    } else {
      console.log(
        `✗ Account WebSocket disconnected: code=${event.code}, reason=${event.reason || "none"}`
      );
    }
  };

  return {
    close() {
      closedByUs = true;
      stopHeartbeat();

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    },
  };
}

// ---------- MAIN ----------

try {
  console.log("=== TASTYTRADE BALANCE + ACCOUNT STREAM TEST ===\n");

  console.log("1. Loading API keys...");
  const apiKeys = await loadApiKeys();
  console.log("✓ API keys loaded\n");

  console.log("2. Getting access token...");
  const accessToken = await getAccessToken(apiKeys);
  console.log("✓ Access token obtained\n");

  console.log("3. Fetching account info...");
  const accountsResponse = await fetchAccounts(accessToken);

  const firstItem = accountsResponse?.data?.items?.[0];
  const accountNumber = firstItem?.account?.["account-number"];

  if (!accountNumber) {
    throw new Error(
      `Could not find account number in response: ${JSON.stringify(
        accountsResponse,
        null,
        2
      )}`
    );
  }

  console.log(`✓ Account: ${accountNumber}\n`);

  console.log("4. REST API balance check:");
  const balanceResponse = await fetchBalances(accountNumber, accessToken);

  const restMarginEquity = balanceResponse?.data?.["margin-equity"];

  if (restMarginEquity === undefined) {
    console.log("⚠ Could not find data.margin-equity in balance response");
    console.log(JSON.stringify(balanceResponse, null, 2));
  } else {
    console.log(`   Margin equity REST: ${money(restMarginEquity)}`);
  }

  console.log(`   Timestamp: ${new Date().toLocaleTimeString()}\n`);

  console.log("5. Account WebSocket test:");
  console.log("   Listening for account messages for 30 seconds...\n");

  let messageCount = 0;
  let balanceLikeUpdateCount = 0;
  let latestMarginEquity = restMarginEquity;

  const streamer = createAccountStreamer({
    accessToken,
    accountNumber,
    onMessage(message) {
      messageCount++;
      lastUpdateTime = new Date();

      const action = message.action ?? message.type ?? "unknown";
      const status = message.status ? ` status=${message.status}` : "";

      console.log(
        `   [${messageCount}] ${lastUpdateTime.toLocaleTimeString()} action=${action}${status}`
      );

      const marginEquity = findFieldDeep(message, "margin-equity");
      const netLiq = findFieldDeep(message, "net-liquidating-value");

      if (marginEquity !== undefined) {
        balanceLikeUpdateCount++;
        latestMarginEquity = marginEquity;

        console.log(`       margin-equity: ${money(marginEquity)}`);

        if (restMarginEquity !== undefined) {
          const delta = Number(marginEquity) - Number(restMarginEquity);

          if (!Number.isNaN(delta) && Math.abs(delta) > 0.01) {
            console.log(`       change from REST baseline: ${money(delta)}`);
          }
        }
      }

      if (netLiq !== undefined) {
        console.log(`       net-liquidating-value: ${money(netLiq)}`);
      }

      // This is intentionally verbose while testing.
      // Once it works, you can delete this line.
      console.log(`       raw: ${JSON.stringify(message)}`);
    },
  });

  await new Promise((resolve) => setTimeout(resolve, TEST_DURATION_MS));

  streamer.close();

  console.log("\n=== TEST RESULTS ===");
  console.log(`REST margin equity:       ${money(restMarginEquity)}`);
  console.log(`Latest WS margin equity:  ${money(latestMarginEquity)}`);
  console.log(`WS messages received:     ${messageCount}`);
  console.log(`Balance-like WS updates:  ${balanceLikeUpdateCount}`);
  console.log(
    `Last WS message time:     ${
      lastUpdateTime?.toLocaleTimeString() ?? "None"
    }`
  );

  if (messageCount > 0) {
    console.log("\n✓ Account websocket connected and received messages.");
  } else {
    console.log("\n⚠ WebSocket connected, but no account messages arrived.");
    console.log("  That can be normal if nothing account-related happened.");
    console.log("  Account streaming is not the same as live quote/P&L streaming.");
  }
} catch (error) {
  console.error("\n✗ Error:", error.message);
  console.error(error.stack);

  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }

  process.exit(1);
}