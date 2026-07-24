<script setup lang="ts">
// Owns the unified draft/save store for the Integrations tab and wires the consolidated save bar.
const store = provideIntegrationSettings();

const sections = [
	{ id: 'integration-domain', label: 'App domain' },
	{ id: 'integration-registry', label: 'Build registry' },
	{ id: 'integration-github', label: 'GitHub' },
	{ id: 'integration-email', label: 'Email' },
	{ id: 'integration-metrics', label: 'Service metrics' }
] as const;

function scrollTo(id: string) {
	document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
</script>

<template>
	<div class="grid gap-6 lg:grid-cols-[11rem_1fr]">
		<nav class="sticky top-16 hidden self-start flex-col gap-0.5 lg:flex" aria-label="Integration sections">
			<button
				v-for="section in sections"
				:key="section.id"
				type="button"
				class="rounded-md px-2.5 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
				@click="scrollTo(section.id)"
			>
				{{ section.label }}
			</button>
		</nav>

		<div class="flex min-w-0 flex-col gap-6">
			<div id="integration-domain" class="scroll-mt-16"><AdminDomainCard /></div>
			<div id="integration-registry" class="scroll-mt-16"><AdminRegistryCard /></div>
			<div id="integration-github" class="scroll-mt-16"><AdminGithubCard /></div>
			<div id="integration-email" class="scroll-mt-16"><AdminEmailCard /></div>
			<div id="integration-metrics" class="scroll-mt-16"><AdminMetricsCard /></div>

			<SettingsSaveBar :count="store.dirtyCount" :saving="store.isSaving" :can-save="store.canSave" @save="store.save" @discard="store.discard" />
		</div>
	</div>
</template>
