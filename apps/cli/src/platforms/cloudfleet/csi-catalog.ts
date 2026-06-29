import type { CloudProvider } from '~/lib/cloud-provider.js';
import pdCsiManifest from './gcp/pd-csi-driver.yaml' with { type: 'text' };

// Keep in sync with scripts/gen-gcp-csi-manifest.sh.
export const GCP_PD_CSI_VERSION = 'v1.26.0';

export type CsiPrerequisite = {
	kind: 'secret';
	namespace: string;
	name: string;
	key?: string;
	hint: string;
	bootstrapFrom?: {
		kind: 'secret-key';
		namespace: string;
		name: string;
		key: string;
		targetKey?: string;
		description: string;
	};
};

export type StorageClassSpec = {
	name: string;
	provisioner: string;
	parameters?: Record<string, string>;
	reclaimPolicy?: 'Delete' | 'Retain';
	volumeBindingMode?: 'Immediate' | 'WaitForFirstConsumer';
	allowVolumeExpansion?: boolean;
};

export type HelmCsiInstall = {
	kind: 'helm';
	repo: { name: string; url: string };
	chart: string;
	release: string;
	namespace: string;
	extraArgs: string[];
};

export type ManifestCsiInstall = {
	kind: 'manifest';
	namespace: string;
	driverVersion: string;
	// Rendered upstream manifest, embedded as text; applied with server-side apply.
	manifest: string;
};

export type CsiInstall = HelmCsiInstall | ManifestCsiInstall;

export type CsiDefinition = {
	label: string;
	install: CsiInstall;
	storageClass: string;
	provisioner: string;
	nodeSelector: Record<string, string>;
	// StorageClass created (idempotently) post-install when the upstream chart ships none (AWS, GCP); Hetzner already ships "hcloud-volumes".
	createStorageClass?: StorageClassSpec;
	// Hard prerequisite checked before install; if missing, the CLI aborts with the hint.
	prerequisite?: CsiPrerequisite;
	// Informational note printed before install (e.g. "needs IAM on nodes"); never blocks.
	info?: string;
};

export const CSI_CATALOG: Record<CloudProvider, CsiDefinition> = {
	hetzner: {
		label: 'Hetzner Cloud CSI Driver',
		install: { kind: 'helm', repo: { name: 'hcloud', url: 'https://charts.hetzner.cloud' }, chart: 'hcloud/hcloud-csi', release: 'hcloud-csi', namespace: 'kube-system', extraArgs: ['--set', 'controller.nodeSelector.cfke\\.io/provider=hetzner', '--set', 'node.nodeSelector.cfke\\.io/provider=hetzner'] },
		storageClass: 'hcloud-volumes',
		provisioner: 'csi.hetzner.cloud',
		nodeSelector: { 'cfke.io/provider': 'hetzner' },
		prerequisite: {
			kind: 'secret',
			namespace: 'kube-system',
			name: 'hcloud',
			key: 'token',
			hint: 'Cloudfleet should provide the Hetzner token as kube-system/fleet-secrets key hetzner. If it is missing too, create the hcloud secret with:\n  kubectl -n kube-system create secret generic hcloud --from-literal=token=<Hetzner-API-Token>',
			bootstrapFrom: {
				kind: 'secret-key',
				namespace: 'kube-system',
				name: 'fleet-secrets',
				key: 'hetzner',
				targetKey: 'token',
				description: 'Cloudfleet fleet secret'
			}
		}
	},
	aws: {
		label: 'AWS EBS CSI Driver',
		install: { kind: 'helm', repo: { name: 'aws-ebs-csi-driver', url: 'https://kubernetes-sigs.github.io/aws-ebs-csi-driver' }, chart: 'aws-ebs-csi-driver/aws-ebs-csi-driver', release: 'aws-ebs-csi-driver', namespace: 'kube-system', extraArgs: ['--set', 'controller.nodeSelector.cfke\\.io/provider=aws', '--set', 'node.nodeSelector.cfke\\.io/provider=aws'] },
		storageClass: 'ebs-sc',
		provisioner: 'ebs.csi.aws.com',
		nodeSelector: { 'cfke.io/provider': 'aws' },
		createStorageClass: {
			name: 'ebs-sc',
			provisioner: 'ebs.csi.aws.com',
			parameters: { type: 'gp3' },
			reclaimPolicy: 'Delete',
			volumeBindingMode: 'WaitForFirstConsumer',
			allowVolumeExpansion: true
		},
		info: 'AWS EBS CSI needs IAM permissions on the nodes (instance profile, IRSA, or a kube-system/aws-secret secret). If the Cloudfleet AWS nodes do not have a suitable instance profile, the CSI controller will not be able to provision PVCs. Setup guide: https://github.com/kubernetes-sigs/aws-ebs-csi-driver/blob/master/docs/install.md'
	},
	gcp: {
		label: 'GCP Persistent Disk CSI Driver',
		install: {
			kind: 'manifest',
			namespace: 'gce-pd-csi-driver',
			driverVersion: GCP_PD_CSI_VERSION,
			manifest: pdCsiManifest
		},
		storageClass: 'pd-ssd',
		provisioner: 'pd.csi.storage.gke.io',
		nodeSelector: { 'cfke.io/provider': 'gcp' },
		createStorageClass: {
			name: 'pd-ssd',
			provisioner: 'pd.csi.storage.gke.io',
			parameters: { type: 'pd-ssd' },
			reclaimPolicy: 'Delete',
			volumeBindingMode: 'WaitForFirstConsumer',
			allowVolumeExpansion: true
		},
		prerequisite: {
			kind: 'secret',
			namespace: 'gce-pd-csi-driver',
			name: 'cloud-sa',
			hint: 'The GCP PD CSI driver needs a GCP service account with compute.storageAdmin + iam.serviceAccountUser. Create a JSON key, then run:\n  kubectl create namespace gce-pd-csi-driver\n  kubectl -n gce-pd-csi-driver create secret generic cloud-sa --from-file=cloud-sa.json=<path/to/key.json>'
		}
	}
};
