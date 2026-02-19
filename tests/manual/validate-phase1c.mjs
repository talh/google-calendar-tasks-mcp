import { readFileSync } from "node:fs";

const workflows = [
  { file: "D:/Dropbox/DPA/n8n_workflows/05_email_sync.json", name: "Email Sync", expectedNodes: 3, schedule: 15 },
  { file: "D:/Dropbox/DPA/n8n_workflows/06_email_urgent_monitor.json", name: "Urgent Monitor", expectedNodes: 4, schedule: 5 },
  { file: "D:/Dropbox/DPA/n8n_workflows/07_email_action_pickup.json", name: "Action Pickup", expectedNodes: 9, schedule: 5 },
];

let pass = 0;
let fail = 0;

function check(label, condition) {
  if (condition) {
    console.log("  ✅ " + label);
    pass++;
  } else {
    console.log("  ❌ " + label);
    fail++;
  }
}

for (const w of workflows) {
  console.log("\n--- " + w.name + " ---");

  let data;
  try {
    data = JSON.parse(readFileSync(w.file, "utf-8"));
    check("Valid JSON", true);
  } catch (e) {
    console.log("  ❌ Invalid JSON: " + e.message);
    fail++;
    continue;
  }

  check("Has name: " + data.name, data.name && data.name.startsWith("DPA - "));
  check("Node count: " + data.nodes.length + " (expected " + w.expectedNodes + ")", data.nodes.length === w.expectedNodes);
  check("Has connections", Object.keys(data.connections).length > 0);
  check("Has DPA tag", data.tags && data.tags.some(t => t.name === "DPA"));
  check("Active is false (safe for import)", data.active === false);

  // Check schedule trigger
  const trigger = data.nodes.find(n => n.type === "n8n-nodes-base.scheduleTrigger");
  check("Has schedule trigger", !!trigger);
  if (trigger) {
    const interval = trigger.parameters.rule.interval[0];
    if (w.schedule === 5) {
      check("Schedule: every 5 min", interval.field === "minutes" && !interval.minutesInterval);
    } else {
      check("Schedule: every " + w.schedule + " min", interval.minutesInterval === w.schedule);
    }
  }

  // Check Gmail nodes have credential placeholder
  const gmailNodes = data.nodes.filter(n =>
    n.type === "n8n-nodes-base.gmail" ||
    (n.type === "n8n-nodes-base.httpRequest" && n.credentials?.gmailOAuth2)
  );
  for (const gn of gmailNodes) {
    check("Gmail credential placeholder in '" + gn.name + "'",
      gn.credentials?.gmailOAuth2?.id === "CONFIGURE_ME");
  }

  // Check Code nodes have jsCode
  const codeNodes = data.nodes.filter(n => n.type === "n8n-nodes-base.code");
  for (const cn of codeNodes) {
    check("Code node '" + cn.name + "' has jsCode (" + cn.parameters.jsCode.length + " chars)",
      cn.parameters.jsCode && cn.parameters.jsCode.length > 50);
  }
}

// Specific workflow checks
console.log("\n--- Specific Validations ---");

const w05 = JSON.parse(readFileSync(workflows[0].file, "utf-8"));
const gmailNode05 = w05.nodes.find(n => n.type === "n8n-nodes-base.gmail");
check("WF05: Gmail query = 'in:inbox newer_than:1d'", gmailNode05.parameters.filters.q === "in:inbox newer_than:1d");
check("WF05: Gmail limit = 50", gmailNode05.parameters.limit === 50);
const code05 = w05.nodes.find(n => n.name === "Format and Write Cache");
check("WF05: Code writes to inbox_cache.md", code05.parameters.jsCode.includes("inbox_cache.md"));

const w06 = JSON.parse(readFileSync(workflows[1].file, "utf-8"));
const readState = w06.nodes.find(n => n.name === "Read Last Check State");
check("WF06: State read from .urgent_state.json", readState.parameters.jsCode.includes(".urgent_state.json"));
const gmailNode06 = w06.nodes.find(n => n.type === "n8n-nodes-base.gmail");
check("WF06: Gmail query uses expression", gmailNode06.parameters.filters.q === "={{ $json.query }}");
const urgencyCode = w06.nodes.find(n => n.name === "Check Urgency and Write Alerts");
check("WF06: Has security keywords", urgencyCode.parameters.jsCode.includes("password reset"));
check("WF06: Has deadline keywords", urgencyCode.parameters.jsCode.includes("due today"));
check("WF06: Writes urgent_alerts.md", urgencyCode.parameters.jsCode.includes("urgent_alerts.md"));
check("WF06: Updates state file", urgencyCode.parameters.jsCode.includes(".urgent_state.json"));

