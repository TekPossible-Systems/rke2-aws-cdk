import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

// Misc Imports
import { readFileSync } from 'fs';
import { exit } from 'process';

// Import CDK Libraries
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as imagebuilder from 'aws-cdk-lib/aws-imagebuilder';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';

import { VpcEndpointServiceDomainName } from 'aws-cdk-lib/aws-route53';
import { DefaultValue } from 'aws-cdk-lib/aws-cloudwatch';
import { Method } from 'aws-cdk-lib/aws-apigateway';
import { AutoScalingGroup } from 'aws-cdk-lib/aws-autoscaling';



/*

README:

PIL.LOW NET RKE2 Infrastructure in the Cloud

This stack creates the following core infrastructure which is referenced RKE2 Stack as well as other stacks

1. RKE2 Autoscaling Group in VPC at <SSM Parameter -> config.json:vpc_parameter>
2. Association between RKE2 ASG and the NLB
3. Association between RKE2 ASG and the EFS server 

*/

// METHODS

function create_iam_role(scope: Construct, config: any){

  var rke2_role = new iam.Role(scope, config.stack_name + "RKE2IAMRole", {
    roleName: config.stack_name + "RKE2",
    assumedBy: new iam.CompositePrincipal(
      new iam.ServicePrincipal("ec2.amazonaws.com"),
    ),
    description: "RKE2 Node Role for Stack " + config.stack_name
  });

    rke2_role.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(scope, config.stack_name + "-MPROLE_SSM", "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"));
    rke2_role.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(scope, config.stack_name + "-MPROLE_LOGS", "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"));
    rke2_role.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(scope, config.stack_name + "-MPROLE_S3", "arn:aws:iam::aws:policy/AmazonS3FullAccess"));

  return(rke2_role);

}

function create_asg(scope: Construct, config: any,  vpc: any, iam_role: any, tailscale_ip: string, elb_dns: string) {

  var rke2_user_data =  ec2.UserData.forLinux({});
  var rke2_user_data_str = readFileSync("./assets/userdata.sh", "utf-8");
  rke2_user_data_str = rke2_user_data_str.replace(/TAILSCALE_IP/g, tailscale_ip);
  rke2_user_data_str = rke2_user_data_str.replace(/LOADBALANCER_RKE/g, elb_dns);


  rke2_user_data.addCommands(rke2_user_data_str);

  var rke2_sg = new ec2.SecurityGroup(scope, config.stack_name + "-SG", {
    vpc: vpc,
    securityGroupName: config.stack_name + "-SG"
  });
  
  rke2_sg.addIngressRule(ec2.Peer.ipv4("10.12.0.0/16"), ec2.Port.allTraffic()); // Allow the RKE2 Nodes to talk to everyone

  var ami_id = ssm.StringParameter.valueFromLookup(scope, config.ami_parameter, undefined, {});
  var ami_cfg: Record<string, string> = {};
  var region: string = config.region;
  ami_cfg[region] = ami_id;

  // EBS Disk config
  const ebs_disk_size = 64; // 64 GB
  const ebs_device_options = {
    encrypted: true,
    volumeType: ec2.EbsDeviceVolumeType.PROVISIONED_IOPS_SSD_IO2, 
    iops: 3000
  };


  var rke2_launch = new ec2.LaunchTemplate(scope, config.stack_name + "LaunchTemplate", {
    machineImage: ec2.MachineImage.genericLinux(ami_cfg),
    securityGroup: rke2_sg, 
    role: iam_role,
    requireImdsv2: true,
    launchTemplateName: config.stack_name + "-RKE2",
    userData: rke2_user_data,
    instanceType: new ec2.InstanceType(config['rke2']['instance_type']),
    keyPair:  ec2.KeyPair.fromKeyPairName(scope, config.stack_name + "-KEYPAIR", "pillows-rsa" ),
    blockDevices: [{
        deviceName: "/dev/sda1",
        mappingEnabled: true,
        volume: ec2.BlockDeviceVolume.ebs(ebs_disk_size, ebs_device_options)
      }]    
  });

  var asg = new autoscaling.AutoScalingGroup(scope, config.stack_name + "RKE2-ASG", {
    vpc: vpc, 
    autoScalingGroupName: config.stack_name + "-RKE2-ASG",
    launchTemplate: rke2_launch,
    maxCapacity: config['rke2']['max_nodes'],
    minCapacity: config['rke2']['min_nodes']
  });
  return(asg);
}


function bind_nlb_asg(scope: Construct, config: any, rke2_asg: any, nlb: any) { 
  config['rke2']['ports'].forEach((port: number) => {
    var tmp_listener = nlb.addListener(config.stack_name + "NLB_LISTENER" + String(port), {
      port: port,
      protocol: elb.Protocol.TCP,
      
    }).addTargets(config.stack_name + "NLB_TGT" + String(port), {
      port: port,
      protocol: elb.Protocol.TCP,
      targets: [rke2_asg],
      deregistrationDelay: cdk.Duration.seconds(30) // Default it waits 5 minutes before killing instances - now it waits 30 seconds.
    });

  });

}

export class PillowRKE2 extends cdk.Stack {
  constructor(scope: Construct, id: string, config: any, props?: cdk.StackProps) {
    super(scope, id, props); 

    const vpcId: string = ssm.StringParameter.valueFromLookup(this, config.vpc_parameter, "", {});
    const vpc = ec2.Vpc.fromLookup(this, config.stack_name + "Vpc", {
      vpcId: vpcId
    });


    const efs_filesystem = efs.FileSystem.fromFileSystemAttributes(this, config.stack_name + "EFS", {
      fileSystemId: ssm.StringParameter.valueFromLookup(this, config.efs_parameter, undefined, {}),
      securityGroup: ec2.SecurityGroup.fromSecurityGroupId(this, config.stack_name + "EFSSecurityGroup", ssm.StringParameter.valueFromLookup(this, config.efs_sg_parameter, undefined, {}), {})
    });


    const nlb = elb.NetworkLoadBalancer.fromLookup(this, config.stack_name  + "NLB", {
      loadBalancerArn: ssm.StringParameter.valueFromLookup(this, config.elb_parameter, undefined, {})
    });

    var rke2_role = create_iam_role(this, config); // Create the RKE2 Role

    efs_filesystem.grantRootAccess(rke2_role); // Grant the RKE2 Server access to the EFS share

    var tailscale_ip: string = ssm.StringParameter.valueFromLookup(this, config.tailscale_parameter, "", {});

    var rke2_asg = create_asg(this, config, vpc, rke2_role, tailscale_ip, nlb.loadBalancerDnsName); // Create RKE2 ASG

    bind_nlb_asg(this, config, rke2_asg, nlb);
    
    // Allow the following through the NLB
    /* 

    TODO: I dont really like implementation, and would like to be able to use the LoadBalancer class as its intended. I think I need to look at the helm chart for aws-load-balancer-controller instead
    6443/tcp
    9345/tcp
    443/tcp
    80/tcp

    */ 
  
  }
}
