import { Sidebar } from '@/components/sidebar';
import { Toc } from '@/components/toc';

export default function DocsLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="mx-auto flex max-w-[88rem] gap-10 px-4 sm:px-6">
			<aside className="sticky top-12 hidden h-[calc(100svh-3rem)] w-60 shrink-0 overflow-y-auto py-8 lg:block">
				<Sidebar />
			</aside>
			<main className="min-w-0 flex-1 py-10">
				<div className="mx-auto max-w-[46rem]">{children}</div>
			</main>
			<aside className="sticky top-12 hidden h-[calc(100svh-3rem)] w-52 shrink-0 overflow-y-auto py-10 xl:block">
				<Toc />
			</aside>
		</div>
	);
}
