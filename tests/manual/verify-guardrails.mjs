import { loadGuardrails } from "../../build/guardrails.js";

const g = loadGuardrails("../config/mcp-guardrails.json");
console.log("Guardrails loaded OK");
console.log("dailyWriteLimit:", g.config.dailyWriteLimit);
console.log("gmail.dailySendLimit:", g.config.gmail?.dailySendLimit);
console.log("gmail.dailyModifyLimit:", g.config.gmail?.dailyModifyLimit);
console.log("gmail.requireApprovalForSend:", g.config.gmail?.requireApprovalForSend);
console.log("gmail.blockedAttachmentTypes:", g.config.gmail?.blockedAttachmentTypes?.length, "types");
console.log("✅ MCP server will load guardrails correctly");
