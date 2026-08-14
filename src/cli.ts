const subcommand = process.argv[2];

if (subcommand === "init") {
  const { runInit } = await import("./init.js");
  await runInit(process.argv.slice(3));
} else if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
  console.log(`Usage:
  sandy          Start the Feishu bot (reads ./config.yaml)
  sandy init     Interactive setup — writes config.yaml`);
} else {
  await import("./index.js");
}