const w07 = JSON.parse(readFileSync(workflows[2].file, "utf-8"));
const readPending = w07.nodes.find(n => n.name === "Read Pending Actions");
check("WF07: Reads pending_actions.json", readPending.parameters.jsCode.includes("pending_actions.json"));
check("WF07: Code node references archive", readPending.parameters.jsCode.includes("'archive'"));
// trash and label routing is handled by the Switch node (validated below)
const switchRules = JSON.stringify(w07.nodes.find(n => n.type === "n8n-nodes-base.switch")?.parameters?.rules);
check("WF07: Switch routes trash type", switchRules.includes('"trash"'));
check("WF07: Switch routes label type", switchRules.includes('"label"'));
check("WF07: Normalizes unsubscribe to archive", readPending.parameters.jsCode.includes("'unsubscribe'") && readPending.parameters.jsCode.includes("'archive'"));
const ifNode = w07.nodes.find(n => n.type === "n8n-nodes-base.if");
check("WF07: Has If node for empty check", !!ifNode);
const switchNode = w07.nodes.find(n => n.type === "n8n-nodes-base.switch");
check("WF07: Has Switch node for routing", !!switchNode);
check("WF07: Switch has 3 outputs (archive/trash/label)", switchNode.parameters.rules.values.length === 3);
const archiveNode = w07.nodes.find(n => n.name === "Archive Email");
check("WF07: Archive uses native Gmail removeLabels", archiveNode.type === "n8n-nodes-base.gmail" && archiveNode.parameters.operation === "removeLabels");
check("WF07: Archive removes INBOX label", JSON.stringify(archiveNode.parameters.labelIds) === '["INBOX"]');
const trashNode = w07.nodes.find(n => n.name === "Trash Email");
check("WF07: Trash uses native Gmail addLabels", trashNode.type === "n8n-nodes-base.gmail" && trashNode.parameters.operation === "addLabels");
check("WF07: Trash adds TRASH label", JSON.stringify(trashNode.parameters.labelIds) === '["TRASH"]');
const addLabelsNode = w07.nodes.find(n => n.name === "Add Labels");
check("WF07: Add Labels uses native Gmail addLabels", addLabelsNode.type === "n8n-nodes-base.gmail" && addLabelsNode.parameters.operation === "addLabels");
check("WF07: Add Labels uses dynamic expression", addLabelsNode.parameters.labelIds === "={{ $json.addLabelIds }}");
const gmailNodes07 = w07.nodes.filter(n => n.type === "n8n-nodes-base.gmail");
check("WF07: All 3 Gmail nodes have credentials", gmailNodes07.every(n => n.credentials?.gmailOAuth2?.id === "CONFIGURE_ME"));
// Verify all 3 Gmail paths converge to Update Actions File
const connections07 = w07.connections;
check("WF07: Archive → Update File", connections07["Archive Email"]?.main[0][0]?.node === "Update Actions File");
check("WF07: Trash → Update File", connections07["Trash Email"]?.main[0][0]?.node === "Update Actions File");
check("WF07: Add Labels → Update File", connections07["Add Labels"]?.main[0][0]?.node === "Update Actions File");
const updateCode = w07.nodes.find(n => n.name === "Update Actions File");
check("WF07: Update code moves to synced", updateCode.parameters.jsCode.includes("syncedAt"));
check("WF07: Update code handles Gmail response ID", updateCode.parameters.jsCode.includes("j.id || j.messageId"));

// Check existing workflows still exist
const existingFiles = [
  "D:/Dropbox/DPA/n8n_workflows/01_task_sync.json",
  "D:/Dropbox/DPA/n8n_workflows/02_calendar_sync.json",
  "D:/Dropbox/DPA/n8n_workflows/03_birthday_sync.json",
  "D:/Dropbox/DPA/n8n_workflows/04_staging_pickup.json",
];
console.log("\n--- Existing Workflows ---");
for (const f of existingFiles) {
  try {
    JSON.parse(readFileSync(f, "utf-8"));
    check(f.split("/").pop() + " still valid", true);
  } catch (e) {
    check(f.split("/").pop() + " still valid", false);
  }
}

console.log("\n" + pass + " passed, " + fail + " failed");
if (fail === 0) console.log("🎉 All Phase 1c validations passed!");
