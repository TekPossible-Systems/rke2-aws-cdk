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

# AWSCLI Install
sudo dnf install ipa-client unzip bind-utils -y
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
cd /tmp
unzip -qq awscliv2.zip
sudo ./aws/install
sudo ln -s /usr/local/bin/aws /usr/bin/aws

# Install Tailscale
sudo dnf config-manager --add-repo https://pkgs.tailscale.com/stable/rhel/9/tailscale.repo
sudo dnf install tailscale -y --nogpgcheck
sudo systemctl enable --now tailscaled
TAILSCALE_AUTH_KEY=$(aws secretsmanager get-secret-value --secret-id 'TAILSCALE_SECRET_ID'  --query SecretString --output text | jq .TAILSCALE_SECRET_KEY | sed 's/"//g')
sudo tailscale login --auth-key $TAILSCALE_AUTH_KEY
sudo tailscale up --accept-routes --advertise-routes=ROUTES 

# IPA DNS Configuration
while ! ping -c 1 IPA_SERVER; do
    sleep 1
done

IPA_USERNAME=$(aws secretsmanager get-secret-value --secret-id 'IDM_SECRET_ID'  --query SecretString --output text | jq .IDM_USER_SECRET_KEY | sed 's/"//g')
IPA_PASSWORD=$(aws secretsmanager get-secret-value --secret-id 'IDM_SECRET_ID'  --query SecretString --output text | jq .IDM_PASS_SECRET_KEY | sed 's/"//g')

sudo ipa-client-install --mkhomedir --server IPA_SERVER --domain IPA_DOMAIN --force-join -p $IPA_USERNAME -w $IPA_PASSWORD -U
sudo kdestroy -A
echo "$IPA_PASSWORD" | kinit $IPA_USERNAME
ELB_IP=$( host -v ELB_DNS | grep 'IN A' | awk '{print $5}')
sudo ipa dnsrecord-del pil.low *.cloud --del-all
sudo ipa dnsrecord-add pil.low *.cloud --a-ip-address=$ELB_IP