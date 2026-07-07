import { defineCollection, defineContentConfig } from '@nuxt/content';
import { z } from 'zod';

export default defineContentConfig({
	collections: {
		docs: defineCollection({
			type: 'page',
			source: '**/*.md',
			schema: z.object({
				title: z.string(),
				description: z.string(),
				hero: z
					.object({
						tagline: z.string().optional(),
						actions: z
							.array(
								z.object({
									text: z.string(),
									link: z.string(),
									variant: z.string().optional(),
									icon: z.string().optional()
								})
							)
							.optional()
					})
					.optional(),
				navigation: z.unknown().optional()
			})
		})
	}
});
