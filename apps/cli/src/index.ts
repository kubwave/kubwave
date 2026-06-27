#!/usr/bin/env bun
import { ensureClusterCA } from '~/lib/k8s.js';

// Must run before any K8s calls — re-execs with NODE_EXTRA_CA_CERTS if needed
ensureClusterCA();

import { program } from 'commander';
import { registerInstallCommand } from '~/commands/install.js';
import { registerStatusCommand } from '~/commands/status.js';
import { registerUninstallCommand } from '~/commands/uninstall.js';
import { registerUpdateCommand } from '~/commands/update.js';
import { registerVersionCommand } from '~/commands/version.js';
import { getCliVersion } from '~/lib/cli-version.js';
import { maybeRunStartupSelfUpdate } from '~/lib/startup-self-update.js';

program
	.name('kubwave')
	.description('CLI for the kubwave Control Plane — Install, Update & Status')
	.version(getCliVersion(), '-v, --version', 'Print the CLI version');

registerInstallCommand(program);
registerUpdateCommand(program);
registerStatusCommand(program);
registerUninstallCommand(program);
registerVersionCommand(program);

program.hook('preAction', async (_thisCommand, actionCommand) => {
	await maybeRunStartupSelfUpdate({ commandName: actionCommand.name() });
});

program.parse();
