<!-- Auth canvas: a faint technical grid that fades at the edges, plus a thin Wave
     hairline along the top as a quiet brand signal. The page supplies the card. -->
<template>
	<div class="relative grid min-h-dvh place-items-center overflow-hidden bg-background px-4 py-10">
		<div
			aria-hidden="true"
			class="bg-grid pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_60%_50%_at_50%_42%,black,transparent)]"
		/>
		<div aria-hidden="true" class="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-primary/55 to-transparent" />
		<main class="relative w-full max-w-sm"><slot /></main>
	</div>
</template>
