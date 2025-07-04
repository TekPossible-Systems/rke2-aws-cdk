#!/bin/bash

## TAILSCALE INSTANCE USER DATA

# Disable Firewalld for Tailscale
sudo systemctl disable --now firewalld

# Set hostname and import AWS GPG key 
sudo hostnamectl set-hostname msup-tailscale.cloud.pil.low
sudo rpm --import /etc/pki/rpm-gpg/amazon-gpg-key

# Tailscale IPv4/v6 Forwarding
echo 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
echo 'net.ipv6.conf.all.forwarding = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
sudo sysctl -p /etc/sysctl.d/99-tailscale.conf

# AWS SSM Agent Deploy
sudo rpm -ivh --nodigest --nosignature https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/linux_amd64/amazon-ssm-agent.rpm
sudo systemctl enable --now amazon-ssm-agent

# Install Tailscale
sudo dnf config-manager --add-repo https://pkgs.tailscale.com/stable/rhel/9/tailscale.repo
sudo dnf install tailscale -y --nogpgcheck
sudo systemctl enable --now tailscaled
sudo tailscale up --accept-routes --advertise-routes=ROUTES &> /root/tailscale.log