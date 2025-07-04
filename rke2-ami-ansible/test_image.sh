#!/bin/bash

# Prep work for RHEL 9 STIG Role From DISA. Note: I did not modify  the DISA role so it should be modular for when there is an update to it.
cd ansible

# Run ansible local setup
ansible-galaxy collection install community.general ansible.posix
ansible-playbook playbooks/additional_security_settings.yml -c local -vv -i inventory/localsetup
