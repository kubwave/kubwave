'use client';

import {
	Background,
	BackgroundVariant,
	MarkerType,
	ReactFlow,
	ReactFlowProvider,
	useNodesState,
	useReactFlow,
	type Edge,
	type OnSelectionChangeParams
} from '@xyflow/react';
import { ExternalLinkIcon, FocusIcon, GitPullRequestIcon, LayoutGridIcon, MinusIcon, PlusIcon, RocketIcon, ScanIcon, Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useConfirm } from '@/components/confirm-provider';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CreateServiceDialog } from '@/features/service/create/create-service-dialog';
import { ServicePanel } from '@/features/service/service-panel';
import { StagedChangesProvider } from '@/features/service/staged-changes';
import { StagedBar } from '@/features/service/staged-bar';
import { useSwitchTeam, useTeams } from '@/features/team/use-teams';
import type { Environment, FlowLayoutNode, ProjectDetail, Service } from '@/lib/api/types';
import { FLOW_GRID_SIZE, fallbackFlowPosition, snapFlowPosition } from '@/lib/flow-layout';
import { projectHref, resolveEnvironment } from '@/lib/routes';
import { deriveServiceConnections } from '@/lib/service-connections';
import { uuid } from '@/lib/uuid';
import { tidyLayout } from './canvas-model';
import { ServiceNode, type ServiceNodeType } from './service-node';
import { useProject } from './use-project';
import {
	FlowLayoutConflict,
	saveFlowNode,
	useDeleteService,
	useDeployService,
	useEnvironmentRuntime,
	useEnvironmentServices,
	useFlowLayout,
	useFlowLayoutCache,
	useFlowLayoutSocket
} from './use-environment';

const nodeTypes = { service: ServiceNode };
const PANEL_WIDTH = 720;
const NO_SERVICES: Service[] = [];

export function ProjectCanvas({ projectId }: { projectId: string }) {
	const searchParams = useSearchParams();
	const { data: project, isError } = useProject(projectId);
	const environment = project && resolveEnvironment(project.environments, searchParams.get('env') ?? undefined);
	useFollowProjectTeam(project);
	const projectName = project?.name;
	useEffect(() => {
		if (!projectName) return;
		const previous = document.title;
		document.title = `${projectName} · kubwave`;
		return () => {
			document.title = previous;
		};
	}, [projectName]);

	// A failed background refetch keeps the last project; only a project that never loaded is gone.
	if (isError && !project)
		return (
			<div className="flex flex-1 items-center justify-center p-8 text-center">
				<div>
					<h1 className="font-medium">This project is no longer available</h1>
					<p className="mt-1 text-sm text-muted-foreground">It was deleted, or you are no longer a member of its team.</p>
					<Button asChild variant="outline" size="sm" className="mt-4">
						<Link href="/">Back to projects</Link>
					</Button>
				</div>
			</div>
		);
	if (!project || !environment) return <div className="flex-1 bg-canvas" />;
	return (
		<ReactFlowProvider key={environment.id}>
			<StagedChangesProvider environmentId={environment.id}>
				<EnvironmentCanvas project={project} environment={environment} selectedServiceId={searchParams.get('service')} />
			</StagedChangesProvider>
		</ReactFlowProvider>
	);
}

// A link can open a project of another team the user belongs to: follow it by switching the active
// team. Decided once per project, so a later team switch by the user is not undone here.
function useFollowProjectTeam(project: ProjectDetail | undefined) {
	const router = useRouter();
	const { teams, activeTeamId, isPending } = useTeams();
	const { mutate: switchTeam } = useSwitchTeam();
	const followed = useRef<string | null>(null);
	const projectId = project?.id;
	const projectTeamId = project?.teamId;
	useEffect(() => {
		if (isPending || !projectId || !projectTeamId || followed.current === projectId) return;
		followed.current = projectId;
		if (projectTeamId === activeTeamId) return;
		if (teams.some(team => team.id === projectTeamId)) switchTeam(projectTeamId);
		else router.replace('/');
	}, [isPending, projectId, projectTeamId, activeTeamId, teams, switchTeam, router]);
}

