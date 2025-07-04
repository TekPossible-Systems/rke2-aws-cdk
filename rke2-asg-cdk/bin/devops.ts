#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';

// PILLOWNET General Cloud Resources (ELB, VPC, EFS, etc)
import { PillowRKE2 } from '../lib/devops-stack';

// Config Imports
import config from '../config/config.json';

const app = new cdk.App();
new PillowRKE2(app, config.stack_name, config, {env: {account: config.account, region: config.region}});