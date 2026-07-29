---
title: Infomaniak PCK
description: Set up kubwave on Infomaniak Public Cloud Kubernetes (PCK), including storage and load balancer prerequisites.
---

**Infomaniak PCK** runs kubwave on Infomaniak Public Cloud Kubernetes. PCK is OpenStack-backed and
ships its own cloud-controller-manager, Cinder CSI driver, and cluster autoscaler, so kubwave
installs none of them and does not pin workloads to CFKE node labels.

- **Platform ID:** `infomaniak-pck`
- **Load balancer:** OpenStack Octavia, provisioned by the OpenStack CCM when Traefik requests a
  `Service` of type `LoadBalancer`. Octavia derives one listener per service port, so kubwave sets
  no listener annotations.
- **Storage:** `csi-cinder-sc-delete` (provisioner `cinder.csi.openstack.org`), pre-installed by PCK.
- **Autoscaling:** managed by Infomaniak. kubwave does not install a Cluster Autoscaler here.

## Prerequisites

- An **Infomaniak Public Cloud Kubernetes** cluster in your Public Cloud project.
- A **kubeconfig** with cluster-admin rights.
- A **domain** pointing at the Traefik load balancer after install (or use a temporary hostname
  while testing).

## Set it up

::steps

1.  **Point `kubectl` at the cluster.** Download the kubeconfig from the Infomaniak Public Cloud
    manager, then verify the cluster is reachable:

    ```sh
    kubectl get nodes
    kubectl get storageclass
    ```

    You should see both `csi-cinder-sc-delete` and `csi-cinder-sc-retain`. If they are missing, the
    Cinder CSI driver is not healthy — fix the cluster before continuing.

    ```sh
    kubectl get csidriver cinder.csi.openstack.org
    ```

2.  **Run the installer.**

    ```sh
    kubwave install \
      --platform infomaniak-pck \
      --domain app.example.com \
      --email ops@example.com
    ```

    For non-interactive installs, pass `--yes` together with `--domain`, `--email`, and
    `--platform`.

    ::callout{type="tip" title="No CFKE labels"}
    PCK nodes do not carry `cfke.io/provider` labels. kubwave skips CFKE node selectors on Traefik
    and platform workloads for this target.
    ::

3.  **Verify the install.** After `helm --wait` completes:

    ```sh
    kubectl -n traefik get svc traefik
    kubectl -n kubwave get pods
    ```

    The Traefik service should receive an external IP from the OpenStack CCM. Open
    `https://app.example.com` to complete setup.

::

## Load balancer notes

Octavia assigns the load balancer a floating IP from the external network configured for your
Public Cloud project. If the Traefik service stays in `<pending>` and the CCM logs an error about
selecting a floating network, your project has more than one external network (or none set as
default) and Octavia cannot choose. Pass the network explicitly:

```sh
kubwave install --platform infomaniak-pck --infomaniak-floating-network-id <network-uuid> ...
```

Find the UUID with `openstack network list --external`. kubwave writes it to the Traefik service as
`loadbalancer.openstack.org/floating-network-id` and preserves it across `kubwave update`.

Octavia bills per listener, and kubwave's public TCP port pool adds one listener per allocatable port
on top of `:80` and `:443` — 22 listeners with the default pool (20 ports from `30100`). Narrow or
disable the pool in the admin settings if that cost matters; `kubwave update` reconciles the Traefik
service to match.

## Storage notes

kubwave tenant PVCs bind to `csi-cinder-sc-delete` by default — not to the cluster default
`csi-cinder-sc-retain`. Retain keeps the Cinder volume after a PVC is deleted, so every removed
service would leave a billable disk behind. If `csi-cinder-sc-delete` is missing, kubwave falls back
to the Retain class and warns.

To override:

```sh
kubwave install --platform infomaniak-pck --storage-class <name> ...
```

## Cluster autoscaling

PCK node pools are Cluster-API `MachineDeployment`s scaled by Infomaniak's own managed
cluster-autoscaler. kubwave neither installs nor configures an autoscaler on this platform —
set node pool min/max sizes in the Infomaniak Public Cloud manager.
