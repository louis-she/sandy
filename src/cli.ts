const subcommand = process.argv[2];

if (subcommand === "init") {
  const { runInit } = await import("./init.js");
  await runInit(process.argv.slice(3));
} else if (subcommand === "authorize" || subcommand === "diskauth") {
  const { runAuthorize } = await import("./authorize.js");
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`Usage: sandy authorize

Touch macOS-protected folders so this Node binary gets Files and Folders prompts.
Run at the Mac (not over SSH). Alias: sandy diskauth`);
  } else {
    runAuthorize({ openSettings: true });
  }
} else if (subcommand === "models") {
  const { Cursor } = await import("@cursor/sdk");
  const { config } = await import("./config.js");
  const models = await Cursor.models.list({ apiKey: config.cursorApiKey });
  console.log(`Current model: ${config.cursorModel}`);
  for (const [i, m] of models.entries()) {
    const mark = m.id === config.cursorModel ? " *" : "";
    console.log(`${i + 1}. ${m.id}${mark}  ${m.displayName || ""}`);
  }
} else if (subcommand === "model") {
  const next = process.argv[3]?.trim();
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(`Usage:
  sandy model           Show current model
  sandy model <id>      Set cursor.model in config.yaml
  sandy models          List available models`);
  } else {
    const { config } = await import("./config.js");
    if (!next || next === "show" || next === "get") {
      console.log(`Current model: ${config.cursorModel}`);
      console.log(`Config: ${config.configPath}`);
    } else {
      const { Cursor } = await import("@cursor/sdk");
      const { setCursorModel } = await import("./chat-commands.js");
      const models = await Cursor.models.list({ apiKey: config.cursorApiKey });
      const byId = models.find((m) => m.id.toLowerCase() === next.toLowerCase());
      const id = byId?.id ?? next;
      setCursorModel(id);
      console.log(`Model set: ${id} (wrote ${config.configPath})`);
      console.log("Restart the running sandy process to apply (Feishu /model updates live without restart).");
    }
  }
} else if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
  console.log(`Usage:
  sandy            Start the Feishu bot (reads ./config.yaml)
  sandy init       Interactive setup — writes config.yaml, then macOS disk auth
  sandy authorize  Trigger macOS folder-access prompts (alias: diskauth)
  sandy models     List Cursor models available to this API key
  sandy model <id> Change cursor.model in config.yaml

Feishu chat commands (same bot session):
  /help            Show help
  /models          List models + current
  /model <id>      Switch model (persists to config.yaml)
  /new             Start a new conversation`);
} else {
  await import("./index.js");
}
