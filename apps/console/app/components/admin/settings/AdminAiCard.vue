<script setup lang="ts">
import { Sparkles } from 'lucide-vue-next';

type Provider = 'anthropic' | 'openai-compatible';

const store = useIntegrationSettings();

const OPTIONS: { value: Provider; label: string; description: string }[] = [
	{ value: 'anthropic', label: 'Anthropic', description: 'Claude models through the Anthropic API or a compatible gateway.' },
	{
		value: 'openai-compatible',
		label: 'OpenAI-compatible',
		description: 'Any /v1/chat/completions endpoint: OpenAI, OpenRouter, LiteLLM, or a local Ollama / vLLM.'
	}
];

const isAnthropic = computed(() => store.draft.ai.provider === 'anthropic');
</script>

<template>
	<Card>
		<CardHeader>
			<CardTitle class="flex items-center gap-2">
				<Sparkles class="size-4 text-muted-foreground" />
				AI assistant
			</CardTitle>
			<CardDescription>
				Lets users analyze a repository and get a proposed set of services, env vars, and databases. The model receives the file tree, manifests,
				Dockerfiles, and env templates of the analyzed repository — never real .env files.
			</CardDescription>
		</CardHeader>

		<CardContent class="flex flex-col gap-5">
			<div class="flex items-start justify-between gap-4">
				<div class="flex flex-col gap-0.5">
					<span class="text-sm font-medium">Enable repository analysis</span>
					<span class="text-xs text-muted-foreground">Point the endpoint at an in-cluster model to keep code inside your infrastructure.</span>
				</div>
				<Switch v-model="store.draft.ai.enabled" :disabled="store.isSaving" aria-label="Enable repository analysis" />
			</div>

			<Separator />

			<SettingRadioCards v-model="store.draft.ai.provider" :options="OPTIONS" />

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<label for="ai-base-url" class="text-sm font-medium">Base URL</label>
					<Input
						id="ai-base-url"
						v-model="store.draft.ai.baseUrl"
						:placeholder="isAnthropic ? 'https://api.anthropic.com/v1' : 'http://ollama.ollama.svc:11434/v1'"
						class="font-mono text-xs"
						:disabled="store.isSaving"
						:aria-invalid="!store.aiBaseUrlValid"
					/>
					<span v-if="!store.aiBaseUrlValid" class="text-xs text-destructive">Enter an http(s) URL.</span>
					<span v-else class="text-xs text-muted-foreground">{{ isAnthropic ? 'Optional. Leave empty for the Anthropic API.' : 'Required.' }}</span>
				</div>
				<div class="flex flex-col gap-1.5">
					<label for="ai-model" class="text-sm font-medium">Model</label>
					<Input
						id="ai-model"
						v-model="store.draft.ai.model"
						:placeholder="isAnthropic ? 'claude-opus-5:high' : 'gpt-5:medium'"
						class="font-mono text-xs"
						:disabled="store.isSaving"
						:aria-invalid="!store.aiModelValid"
					/>
					<span v-if="!store.aiModelValid" class="text-xs text-destructive">Enter a model id.</span>
					<span v-else class="text-xs text-muted-foreground">
						Model id with an optional <code>:effort</code> suffix (minimal, low, medium, high, xhigh, max).
					</span>
				</div>
			</div>

			<div class="flex flex-col gap-1.5">
				<label for="ai-api-key" class="text-sm font-medium">API key</label>
				<Input
					id="ai-api-key"
					v-model="store.draft.ai.apiKey"
					type="password"
					autocomplete="new-password"
					:placeholder="store.aiHasApiKey ? '•••••••• (unchanged)' : ''"
					:disabled="store.isSaving"
				/>
				<span class="text-xs text-muted-foreground">Stored encrypted. Local endpoints such as Ollama usually need none.</span>
			</div>
		</CardContent>
	</Card>
</template>