function EnvironmentCanvas({
	project,
	environment,
	selectedServiceId
}: {
	project: ProjectDetail;
	environment: Environment;
	selectedServiceId: string | null;
}) {
	const router = useRouter();
	const confirm = useConfirm();
	const flow = useReactFlow();
	const canvasRef = useRef<HTMLDivElement>(null);
	const [createOpen, setCreateOpen] = useState(false);
	const [menuServiceId, setMenuServiceId] = useState<string | null>(null);
	const baseRevisions = useRef(new Map<string, number | null>());

	const services = useEnvironmentServices(environment.id).data ?? NO_SERVICES;
	const runtime = useEnvironmentRuntime(environment.id);
	const layout = useFlowLayout(environment.id).data;
	const layoutCache = useFlowLayoutCache(environment.id);
	useFlowLayoutSocket(environment.id);
	const deleteService = useDeleteService(environment.id);
	const deployService = useDeployService(environment.id);

	const connections = useMemo(() => deriveServiceConnections(services), [services]);
	const layoutById = useMemo(() => new Map((layout?.nodes ?? []).map(node => [node.serviceId, node])), [layout]);
	const selected = services.find(service => service.id === selectedServiceId);
	const neighbours = useMemo(() => {
		if (!selected) return null;
		const ids = new Set([selected.id]);
		for (const link of connections) {
			if (link.sourceServiceId === selected.id) ids.add(link.targetServiceId);
			if (link.targetServiceId === selected.id) ids.add(link.sourceServiceId);
		}
		return ids;
	}, [connections, selected]);

	const [nodes, setNodes, onNodesChange] = useNodesState<ServiceNodeType>([]);
	useEffect(() => {
		setNodes(current => {
			const byId = new Map(current.map(node => [node.id, node]));
			return services.map((service, index) => {
				const existing = byId.get(service.id);
				// Keep a node where the user is dragging it; everything else follows the stored layout.
				const position = existing?.dragging ? existing.position : (layoutById.get(service.id)?.position ?? fallbackFlowPosition(index));
				return {
					...(existing ?? { id: service.id, type: 'service' as const }),
					position,
					selected: service.id === selected?.id,
					data: { service, runtime: runtime[service.id], dimmed: neighbours ? !neighbours.has(service.id) : false }
				};
			});
		});
	}, [services, layoutById, runtime, selected?.id, neighbours, setNodes]);

	const edges: Edge[] = useMemo(
		() =>
			connections.map(link => {
				const active = selected !== undefined && (link.sourceServiceId === selected.id || link.targetServiceId === selected.id);
				const color = active ? 'var(--primary-text)' : 'var(--muted-foreground)';
				return {
					id: link.id,
					source: link.sourceServiceId,
					target: link.targetServiceId,
					type: 'smoothstep',
					animated: active,
					style: { stroke: color, strokeWidth: active ? 2 : 1.25, opacity: selected && !active ? 0.2 : active ? 1 : 0.55 },
					markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 }
				};
			}),
		[connections, selected]
	);

	// Switching services keeps the open panel tab and settings section; closing the panel drops them.
	const select = useCallback(
		(serviceId: string | null) => {
			const current = new URLSearchParams(window.location.search);
			const panel = serviceId ? { tab: current.get('tab') ?? undefined, section: current.get('section') ?? undefined } : {};
			router.replace(projectHref(project.id, { env: environment.id, service: serviceId ?? undefined, ...panel }), { scroll: false });
		},
		[router, project.id, environment.id]
	);

	const open = useCallback(
		(serviceId: string) => {
			select(serviceId);
			const node = flow.getNode(serviceId);
			const element = canvasRef.current;
			if (!node || !element) return;
			const panel = Math.min(PANEL_WIDTH, element.clientWidth);
			if (element.clientWidth - panel < 320) return;
			const zoom = flow.getZoom();
			const centerX = node.position.x + (node.measured?.width ?? 256) / 2;
			const centerY = node.position.y + (node.measured?.height ?? 110) / 2;
			void flow.setCenter(centerX + panel / 2 / zoom, centerY, { zoom, duration: 300 });
		},
		[select, flow]
	);
	// Selecting a node opens it: covers clicks and keyboard (Tab to a node, Enter or Space), which
	// React Flow turns into a selection but never into onNodeClick. React Flow re-runs the handler whenever
	// its identity changes, so it reads the open service from the URL: depending on selectedServiceId
	// would re-fire it on close with the still-selected node and reopen the panel.
	const openSelection = useCallback(
		({ nodes: picked }: OnSelectionChangeParams) => {
			const id = picked.length === 1 ? picked[0]!.id : null;
			if (id && id !== new URLSearchParams(window.location.search).get('service')) open(id);
		},
		[open]
	);

	useEffect(() => {
		if (!selected) return;
		// Escape inside a field belongs to the field (closing suggestions, leaving the editor), not to the panel.
		const onKey = (event: KeyboardEvent) =>
			event.key === 'Escape' && !event.defaultPrevented && !isEditable(event.target) && !document.querySelector('[role=dialog]') && select(null);
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [selected, select]);

	const persistPosition = async (serviceId: string, position: FlowLayoutNode['position']) => {
		const baseRevision = baseRevisions.current.get(serviceId) ?? layoutById.get(serviceId)?.revision ?? null;
		baseRevisions.current.delete(serviceId);
		layoutCache.set({ serviceId, position, revision: baseRevision ?? 0, updatedAt: new Date().toISOString() });
		try {
			layoutCache.set(await saveFlowNode(environment.id, serviceId, { position, baseRevision, clientMutationId: uuid() }));
		} catch (err) {
			if (!(err instanceof FlowLayoutConflict)) {
				toast.error('Could not save node position.');
				void layoutCache.refetch();
				return;
			}
			if (err.current) layoutCache.set(err.current);
			else layoutCache.remove(serviceId);
			toast.warning('Position changed elsewhere. Latest layout applied.');
		}
	};

	// Best effort: a node moved elsewhere in the meantime is skipped; the refetch restores the truth.
	const tidy = async () => {
		const positions = tidyLayout(services, connections);
		let failed = false;
		for (const service of services) {
			const position = positions[service.id];
			if (!position) continue;
			try {
				layoutCache.set(
					await saveFlowNode(environment.id, service.id, {
						position,
						baseRevision: layoutById.get(service.id)?.revision ?? null,
						clientMutationId: uuid()
					})
				);
			} catch (err) {
				if (!(err instanceof FlowLayoutConflict)) failed = true;
			}
		}
		if (failed) toast.error('Could not save the layout.');
		void layoutCache.refetch();
		window.setTimeout(() => void flow.fitView({ padding: 0.25, duration: 400 }), 60);
	};

	const deploy = (service: Service) =>
		deployService.mutate(service.id, {
			onSuccess: () => toast.success('Deployment started', { description: service.name }),
			onError: () => toast.error('Could not start deployment')
		});

	const remove = async (service: Service) => {
		const confirmed = await confirm({
			title: 'Delete service',
			description: `Delete ${service.name}? This removes it from the environment.`,
			destructive: true,
			confirmLabel: 'Delete service',
			confirmationText: service.name
		});
		if (!confirmed) return;
		try {
			await deleteService.mutateAsync(service.id);
			if (selected?.id === service.id) select(null);
			toast.success('Service deleted');
		} catch {
			toast.error('Could not delete service.');
		}
	};

	const menuService = services.find(service => service.id === menuServiceId);

	return (
		<div ref={canvasRef} className="relative h-[calc(100svh-49px)] w-full overflow-hidden bg-canvas">
			<ContextMenu>
				<ContextMenuTrigger asChild>
					<div className="absolute inset-0">
						<ReactFlow
							nodes={nodes}
							edges={edges}
							nodeTypes={nodeTypes}
							onNodesChange={onNodesChange}
							onSelectionChange={openSelection}
							selectNodesOnDrag={false}
							onPaneClick={() => select(null)}
							onNodeContextMenu={(_, node) => setMenuServiceId(node.id)}
							onPaneContextMenu={() => setMenuServiceId(null)}
							onNodeDragStart={(_, node) => baseRevisions.current.set(node.id, layoutById.get(node.id)?.revision ?? null)}
							onNodeDragStop={(_, node) => void persistPosition(node.id, snapFlowPosition(node.position))}
							nodesConnectable={false}
							snapToGrid
							snapGrid={[FLOW_GRID_SIZE, FLOW_GRID_SIZE]}
							fitView
							fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
							minZoom={0.3}
							maxZoom={1.6}
							proOptions={{ hideAttribution: true }}
						>
							<Background variant={BackgroundVariant.Dots} gap={FLOW_GRID_SIZE} size={1.2} color="var(--canvas-dot)" />
						</ReactFlow>
					</div>
				</ContextMenuTrigger>
				<ContextMenuContent className="w-48">
					{menuService ? (
						<>
							<ContextMenuItem onSelect={() => open(menuService.id)}>
								<ExternalLinkIcon /> Open
							</ContextMenuItem>
							<ContextMenuItem onSelect={() => deploy(menuService)}>
								<RocketIcon /> Deploy
							</ContextMenuItem>
							<ContextMenuSeparator />
							<ContextMenuItem variant="destructive" onSelect={() => void remove(menuService)}>
								<Trash2Icon /> Delete service
							</ContextMenuItem>
						</>
					) : (
						<>
							<ContextMenuItem onSelect={() => setCreateOpen(true)}>
								<PlusIcon /> Create service
							</ContextMenuItem>
							<ContextMenuItem onSelect={() => void flow.fitView({ padding: 0.3, duration: 400 })}>
								<FocusIcon /> Center view
							</ContextMenuItem>
							<ContextMenuItem onSelect={() => void tidy()}>
								<LayoutGridIcon /> Tidy up layout
							</ContextMenuItem>
						</>
					)}
				</ContextMenuContent>
			</ContextMenu>

			<div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-3">
				{environment.kind === 'preview' ? (
					<div className="pointer-events-auto flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-xs text-muted-foreground">
						<GitPullRequestIcon className="size-3.5" />
						Preview of{' '}
						{environment.prRepoUrl && environment.prNumber ? (
							<a
								href={`${environment.prRepoUrl.replace(/\.git$/, '')}/pull/${environment.prNumber}`}
								target="_blank"
								rel="noreferrer"
								className="font-mono text-foreground underline-offset-4 hover:underline"
							>
								PR #{environment.prNumber}
							</a>
						) : (
							<span className="font-mono text-foreground">a pull request</span>
						)}{' '}
						· removed when the PR closes
					</div>
				) : (
					<span />
				)}
				<div className={`pointer-events-auto flex items-center gap-2 ${selected ? 'mr-[min(720px,100%)] max-md:hidden' : ''}`}>
					<div className="flex items-center rounded-md border bg-card">
						<CanvasButton label="Zoom out" onClick={() => void flow.zoomOut({ duration: 200 })}>
							<MinusIcon />
						</CanvasButton>
						<CanvasButton label="Fit view" onClick={() => void flow.fitView({ padding: 0.3, duration: 400 })}>
							<ScanIcon />
						</CanvasButton>
						<CanvasButton label="Zoom in" onClick={() => void flow.zoomIn({ duration: 200 })}>
							<PlusIcon />
						</CanvasButton>
						<div className="h-5 w-px bg-border" />
						<CanvasButton label="Tidy up layout" onClick={() => void tidy()}>
							<LayoutGridIcon />
						</CanvasButton>
					</div>
					<Button size="sm" onClick={() => setCreateOpen(true)}>
						<PlusIcon /> Create
					</Button>
				</div>
			</div>

			{services.length === 0 && (
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
					<div className="pointer-events-auto flex max-w-sm flex-col items-center text-center">
						<h2 className="font-medium">No services in {environment.name}</h2>
						<p className="mt-1 text-sm text-muted-foreground">Add a repository, image, database or template.</p>
						<Button className="mt-5" onClick={() => setCreateOpen(true)}>
							<PlusIcon /> Create service
						</Button>
					</div>
				</div>
			)}

			<StagedBar services={services} shifted={Boolean(selected)} />

			{selected && (
				<ServicePanel
					key={selected.id}
					service={selected}
					services={services}
					runtime={runtime[selected.id]}
					onClose={() => select(null)}
					onDelete={() => void remove(selected)}
				/>
			)}

			<CreateServiceDialog
				open={createOpen}
				onOpenChange={setCreateOpen}
				environment={environment}
				existing={services}
				onCreated={created => {
					if (created[0]) select(created[0].id);
					window.setTimeout(() => void flow.fitView({ padding: 0.25, duration: 400 }), 120);
				}}
			/>
		</div>
	);
}

const isEditable = (target: EventTarget | null) =>
	target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

function CanvasButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button variant="ghost" size="icon-sm" aria-label={label} onClick={onClick} className="rounded-none first:rounded-l-lg last:rounded-r-lg">
					{children}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}
