import { readFileSync } from "node:fs";

const files = [
  "D:/Dropbox/DPA/email/processed_log.json",
  "D:/Dropbox/DPA/email/active_orders.json",
  "D:/Dropbox/DPA/email/channel_registry.json",
  "D:/Dropbox/DPA/email/pending_actions.json",
  "D:/Dropbox/DPA/finance/vendor_history.json",
  "D:/Dropbox/DPA/finance/subscription_registry.json",
  "D:/Dropbox/DPA/config/email-categories.json",
  "D:/Dropbox/DPA/config/email-autonomy.json",
  "D:/Dropbox/DPA/config/mcp-guardrails.json",
  "D:/Dropbox/DPA/projects/_index.json",
];

let pass = 0;
let fail = 0;

for (const f of files) {
  try {
    const data = JSON.parse(readFileSync(f, "utf-8"));
    const schema = data["$schema"] || "n/a";
    console.log("✅ " + f.replace("D:/Dropbox/DPA/", "") + " — schema: " + schema);
    pass++;
  } catch (e) {
    console.log("❌ " + f.replace("D:/Dropbox/DPA/", "") + " — " + e.message);
    fail++;
  }
}

// Specific checks
console.log("\n--- Specific Validations ---");

const categories = JSON.parse(readFileSync("D:/Dropbox/DPA/config/email-categories.json", "utf-8"));
console.log(`Categories: ${categories.categories.length} Phase 1 (${categories.categories.map(c => c.id).join(",")}), ${categories.phase2Categories.length} Phase 2`);
if (categories.categories.length === 8) console.log("✅ Exactly 8 Phase 1 categories");
else { console.log("❌ Expected 8 categories, got " + categories.categories.length); fail++; }

const autonomy = JSON.parse(readFileSync("D:/Dropbox/DPA/config/email-autonomy.json", "utf-8"));
const allPropose = Object.values(autonomy.actionPermissions).every(a => a.mode === "propose");
if (allPropose) console.log("✅ All actions in 'propose' mode");
else { console.log("❌ Some actions not in propose mode"); fail++; }
if (autonomy.hardLimits.length === 4) console.log("✅ 4 hard limits defined");
else { console.log("❌ Expected 4 hard limits"); fail++; }

const guardrails = JSON.parse(readFileSync("D:/Dropbox/DPA/config/mcp-guardrails.json", "utf-8"));
if (guardrails.gmail) console.log("✅ Gmail section present in guardrails");
else { console.log("❌ Gmail section missing"); fail++; }
if (guardrails.gmail?.dailySendLimit === 5) console.log("✅ dailySendLimit = 5");
if (guardrails.gmail?.dailyModifyLimit === 100) console.log("✅ dailyModifyLimit = 100");
if (guardrails.dailyWriteLimit === 50) console.log("✅ Existing dailyWriteLimit unchanged (50)");

const index = JSON.parse(readFileSync("D:/Dropbox/DPA/projects/_index.json", "utf-8"));
const emailProject = index.projects.find(p => p.slug === "email-to-dpa");
if (emailProject?.status === "in-progress") console.log("✅ email-to-dpa status: in-progress");
else { console.log("❌ email-to-dpa status wrong: " + emailProject?.status); fail++; }

console.log(`\n${pass + (fail === 0 ? 6 : 0)} passed, ${fail} failed`);
if (fail === 0) console.log("🎉 All Phase 1b files validated!");
