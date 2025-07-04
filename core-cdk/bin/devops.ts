#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';

// PILLOWNET General Cloud Resources (ELB, VPC, EFS, etc)
import { PillowCoreStack } from '../lib/devops-stack';

// Config Imports
import config from '../config/config.json';

const app = new cdk.App();
console.log("\nDeploying Pillow Cloud Core with the following values:\n");
console.log(config);
new PillowCoreStack(app, config.stack_name, config, {});