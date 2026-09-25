#!/usr/bin/env bun
import { ensureClusterCA } from '~/lib/k8s.js';
import { ensureBunKubeFetchPatch } from '~/lib/bun-kube-fetch.js';

if (process.argv.slice(2).find(arg => !arg.startsWith('-')) !== 'mcp') {
	// Must run before any K8s calls — re-execs with NODE_EXTRA_CA_CERTS if needed
	ensureClusterCA();
	ensureBunKubeFetchPatch();
}

import { program } from 'commander';
import { registerAuditCommand } from '~/commands/audit.js';
import { registerInstallCommand } from '~/commands/install.js';
import { registerMcpCommand } from '~/commands/mcp.js';
import { registerStatusCommand } from '~/commands/status.js';
import { registerUninstallCommand } from '~/commands/uninstall.js';
import { registerUpdateCommand } from '~/commands/update.js';
import { registerVersionCommand } from '~/commands/version.js';
import { getCliVersion } from '~/lib/cli-version.js';
import { maybeRunStartupSelfUpdate } from '~/lib/startup-self-update.js';

program
	.name('kubwave')
	.description('CLI for the kubwave Control Plane — Install, Update, Status & MCP')
	.version(getCliVersion(), '-v, --version', 'Print the CLI version');

registerInstallCommand(program);
registerUpdateCommand(program);
registerStatusCommand(program);
registerUninstallCommand(program);
registerAuditCommand(program);
registerVersionCommand(program);
registerMcpCommand(program);

program.hook('preAction', async (_thisCommand, actionCommand) => {
	if (actionCommand.name() === 'mcp') return;
	const opts = actionCommand.opts();
	await maybeRunStartupSelfUpdate({
		commandName: actionCommand.name(),
		nonInteractive: opts.yes === true,
		channel: opts.channel
	});
});

program.parse();
