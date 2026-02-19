#!/usr/bin/env node

/**
 * One-time OAuth setup script for google-calendar-tasks-mcp.
 *
 * Usage:
 *   node auth.js
 *
 * This script:
 * 1. Prompts for your Google Cloud OAuth client ID and client secret
 * 2. Opens your browser to the Google consent screen
 * 3. Listens for the redirect on http://localhost:3000/callback
 * 4. Exchanges the authorization code for a refresh token
 * 5. Saves credentials to the OS-specific default path (or GOOGLE_MCP_CREDENTIALS_PATH)
 */

import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { exec } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform } from "node:os";
import { OAuth2Client } from "google-auth-library";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/gmail.modify",
];
const REDIRECT_URI = "http://localhost:3000/callback";
const APP_NAME = "google-calendar-tasks-mcp";

function getDefaultCredentialsPath() {
  if (platform() === "win32") {
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, APP_NAME, "credentials.json");
  }
  return join(homedir(), ".config", APP_NAME, "credentials.json");
}

function openBrowser(url) {
  const plat = platform();
  if (plat === "win32") exec(`start "" "${url}"`);
  else if (plat === "darwin") exec(`open "${url}"`);
  else exec(`xdg-open "${url}"`);
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  const credentialsPath = process.env.GOOGLE_MCP_CREDENTIALS_PATH ?? getDefaultCredentialsPath();

  console.log("=== Google Calendar & Tasks MCP — OAuth Setup ===\n");
  console.log(`Credentials will be saved to: ${credentialsPath}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  let clientId = "";
  let clientSecret = "";

  // Check for existing credentials (re-auth scenario)
  if (existsSync(credentialsPath)) {
    try {
      const existing = JSON.parse(readFileSync(credentialsPath, "utf-8"));
      if (existing.clientId && existing.clientSecret) {
        console.log("Found existing credentials. Re-authorizing with same client ID.\n");
        clientId = existing.clientId;
        clientSecret = existing.clientSecret;
      }
    } catch {
      // Ignore parse errors, prompt for new credentials
    }
  }

  if (!clientId) {
    console.log("You need a Google Cloud OAuth 2.0 client ID (Desktop type).");
    console.log("Create one at: https://console.cloud.google.com/apis/credentials\n");
    clientId = (await ask(rl, "Client ID: ")).trim();
    clientSecret = (await ask(rl, "Client Secret: ")).trim();
  }

  if (!clientId || !clientSecret) {
    console.error("Error: Client ID and Client Secret are required.");
    rl.close();
    process.exit(1);
  }

  const oauth2Client = new OAuth2Client(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });

  console.log("\nOpening browser for authorization...\n");
  openBrowser(authUrl);
  console.log("If the browser didn't open, visit this URL manually:");
  console.log(authUrl + "\n");

  // Start local server to receive the callback
  const code = await new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, "http://localhost:3000");
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const authCode = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400);
        res.end(`Authorization failed: ${error}`);
        server.close();
        reject(new Error(`Authorization failed: ${error}`));
        return;
      }

      if (!authCode) {
        res.writeHead(400);
        res.end("No authorization code received");
        server.close();
        reject(new Error("No authorization code received"));
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <html><body style="font-family: system-ui; text-align: center; padding: 60px;">
          <h2>Authorization successful!</h2>
          <p>You can close this tab and return to the terminal.</p>
        </body></html>
      `);
      server.close();
      resolve(authCode);
    });

    server.listen(3000, () => {
      console.log("Waiting for authorization callback on http://localhost:3000/callback ...");
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error("Port 3000 is already in use. Close the process using it and try again."));
      } else {
        reject(err);
      }
    });
  });

  rl.close();

  // Exchange code for tokens
  console.log("\nExchanging authorization code for tokens...");
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    console.error(
      "Error: No refresh token received. This can happen if you previously authorized this app.",
    );
    console.error("Try revoking access at https://myaccount.google.com/permissions and re-running this script.");
    process.exit(1);
  }

  // Save credentials
  const credentials = {
    clientId,
    clientSecret,
    refreshToken: tokens.refresh_token,
  };

  const dir = dirname(credentialsPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(credentialsPath, JSON.stringify(credentials, null, 2));

  console.log(`\nCredentials saved to: ${credentialsPath}`);
  console.log("\nSetup complete! The MCP server is ready to use.");
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
