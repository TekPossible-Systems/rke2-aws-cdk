#!/bin/bash

## RKE2 Final Setup Script

# import AWS GPG key 
sudo rpm --import /etc/pki/rpm-gpg/amazon-gpg-key

sudo dnf install -y bind-utils 
ELB_IP=$(host LOADBALANCER_RKE | grep 'has address' | awk '{print $4}' | tail -n 1)

sudo ip route add 10.11.0.0/16 via TAILSCALE_IP
sudo systemctl disable --now firewalld

# AWS SSM Agent Deploy
sudo rpm -ivh --nodigest --nosignature https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/linux_amd64/amazon-ssm-agent.rpm
sudo systemctl enable --now amazon-ssm-agent

# Start rke2 server ansible

cd /staging/*/ansible

sed -i "s/LOADBALANCER_HERE/$ELB_IP/g" ./inventory/localsetup/hosts.yml
sed -i 's/TAILSCALE_SERVER/TAILSCALE_IP/g' ../rke2_discovery.py

ansible-playbook playbooks/rke2_setup.yaml -c local -vv -i inventory/localsetup