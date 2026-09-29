'use client';

import { ChevronLeftIcon, ChevronRightIcon, EllipsisIcon, ShieldIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { TableCell, TableRow } from '@/components/ui/table';

export function RoleBadge({ isAdmin }: { isAdmin: boolean }) {
	if (!isAdmin)
		return (
			<Badge variant="outline" className="text-muted-foreground">
				Member
			</Badge>
		);
	return (
		<Badge variant="outline" className="border-primary/30 text-primary-text">
			<ShieldIcon />
			Admin
		</Badge>
	);
}

export function RowMenu({ label, disabled, children }: { label: string; disabled?: boolean; children: React.ReactNode }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" size="icon-sm" aria-label={label} disabled={disabled}>
					<EllipsisIcon />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-48">
				{children}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function SkeletonRows({ columns }: { columns: number }) {
	return Array.from({ length: 5 }, (_, row) => (
		<TableRow key={row} className="hover:bg-transparent">
			{Array.from({ length: columns }, (_, column) => (
				<TableCell key={column} className={column === 0 ? 'pl-4' : undefined}>
					<Skeleton className="h-4 w-24" />
				</TableCell>
			))}
		</TableRow>
	));
}

export function EmptyTableRow({ columns, children }: { columns: number; children: React.ReactNode }) {
	return (
		<TableRow className="hover:bg-transparent">
			<TableCell colSpan={columns} className="py-10 text-center text-muted-foreground">
				{children}
			</TableCell>
		</TableRow>
	);
}

// Hides itself on a single page, so callers don't guard it.
export function TablePager({ page, pageCount, onPageChange }: { page: number; pageCount: number; onPageChange: (page: number) => void }) {
	if (pageCount <= 1) return null;
	return (
		<div className="mt-3 flex items-center justify-end gap-2">
			<Button variant="outline" size="icon-sm" disabled={page <= 1} aria-label="Previous page" onClick={() => onPageChange(page - 1)}>
				<ChevronLeftIcon />
			</Button>
			<span className="text-sm text-muted-foreground tabular-nums">
				Page {page} of {pageCount}
			</span>
			<Button variant="outline" size="icon-sm" disabled={page >= pageCount} aria-label="Next page" onClick={() => onPageChange(page + 1)}>
				<ChevronRightIcon />
			</Button>
		</div>
	);
}
