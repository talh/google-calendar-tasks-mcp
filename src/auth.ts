import fs from "node:fs";
import path from "node:path";
import { google } from "googleapis";

export interface Credentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export async function loadCredentials(
  credentialsPath: string,
): Promise<Credentials | null> {
  try {
    const raw = fs.readFileSync(credentialsPath, "utf-8");
    const data = JSON.parse(raw);
    if (!data.clientId || !data.clientSecret || !data.refreshToken) {
      console.error(
        "[mcp] Credentials file is missing required fields (clientId, clientSecret, refreshToken)",
      );
      return null;
    }
    return {
      clientId: data.clientId,
      clientSecret: data.clientSecret,
      refreshToken: data.refreshToken,
    };
  } catch {
    return null;
  }
}

export function createGoogleClient(
  creds: Credentials,
  credentialsPath: string,
) {
  const oauth2Client = new google.auth.OAuth2(
    creds.clientId,
    creds.clientSecret,
  );

  oauth2Client.setCredentials({
    refresh_token: creds.refreshToken,
  });

  // If Google issues a new refresh token, save it
  oauth2Client.on("tokens", (tokens) => {
    if (tokens.refresh_token) {
      try {
        const updated: Credentials = {
          ...creds,
          refreshToken: tokens.refresh_token,
        };
        const dir = path.dirname(credentialsPath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(credentialsPath, JSON.stringify(updated, null, 2));
        console.error("[mcp] Refresh token updated and saved");
      } catch (err) {
        console.error("[mcp] Failed to save updated refresh token:", err);
      }
    }
  });

  return oauth2Client;
}
