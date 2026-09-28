'use client';

import { Background, BackgroundVariant, MarkerType, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, type Edge } from '@xyflow/react';
import { FocusIcon, GitPullRequestIcon, LayoutGridIcon, MinusIcon, PlusIcon, RocketIcon, ScanIcon, Trash2Icon, ExternalLinkIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useCurrentEnv } from '@/components/shell/project-switchers';
import { ServicePanel } from '@/components/service/service-panel';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { deploymentsFor, isDatabase, type Deployment, type EnvVar, type Environment, type Service } from '@/lib/mock';
import { CreateServiceDialog } from './create-service-dialog';
import { ServiceNode, type ServiceNodeType } from './service-node';
import { StagedBar, type StagedChange } from './staged-bar';

const nodeTypes = { service: ServiceNode };

const refPattern = /\$\{\{services\.([\w-]+)\.|([\w-]+)\.svc\.cluster\.local/g;

function deriveEdges(services: Service[]) {
	const byName = new Map(services.map(s => [s.name, s]));
	const edges: { source: string; target: string }[] = [];
	for (const s of services) {
		const targets = new Set<string>();
		for (const v of s.vars) for (const m of v.value.matchAll(refPattern)) targets.add(m[1] ?? m[2]!);
		for (const t of targets) {
			const target = byName.get(t);
			if (target && target.id !== s.id) edges.push({ source: s.id, target: target.id });
		}
	}
	return edges;
}

function tidyPositions(services: Service[]) {
	const edges = deriveEdges(services);
	const col = new Map<string, number>();
	const depth = (id: string, seen = new Set<string>()): number => {
		if (col.has(id)) return col.get(id)!;
		if (seen.has(id)) return 0;
		seen.add(id);
		const consumers = edges.filter(e => e.target === id).map(e => e.source);
		const d = consumers.length ? Math.max(...consumers.map(c => depth(c, seen) + 1)) : 0;
		col.set(id, d);
		return d;
	};
	services.forEach(s => depth(s.id));
	const maxCol = Math.max(0, ...services.filter(s => !isDatabase(s.type)).map(s => col.get(s.id)!)) + 1;
	const rows = new Map<number, number>();
	return Object.fromEntries(
		services.map(s => {
			const c = isDatabase(s.type) ? Math.max(maxCol, col.get(s.id)!) : col.get(s.id)!;
			const r = rows.get(c) ?? 0;
			rows.set(c, r + 1);
			return [s.id, { x: c * 340, y: r * 210 }];
		})
	);
}

const now = () => new Date().toLocaleTimeString('en-GB');

export function ProjectView({ projectId }: { projectId: string }) {
	const env = useCurrentEnv(projectId)!;
	return (
		<ReactFlowProvider key={env.id}>
			<EnvCanvas env={env} />
		</ReactFlowProvider>
	);
}

function EnvCanvas({ env }: { env: Environment }) {
	const [services, setServices] = useState(env.services);
	const [deployments, setDeployments] = useState<Record<string, Deployment[]>>({});
	const [draftVars, setDraftVars] = useState<Record<string, EnvVar[]>>({});
	const [staged, setStaged] = useState<StagedChange[]>([]);
	const [resetKey, setResetKey] = useState(0);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [expanded, setExpanded] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);
	const [menuNodeId, setMenuNodeId] = useState<string | null>(null);
	const timers = useRef<Map<string, number[]>>(new Map());
	const flow = useReactFlow();
	const canvasRef = useRef<HTMLDivElement>(null);

	const [nodes, setNodes, onNodesChange] = useNodesState<ServiceNodeType>(
		env.services.map(s => ({ id: s.id, type: 'service', position: s.position, data: { service: s, dimmed: false } }))
	);

	const links = useMemo(() => deriveEdges(services), [services]);
	const neighbours = useMemo(() => {
		if (!selectedId) return null;
		const set = new Set([selectedId]);
		links.forEach(l => {
			if (l.source === selectedId) set.add(l.target);
			if (l.target === selectedId) set.add(l.source);
		});
		return set;
	}, [links, selectedId]);

	useEffect(() => {
		setNodes(ns => {
			const byId = new Map(ns.map(n => [n.id, n]));
			return services.map(s => {
				const n = byId.get(s.id);
				return {
					...(n ?? { id: s.id, type: 'service' as const, position: s.position }),
					selected: s.id === selectedId,
					data: { service: s, dimmed: neighbours ? !neighbours.has(s.id) : false }
				};
			});
		});
	}, [services, selectedId, neighbours, setNodes]);

	const edges: Edge[] = useMemo(
		() =>
			links.map(l => {
				const active = selectedId !== null && (l.source === selectedId || l.target === selectedId);
				const color = active ? 'var(--primary-text)' : 'var(--muted-foreground)';
				return {
					id: `${l.source}->${l.target}`,
					...l,
					type: 'smoothstep',
					animated: active,
					style: { stroke: color, strokeWidth: active ? 2 : 1.25, opacity: selectedId && !active ? 0.2 : active ? 1 : 0.55 },
					markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 }
				};
			}),
		[links, selectedId]
	);

	useEffect(() => {
		const all = timers.current;
		return () => all.forEach(ts => ts.forEach(clearTimeout));
	}, []);

	const patchService = useCallback(
		(id: string, patch: Partial<Service>) => setServices(ss => ss.map(s => (s.id === id ? { ...s, ...patch } : s))),
		[]
	);

	const patchDeployment = useCallback(
		(serviceId: string, depId: string, fn: (d: Deployment) => Deployment) =>
			setDeployments(m => ({ ...m, [serviceId]: (m[serviceId] ?? []).map(d => (d.id === depId ? fn(d) : d)) })),
		[]
	);

	const deploy = useCallback(
		(svc: Service, reason = 'Manual deploy', initial = false) => {
			const depId = `d-${Date.now()}-${svc.id}`;
			const log = deploymentsFor({ ...svc, lastDeploy: { status: 'succeeded', ago: '' } })[0]!.buildLog;
			const fresh: Deployment = {
				id: depId,
				status: 'pending',
				phase: 'queued',
				trigger: 'manual',
				commit: svc.lastDeploy.commit,
				message: reason,
				author: 'alex',
				createdAt: 'Today',
				ago: 'just now',
				duration: '0:00',
				events: [{ at: now(), level: 'info', step: 'queued', message: 'Deployment queued' }],
				buildLog: []
			};
			setDeployments(m => ({ ...m, [svc.id]: [fresh, ...(m[svc.id] ?? (initial ? [] : deploymentsFor(svc)))] }));
			patchService(svc.id, { status: 'progressing', lastDeploy: { ...svc.lastDeploy, status: 'deploying', ago: 'just now', message: reason } });

			const steps: [number, (d: Deployment) => Deployment][] = [
				[
					800,
					d => ({
						...d,
						status: 'deploying',
						phase: 'building',
						duration: '0:02',
						events: [...d.events, { at: now(), level: 'info', step: 'build-started', message: 'Build started on builder-7f9c' }],
						buildLog: log.slice(0, 6)
					})
				],
				[2000, d => ({ ...d, duration: '0:14', buildLog: log.slice(0, 11) })],
				[
					3200,
					d => ({
						...d,
						phase: 'pushing',
						duration: '0:31',
						events: [...d.events, { at: now(), level: 'info', step: 'pushing', message: 'Pushing image to registry' }],
						buildLog: log
					})
				],
				[
					4400,
					d => ({
						...d,
						phase: 'rolling out',
						duration: '0:44',
						events: [...d.events, { at: now(), level: 'info', step: 'rollout', message: `Rolling out ${svc.replicas[1] || 1} replica(s)` }]
					})
				],
				[
					5600,
					d => ({
						...d,
						status: 'succeeded',
						phase: 'done',
						duration: '0:56',
						events: [...d.events, { at: now(), level: 'info', step: 'succeeded', message: 'Rollout complete' }]
					})
				]
			];
			const ids = steps.map(([ms, fn]) => window.setTimeout(() => patchDeployment(svc.id, depId, fn), ms));
			ids.push(
				window.setTimeout(() => {
					setDeployments(m => ({
						...m,
						[svc.id]: (m[svc.id] ?? []).map(d => (d.id !== depId && d.status === 'succeeded' ? { ...d, status: 'superseded' } : d))
					}));
					const desired = svc.replicas[1] || 1;
					patchService(svc.id, {
						status: 'running',
						replicas: [desired, desired],
						lastDeploy: { ...svc.lastDeploy, status: 'succeeded', ago: 'just now', message: reason }
					});
					toast.success(`${svc.name} deployed`, { description: reason });
				}, 5700)
			);
			timers.current.set(depId, ids);
		},
		[patchDeployment, patchService]
	);

	const cancel = useCallback(
		(svc: Service) => {
			const head = (deployments[svc.id] ?? [])[0];
			if (!head) return;
			timers.current.get(head.id)?.forEach(clearTimeout);
			patchDeployment(svc.id, head.id, d => ({ ...d, status: 'canceling' }));
			window.setTimeout(() => {
				patchDeployment(svc.id, head.id, d => ({
					...d,
					status: 'canceled',
					phase: 'canceled',
					events: [...d.events, { at: now(), level: 'warn', step: 'canceled', message: 'Canceled by alex' }]
				}));
				patchService(svc.id, { status: 'running', lastDeploy: { ...svc.lastDeploy, status: 'canceled', ago: 'just now' } });
			}, 900);
		},
		[deployments, patchDeployment, patchService]
	);

	const stage = useCallback((serviceId: string, kind: string) => {
		setStaged(s => (s.some(c => c.serviceId === serviceId && c.kind === kind) ? s : [...s, { serviceId, kind }]));
	}, []);

	const applyStaged = () => {
		const ids = [...new Set(staged.map(c => c.serviceId))];
		const merged = services.map(s => (draftVars[s.id] ? { ...s, vars: draftVars[s.id]! } : s));
		setServices(merged);
		setDraftVars({});
		setStaged([]);
		merged.filter(s => ids.includes(s.id)).forEach(s => deploy(s, 'Apply staged changes'));
	};

	const discardStaged = () => {
		setDraftVars({});
		setStaged([]);
		setResetKey(k => k + 1);
	};

	const remove = (id: string) => {
		setServices(ss => ss.filter(s => s.id !== id));
		setStaged(s => s.filter(c => c.serviceId !== id));
		if (selectedId === id) setSelectedId(null);
		toast.success('Service deleted');
	};

	const tidy = () => {
		const pos = tidyPositions(services);
		setNodes(ns => ns.map(n => ({ ...n, position: pos[n.id] ?? n.position })));
		window.setTimeout(() => flow.fitView({ padding: 0.25, duration: 400 }), 30);
	};

	const create = (created: Service[]) => {
		const maxX = Math.max(-340, ...nodes.map(n => n.position.x));
		const placed = created.map((s, i) => ({ ...s, position: { x: maxX + 340, y: i * 210 } }));
		setNodes(ns => [...ns, ...placed.map(s => ({ id: s.id, type: 'service' as const, position: s.position, data: { service: s, dimmed: false } }))]);
		setServices(ss => [...ss, ...placed]);
		setSelectedId(placed[0]?.id ?? null);
		placed.forEach(s => deploy(s, 'Initial deploy', true));
		window.setTimeout(() => flow.fitView({ padding: 0.25, duration: 400 }), 60);
	};

	useEffect(() => {
		if (!selectedId) return;
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[role=dialog]') && setSelectedId(null);
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [selectedId]);

	const open = (id: string) => {
		setSelectedId(id);
		const node = flow.getNode(id);
		const el = canvasRef.current;
		if (!node || !el) return;
		const panel = Math.min(720, el.clientWidth);
		if (el.clientWidth - panel < 320) return;
		const zoom = flow.getZoom();
		const cx = node.position.x + (node.measured?.width ?? 256) / 2;
		const cy = node.position.y + (node.measured?.height ?? 110) / 2;
		flow.setCenter(cx + panel / 2 / zoom, cy, { zoom, duration: 300 });
	};

	const selected = services.find(s => s.id === selectedId);
	const menuService = services.find(s => s.id === menuNodeId);

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
							onNodeClick={(_, n) => open(n.id)}
							onPaneClick={() => setSelectedId(null)}
							onNodeContextMenu={(_, n) => setMenuNodeId(n.id)}
							onPaneContextMenu={() => setMenuNodeId(null)}
							nodesConnectable={false}
							snapToGrid
							snapGrid={[20, 20]}
							fitView
							fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
							minZoom={0.3}
							maxZoom={1.6}
							proOptions={{ hideAttribution: true }}
						>
							<Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--canvas-dot)" />
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
							<ContextMenuItem variant="destructive" onSelect={() => remove(menuService.id)}>
								<Trash2Icon /> Delete service
							</ContextMenuItem>
						</>
					) : (
						<>
							<ContextMenuItem onSelect={() => setCreateOpen(true)}>
								<PlusIcon /> Create service
							</ContextMenuItem>
							<ContextMenuItem onSelect={() => flow.fitView({ padding: 0.3, duration: 400 })}>
								<FocusIcon /> Center view
							</ContextMenuItem>
							<ContextMenuItem onSelect={tidy}>
								<LayoutGridIcon /> Tidy up layout
							</ContextMenuItem>
						</>
					)}
				</ContextMenuContent>
			</ContextMenu>

			<div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-3">
				{env.kind === 'preview' ? (
					<div className="pointer-events-auto flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-xs text-muted-foreground">
						<GitPullRequestIcon className="size-3.5" />
						Preview of <span className="font-mono text-foreground">feat/checkout-v2</span> · removed when the PR closes
					</div>
				) : (
					<span />
				)}
				<div className={`pointer-events-auto flex items-center gap-2 ${selected ? 'mr-[min(720px,100%)] max-md:hidden' : ''}`}>
					<div className="flex items-center rounded-md border bg-card">
						<CanvasButton label="Zoom out" onClick={() => flow.zoomOut({ duration: 200 })}>
							<MinusIcon />
						</CanvasButton>
						<CanvasButton label="Fit view" onClick={() => flow.fitView({ padding: 0.3, duration: 400 })}>
							<ScanIcon />
						</CanvasButton>
						<CanvasButton label="Zoom in" onClick={() => flow.zoomIn({ duration: 200 })}>
							<PlusIcon />
						</CanvasButton>
						<div className="h-5 w-px bg-border" />
						<CanvasButton label="Tidy up layout" onClick={tidy}>
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
						<h2 className="font-medium">No services in {env.name}</h2>
						<p className="mt-1 text-sm text-muted-foreground">Add a repository, image, database or template.</p>
						<Button className="mt-5" onClick={() => setCreateOpen(true)}>
							<PlusIcon /> Create service
						</Button>
					</div>
				</div>
			)}

			<StagedBar staged={staged} services={services} onDiscard={discardStaged} onApply={applyStaged} shifted={!!selected} />

			{selected && (
				<ServicePanel
					key={`${selected.id}-${resetKey}`}
					service={selected}
					services={services}
					deployments={deployments[selected.id] ?? deploymentsFor(selected)}
					vars={draftVars[selected.id] ?? selected.vars}
					expanded={expanded}
					onToggleExpand={() => setExpanded(e => !e)}
					onClose={() => setSelectedId(null)}
					onDeploy={() => deploy(selected)}
					onCancel={() => cancel(selected)}
					onVarsChange={vars => {
						setDraftVars(d => ({ ...d, [selected.id]: vars }));
						stage(selected.id, 'variables');
					}}
					onStage={kind => stage(selected.id, kind)}
					onDelete={() => remove(selected.id)}
				/>
			)}

			<CreateServiceDialog open={createOpen} onOpenChange={setCreateOpen} existing={services} onCreate={create} />
		</div>
	);
}

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
