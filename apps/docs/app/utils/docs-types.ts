export type { TocLink } from '@nuxt/content';

export type HeroAction = {
	readonly text: string;
	readonly link: string;
	readonly variant?: string;
	readonly icon?: string;
};

export type DocsHero = {
	readonly tagline?: string;
	readonly actions?: readonly HeroAction[];
};
