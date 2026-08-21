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
} else if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
  console.log(`Usage:
  sandy            Start the Feishu bot (reads ./config.yaml)
  sandy init       Interactive setup — writes config.yaml, then macOS disk auth
  sandy authorize  Trigger macOS folder-access prompts (alias: diskauth)`);
} else {
  await import("./index.js");
}
