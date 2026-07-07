import type { InjectionKey, Ref } from 'vue';

export type ContentTabItem = {
	readonly value: string;
	readonly label: string;
};

export type ContentTabsContext = {
	readonly activeValue: Ref<string | undefined>;
	register(): string;
};

export const contentTabsKey: InjectionKey<ContentTabsContext> = Symbol('content-tabs');
