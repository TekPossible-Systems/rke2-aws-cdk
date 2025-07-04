#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';

// PILLOWNET Generic EC2-IB Pipeline Template
import { ImagePipelineStack } from '../lib/devops-stack';

// TekPossible DevOps Config Imports
import config from '../config/config.json';

const app = new cdk.App();
console.log("\nDeploying Template <EC2 Image Builder Pipeline> with the following config:\n");
console.log(config);
new ImagePipelineStack(app, config.stack_name, config, {});