import type { MDXComponents } from 'mdx/types';
import Link from 'next/link';
import { Callout, Card, Cards, LinkCard, Steps } from '@/components/mdx/blocks';
import { InstallCommand, Pre, Tab, Tabs } from '@/components/mdx/client';

function heading(Tag: 'h2' | 'h3', className: string) {
	return function Heading({ id, children }: React.ComponentProps<'h2'>) {
		return (
			<Tag id={id} className={`group scroll-mt-20 font-semibold tracking-tight ${className}`}>
				{children}
				{/* `#` via CSS so it stays out of textContent (the TOC reads headings from the DOM). */}
				<a
					href={`#${id}`}
					aria-label="Link to this section"
					className="ml-2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 after:content-['#'] focus:opacity-100"
				/>
			</Tag>
		);
	};
}

const components: MDXComponents = {
	h2: heading('h2', 'mt-12 mb-4 text-xl first:mt-0'),
	h3: heading('h3', 'mt-8 mb-3 text-base'),
	p: props => <p className="my-4 leading-7" {...props} />,
	a: ({ href = '', ...props }) => {
		const className = 'font-medium text-primary-text underline-offset-4 hover:underline';
		if (href.startsWith('/')) return <Link href={href} className={className} {...props} />;
		if (href.startsWith('#')) return <a href={href} className={className} {...props} />;
		return <a href={href} target="_blank" rel="noreferrer" className={className} {...props} />;
	},
	strong: props => <strong className="font-semibold text-foreground" {...props} />,
	ul: props => <ul className="my-4 ml-5 list-disc space-y-2 marker:text-muted-foreground" {...props} />,
	ol: props => <ol className="my-4 ml-5 list-decimal space-y-2 marker:text-muted-foreground" {...props} />,
	li: props => <li className="pl-1 leading-7 [&>ol]:my-2 [&>p]:my-2 [&>ul]:my-2" {...props} />,
	code: props => (
		<code
			className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em] [pre_&]:rounded-none [pre_&]:bg-transparent [pre_&]:p-0 [pre_&]:text-[1em]"
			{...props}
		/>
	),
	pre: Pre,
	table: props => (
		<div className="my-6 overflow-x-auto rounded-lg border">
			<table className="w-full text-sm [&_tbody_tr:last-child_td]:border-0" {...props} />
		</div>
	),
	th: props => <th className="border-b bg-muted/50 px-3 py-2 text-left font-medium whitespace-nowrap" {...props} />,
	td: props => <td className="border-b px-3 py-2 align-top" {...props} />,
	hr: () => <hr className="my-10" />,
	blockquote: props => <blockquote className="my-6 border-l-2 pl-4 text-muted-foreground" {...props} />,
	Callout,
	Steps,
	Cards,
	Card,
	LinkCard,
	Tabs,
	Tab,
	InstallCommand
};

export function useMDXComponents(): MDXComponents {
	return components;
}
