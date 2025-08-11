#!/bin/bash
# Kubernetes Manifest installation 

helm upgrade --install cert-manager --create-namespace -n cert-manager ./cert-manager-v1.17.1.tgz -f ./cert-manager.yaml --kubeconfig /etc/rancher/rke2/rke2.yaml
helm upgrade --install efs --create-namespace -n efs-system ./aws-efs-csi-driver-3.2.0.tgz -f ./efs-csi.yaml --kubeconfig /etc/rancher/rke2/rke2.yaml
helm upgrade --install argocd --create-namespace -n argocd ./argo-cd-8.1.2.tgz -f ./argocd.yaml  --kubeconfig /etc/rancher/rke2/rke2.yaml
helm upgrade --install rancher --create-namespace -n cattle-system ./rancher-2.11.2.tgz -f ./rancher-ui.yaml --kubeconfig /etc/rancher/rke2/rke2.yaml
helm upgrade --install sonarqube --create-namespace -n sonarqube ./sonarqube-2025.4.2.tgz -f ./sonarqube.yaml --kubeconfig /etc/rancher/rke2/rke2.yaml
kubectl apply -f pillows-ca-gitlab.yaml --kubeconfig /etc/rancher/rke2/rke2.yaml
helm upgrade --install gitlab --create-namespace -n gitlab ./gitlab-9.2.1.tgz -f ./gitlab.yaml --kubeconfig /etc/rancher/rke2/rke2.yaml
echo 'Done installing manifests!'