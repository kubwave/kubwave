'use client';

import { ArrowLeftIcon, BoxesIcon, SparklesIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ServiceIcon } from '@/features/service/service-icon';
import type { Environment, Service } from '@/lib/api/types';
import { DATABASE_ENGINES, DATABASE_ENGINE_UI } from '@/lib/service-types';
import { cn } from '@/lib/utils';
import { AnalyzeForm } from './analyze-form';
import { ComposeForm } from './compose-form';
import { DatabaseForm } from './database-form';
import { DockerfileForm } from './dockerfile-form';
import { ImageForm } from './image-form';
import type { SourceFormProps } from './parts';
import { RepoForm } from './repo-form';
import { TemplateForm } from './template-form';
import { useAiStatus, useTemplates } from './use-create-service';

type Option = {
	id: string;
	group: string;
	label: string;
	title?: string;
	description: string;
	icon: React.ReactNode;
	render: (props: SourceFormProps) => React.ReactNode;
};

export function CreateServiceDialog({
	open,
	onOpenChange,
	environment,
	existing,
	onCreated
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	environment: Environment;
	existing: Service[];
	onCreated: (created: Service[]) => void;
}) {
	const [selectedId, setSelectedId] = useState<string | null>(null);
	// While generated template secrets are on screen the dialog must not be dismissed by accident.
	const [locked, setLocked] = useState(false);
	const [wasOpen, setWasOpen] = useState(open);
	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) {
			setSelectedId(null);
			setLocked(false);
		}
	}

	const aiStatus = useAiStatus();
	const templates = useTemplates();

	const icon = (node: React.ReactNode) => <span className="text-muted-foreground [&_svg]:size-4">{node}</span>;
	const options: Option[] = [
		...(aiStatus.data?.enabled
			? [
					{
						id: 'analyze',
						group: 'Assistant',
						label: 'Analyze repository',
						description: 'AI proposes the services, variables and databases a repo needs. You review before anything is created.',
						icon: icon(<SparklesIcon />),
						render: (props: SourceFormProps) => <AnalyzeForm {...props} existing={existing} />
					}
				]
			: []),
		...(
			[
				['github-repo', 'GitHub repository', 'Build & deploy a repo from a connected GitHub App, private repos without a deploy key.'],
				['gitea-repo', 'Gitea repository', 'Build & deploy a repo from a connected Gitea account, private repos without a deploy key.'],
				['private-repo', 'Private repository (SSH)', 'Build & deploy a private Git repo over SSH with a team deploy key.'],
				['public-repo', 'Public repository', 'Build & deploy a public Git repo with Nixpacks, no Dockerfile needed.']
			] as const
		).map(([source, label, description]) => ({
			id: source,
			group: 'Deploy from source',
			label,
			description,
			icon: icon(<ServiceIcon type={source} />),
			render: (props: SourceFormProps) => <RepoForm {...props} source={source} />
		})),
		{
			id: 'docker-image',
			group: 'Docker',
			label: 'Docker image',
			description: 'Run an existing container image from a public or private registry.',
			icon: icon(<ServiceIcon type="docker-image" />),
			render: props => <ImageForm {...props} />
		},
		{
			id: 'dockerfile',
			group: 'Docker',
			label: 'Dockerfile',
			description: 'Paste a self-contained Dockerfile, built in-cluster.',
			icon: icon(<ServiceIcon type="dockerfile" />),
			render: props => <DockerfileForm {...props} />
		},
		{
			id: 'compose',
			group: 'Docker',
			label: 'Docker Compose',
			title: 'Import services',
			description: 'Import every service from a Compose file.',
			icon: icon(<BoxesIcon />),
			render: props => <ComposeForm {...props} />
		},
		...DATABASE_ENGINES.map(engine => ({
			id: engine,
			group: 'Database',
			label: DATABASE_ENGINE_UI[engine].label,
			description: `${DATABASE_ENGINE_UI[engine].description} Managed volume, credentials and connection URL.`,
			icon: icon(<ServiceIcon type={engine} />),
			render: (props: SourceFormProps) => <DatabaseForm {...props} engine={engine} />
		})),
		...(templates.data ?? []).map(template => ({
			id: `template:${template.id}`,
			group: 'Templates',
			label: template.name,
			description: template.description,
			icon: <img src={template.logoUrl} alt="" className="size-4 shrink-0" />,
			render: (props: SourceFormProps) => <TemplateForm {...props} template={template} onLock={setLocked} />
		}))
	];
	const groups = [...new Set(options.map(option => option.group))];
	const selected = options.find(option => option.id === selectedId) ?? null;
	const guard = (event: Event) => {
		if (locked) event.preventDefault();
	};

	return (
		<Dialog open={open} onOpenChange={next => (next || !locked) && onOpenChange(next)}>
			<DialogContent
				className={cn('gap-0 overflow-hidden p-0', selectedId === 'analyze' ? 'sm:max-w-3xl' : 'sm:max-w-xl')}
				showCloseButton={selected !== null && !locked}
				onEscapeKeyDown={guard}
				onInteractOutside={guard}
			>
				{selected === null ? (
					<Command className="rounded-none">
						<DialogHeader className="sr-only">
							<DialogTitle>Create service</DialogTitle>
							<DialogDescription>Pick what to deploy.</DialogDescription>
						</DialogHeader>
						<CommandInput placeholder="What do you want to deploy?" className="h-12" />
						<CommandList className="max-h-[420px]">
							<CommandEmpty>Nothing matches.</CommandEmpty>
							{groups.map(group => (
								<CommandGroup key={group} heading={group}>
									{options
										.filter(option => option.group === group)
										.map(option => (
											<CommandItem
												key={option.id}
												value={`${option.label} ${option.group} ${option.id}`}
												onSelect={() => setSelectedId(option.id)}
												className="py-2"
											>
												{option.icon}
												<div className="min-w-0">
													<div className="font-medium">{option.label}</div>
													<div className="truncate text-xs text-muted-foreground">{option.description}</div>
												</div>
											</CommandItem>
										))}
								</CommandGroup>
							))}
							{templates.isPending && (
								<CommandGroup heading="Templates">
									<Skeleton className="mx-2 my-1 h-10" />
									<Skeleton className="mx-2 my-1 h-10" />
								</CommandGroup>
							)}
						</CommandList>
					</Command>
				) : (
					<>
						<DialogHeader className="flex-row items-center gap-3 border-b px-5 py-4 pr-12">
							{!locked && (
								<Button variant="ghost" size="icon-sm" onClick={() => setSelectedId(null)} aria-label="Back">
									<ArrowLeftIcon />
								</Button>
							)}
							<div className="min-w-0">
								<DialogTitle>{locked ? 'Generated secrets' : (selected.title ?? selected.label)}</DialogTitle>
								<DialogDescription>{locked ? 'Copy these now, they will not be shown again.' : selected.description}</DialogDescription>
							</div>
						</DialogHeader>
						{selected.render({
							environmentId: environment.id,
							taken: existing.map(service => service.name),
							onCreated,
							onClose: () => onOpenChange(false)
						})}
					</>
				)}
			</DialogContent>
		</Dialog>
	);
}
