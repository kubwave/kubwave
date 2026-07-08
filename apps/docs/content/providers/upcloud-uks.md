---
title: UpCloud UKS
description: Set up kubwave on UpCloud Managed Kubernetes (UKS), including storage and load balancer prerequisites.
---

**UpCloud UKS** runs kubwave on UpCloud Managed Kubernetes. UKS ships its own
cloud-controller-manager and CSI driver, so kubwave does not install storage drivers or pin
workloads to CFKE node labels.

- **Platform ID:** `upcloud-uks`
- **Load balancer:** UpCloud load balancer, provisioned by the UKS cloud-controller-manager when
  Traefik requests a `Service` of type `LoadBalancer`.
- **Storage:** Default StorageClass `upcloud-block-storage-maxiops` (provisioner
  `storage.csi.upcloud.com`), pre-installed by UKS.

## Prerequisites

- An **UpCloud Managed Kubernetes (UKS)** cluster in your UpCloud account.
- A **kubeconfig** with cluster-admin rights.
- A **domain** pointing at the Traefik load balancer after install (or use a temporary hostname
  while testing).

## Set it up

::steps

1.  **Point `kubectl` at the cluster.** Download the kubeconfig from the UpCloud Control Panel or
    API, then verify the cluster is reachable:

    ```sh
    kubectl get nodes
    kubectl get storageclass
    ```

    You should see a default StorageClass named `upcloud-block-storage-maxiops`. If it is missing,
    the UKS CSI driver is not healthy — fix the cluster before continuing.

    ```sh
    kubectl get csidriver storage.csi.upcloud.com
    ```

2.  **Run the installer.**

    ```sh
    kubwave install \
      --platform upcloud-uks \
      --domain app.example.com \
      --email ops@example.com
    ```

    For non-interactive installs, pass `--yes` together with `--domain`, `--email`, and
    `--platform`.

    ::callout{type="tip" title="No CFKE labels"}
    UKS nodes do not carry `cfke.io/provider` labels. kubwave skips CFKE node selectors on Traefik
    and platform workloads for this target.
    ::

3.  **Verify the install.** After `helm --wait` completes:

    ```sh
    kubectl -n traefik get svc traefik
    kubectl -n kubwave get pods
    ```

    The Traefik service should receive an external IP or hostname from the UpCloud CCM. Open
    `https://app.example.com` to complete setup.

::

## Storage notes

kubwave tenant PVCs bind to `upcloud-block-storage-maxiops` by default. To override:

```sh
kubwave install --platform upcloud-uks --storage-class <name> ...
```

UKS zones (for example `fi-hel2`, `de-fra1`, `us-nyc1`) are chosen by the CCM when provisioning
load balancers — no CLI flag is required in v1.

## Cluster autoscaling

UpCloud UKS does not ship the [Cluster Autoscaler](https://upcloud.com/docs/products/managed-kubernetes/autoscaling/)
pre-installed. During `kubwave install --platform upcloud-uks`, the CLI can optionally deploy it
so node groups scale when pods cannot be scheduled.

The installer prompts whether to install the autoscaler. It creates:

- Secret `kube-system/upcloud-autoscaler` with your UpCloud API credentials
- RBAC and Deployment `kube-system/cluster-autoscaler` (`ghcr.io/upcloudltd/autoscaler`)

You need:

- The **UKS cluster UUID** from the UpCloud Control Panel
- An **UpCloud API token** with permission to manage the Kubernetes cluster (preferred).
  A username/password pair is still accepted as a basic-auth fallback, but tokens are more
  reliable and easier to scope.

Node group **min/max sizes** are configured in UpCloud (Control Panel, API, or Terraform) — kubwave
does not change node group limits.

Non-interactive example:

```sh
export UPCLOUD_TOKEN=your-api-token

kubwave install \
  --platform upcloud-uks \
  --domain app.example.com \
  --email ops@example.com \
  --yes \
  --upcloud-autoscaling \
  --upcloud-cluster-uuid 01234567-89ab-cdef-0123-456789abcdef
```

Skip autoscaling:

```sh
kubwave install --platform upcloud-uks --no-upcloud-autoscaling ...
```

`kubwave uninstall` removes only the autoscaler kubwave installed (identified by ownership labels).
`kubwave update` re-applies the deployment manifest when autoscaling was enabled at install time.

## GPU node groups

UKS supports GPU node plans (for example L40S). kubwave does not configure GPU node pools in v1;
create them in the UpCloud Control Panel or via Terraform, then deploy GPU services with the usual
Kubernetes resource requests.
