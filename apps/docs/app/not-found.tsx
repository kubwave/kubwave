import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
	return (
		<main className="mx-auto flex max-w-xl flex-col items-start px-4 py-24 sm:px-6">
			<p className="font-mono text-sm text-muted-foreground">404</p>
			<h1 className="mt-2 text-2xl font-semibold tracking-tight">Page not found</h1>
			<p className="mt-2 text-muted-foreground">
				This page does not exist in this version of the docs. It may have moved, or only exist on the other release channel.
			</p>
			<Button asChild className="mt-6">
				<Link href="/">Back to the docs</Link>
			</Button>
		</main>
	);
}
