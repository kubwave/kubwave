<script setup lang="ts">
import { Mail, Send } from 'lucide-vue-next';

const store = useIntegrationSettings();

// Test recipient is local action state, not a saved setting.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const testTo = ref('');
const testValid = computed(() => EMAIL_RE.test(testTo.value.trim()));

function onSendTest() {
	if (!testValid.value) return;
	store.runTest(testTo.value.trim());
}
</script>

<template>
	<Card>
		<CardHeader>
			<div class="flex items-start justify-between gap-3">
				<div>
					<CardTitle class="flex items-center gap-2">
						<Mail class="size-4 text-muted-foreground" />
						Email
					</CardTitle>
					<CardDescription class="mt-1">Outgoing SMTP used for invitations and notifications.</CardDescription>
				</div>
				<Badge v-if="store.smtpUsingDefaults" variant="secondary" class="shrink-0">Using defaults</Badge>
			</div>
		</CardHeader>

		<CardContent class="flex flex-col gap-5">
			<div class="flex items-start justify-between gap-4">
				<div class="flex items-start gap-3">
					<span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
						<Send class="size-5" />
					</span>
					<div class="flex flex-col gap-0.5">
						<span class="text-sm font-medium">Enable email sending</span>
						<span class="text-xs text-muted-foreground">When off, invitations and notifications are not sent.</span>
					</div>
				</div>
				<Switch v-model="store.draft.smtp.enabled" :disabled="store.isSaving" aria-label="Enable email sending" />
			</div>

			<Separator />

			<div class="grid gap-4 sm:grid-cols-3">
				<div class="flex flex-col gap-1.5 sm:col-span-2">
					<label for="smtp-host" class="text-sm font-medium">Host</label>
					<Input
						id="smtp-host"
						v-model="store.draft.smtp.host"
						placeholder="smtp.example.com"
						:disabled="store.isSaving"
						:aria-invalid="!store.smtpHostValid"
					/>
					<span v-if="!store.smtpHostValid" class="text-xs text-destructive">Enter a host.</span>
				</div>
				<div class="flex flex-col gap-1.5">
					<label for="smtp-port" class="text-sm font-medium">Port</label>
					<Input
						id="smtp-port"
						v-model.number="store.draft.smtp.port"
						type="number"
						:disabled="store.isSaving"
						:aria-invalid="!store.smtpPortValid"
					/>
					<span v-if="!store.smtpPortValid" class="text-xs text-destructive">1–65535.</span>
				</div>
			</div>

			<div class="flex items-start justify-between gap-4">
				<div class="flex flex-col gap-0.5">
					<span class="text-sm font-medium">Use implicit TLS (port 465)</span>
					<span class="text-xs text-muted-foreground">Leave off for STARTTLS (587) or unencrypted dev servers (1025).</span>
				</div>
				<Switch v-model="store.draft.smtp.secure" :disabled="store.isSaving" aria-label="Use implicit TLS" />
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<label for="smtp-user" class="text-sm font-medium">Username</label>
					<Input id="smtp-user" v-model="store.draft.smtp.user" autocomplete="off" :disabled="store.isSaving" />
					<span class="text-xs text-muted-foreground">Leave empty for no authentication.</span>
				</div>
				<div class="flex flex-col gap-1.5">
					<label for="smtp-password" class="text-sm font-medium">Password</label>
					<Input
						id="smtp-password"
						v-model="store.draft.smtp.password"
						type="password"
						autocomplete="new-password"
						:placeholder="store.smtpHasPassword ? '•••••••• (unchanged)' : ''"
						:disabled="store.isSaving"
					/>
				</div>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<label for="smtp-from-name" class="text-sm font-medium">From name</label>
					<Input
						id="smtp-from-name"
						v-model="store.draft.smtp.fromName"
						placeholder="kubwave"
						:disabled="store.isSaving"
						:aria-invalid="!store.smtpFromNameValid"
					/>
					<span v-if="!store.smtpFromNameValid" class="text-xs text-destructive">Enter a from name.</span>
				</div>
				<div class="flex flex-col gap-1.5">
					<label for="smtp-from-address" class="text-sm font-medium">From address</label>
					<Input
						id="smtp-from-address"
						v-model="store.draft.smtp.fromAddress"
						type="email"
						placeholder="noreply@example.com"
						:disabled="store.isSaving"
						:aria-invalid="!store.smtpFromAddressValid"
					/>
					<span v-if="!store.smtpFromAddressValid" class="text-xs text-destructive">Enter a valid email address.</span>
				</div>
			</div>

			<Separator />

			<div class="flex flex-col gap-2">
				<div class="flex flex-col gap-3 sm:flex-row sm:items-end">
					<div class="flex flex-1 flex-col gap-1.5">
						<label for="smtp-test-to" class="text-sm font-medium">Send a test email</label>
						<Input id="smtp-test-to" v-model="testTo" type="email" placeholder="you@example.com" :disabled="store.testPending" />
					</div>
					<Button type="button" variant="outline" :disabled="store.testPending || !testValid" class="shrink-0" @click="onSendTest">
						<Send v-if="!store.testPending" />
						Send test
					</Button>
				</div>
				<p class="text-xs text-muted-foreground">Uses the saved settings — save your changes first.</p>
			</div>
		</CardContent>
	</Card>
</template>
