// import utils
import fs from 'fs/promises';

let refreshToken = null;
let clientId = null;
let clientSecret = null;
let accessToken = null;
let acctNumber = null;
let acctBal = -1;23
const baseUrl = "https://api.tastyworks.com"
const USER_AGENT = "stock-api/0.1";


// Load and parse the file
const data = await fs.readFile('./api.key', 'utf-8');
const lines = data.split('\n');

lines.forEach(line => {
  if (line.startsWith('REFRESH_TOKEN=')) refreshToken = line.split('=')[1];
  if (line.startsWith('CLIENT_ID=')) clientId = line.split('=')[1];
  if (line.startsWith('CLIENT_SECRET=')) clientSecret = line.split('=')[1];
});

//throw error if any null

if (refreshToken === null || clientId === null || clientSecret === null) {
  throw new Error('Missing required environment variables in api.key');
}


//function to get access token, which is used in all other api calls. 
async function getAccessToken({ refreshToken, clientSecret }) {
  const response = await fetch(`${baseUrl}/oauth/token`, {method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_secret: clientSecret,
      scope: "read",
    }),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Token request failed: ${response.status} ${text}`);
  }

  const json = JSON.parse(text);
  return json.access_token;
}

async function fetchAccounts(accessToken) {
  const response = await fetch(`${baseUrl}/customers/me/accounts`, {method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Accounts request failed: ${response.status} ${text}`);
  }

  return JSON.parse(text);
}

async function fetchBalances(acctNumber, accessToken){
  const response = await fetch(`${baseUrl}/accounts/${acctNumber}/balances`, 
  {method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": USER_AGENT,
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Accounts request failed: ${response.status} ${text}`);
  }

  return JSON.parse(text);
}

accessToken = await getAccessToken({ refreshToken, clientSecret });
//console.log(accessToken);
await fetchAccounts(accessToken)
  .then(response => {acctNumber = response.data.items[0].account['account-number'];})
console.log(acctNumber);

await fetchBalances(acctNumber, accessToken)
  //.then(response => acctBal = response)
 .then(response => acctBal = response.data["margin-equity"])
console.log(acctBal);

