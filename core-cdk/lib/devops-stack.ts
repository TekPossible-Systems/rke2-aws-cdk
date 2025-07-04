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
import { VpcEndpointServiceDomainName } from 'aws-cdk-lib/aws-route53';



/*

README:

PIL.LOW NET Core Cloud Infrastructure Stack

This stack creates the following core infrastructure which is referenced RKE2 Stack as well as other stacks

1. PIL.LOW VPC in the cloud
2. EFS Share (/k8s) for the RKE2 Kubernetes System
3. Tailscale Server for connectivity to PIL.LOW HQ networks.  

*/

// METHODS


export class PillowCoreStack extends cdk.Stack {
  constructor(scope: Construct, id: string, config: any, props?: cdk.StackProps) {
    super(scope, id, props);  


    // Create VPC

    var vpc = new ec2.Vpc(this, config.stack_name  + "-VPC", {
      vpcName: config.stack_name  + "-VPC",
      maxAzs: 1, // For now, we only want 1 AZ for this system - this might change in the future if I get more mula
      enableDnsSupport: true,
      enableDnsHostnames: true, // Need this for EFS DNS stuff
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "Private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        }, 
        {
          cidrMask: 24,
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
          mapPublicIpOnLaunch: true
        }
      ],
      ipAddresses: ec2.IpAddresses.cidr(config.ipAddresses + "/16"),
      natGateways: 1,
      createInternetGateway: true
    })

    const ssm_parameter_vpc = new ssm.StringParameter(this, config.stack_name + "-VPCSSMParameter", { // Create an SSM Parameter for the CodeCommit GRC Clone URL
      parameterName: config.stack_name.toLowerCase() + '-vpc',
      stringValue: vpc.vpcId
    });



    // Create EFS Share and return the IP Address of the server

    const efs_security_group = new ec2.SecurityGroup(this, config.stack_name + "EFS-SHARE-SG", {
      vpc: vpc
    });

    efs_security_group.addIngressRule(ec2.Peer.ipv4(config.ipAddresses + "/16"), ec2.Port.NFS);

    const ssm_parameter_efs_sg = new ssm.StringParameter(this, config.stack_name + "-EFSSGParameter", { // Create an SSM Parameter for the CodeCommit GRC Clone URL
      parameterName: config.stack_name.toLowerCase() + '-efs-sg',
      stringValue: efs_security_group.securityGroupId
    });

    var efs_volume = new efs.FileSystem(this, config.stack_name + "EFS_FS", {
      vpc: vpc, 
      allowAnonymousAccess: false, // We want authenticated read/write - might need to change this for RKE2 support be we will see...
      oneZone: true,
      encrypted: true, // FIPS 140-3 Appears to be supported which is cool - Thanks AWS!
      fileSystemName: config.stack_name + "efs-k8s", // This is not the mount path on the EFS side, just the name of the share
      removalPolicy: cdk.RemovalPolicy.DESTROY, // We will keep this for now, but will want to think about this longer term     
      securityGroup: efs_security_group
    });
    
    const ssm_parameter_efs = new ssm.StringParameter(this, config.stack_name + "-EFSSSMParameter", { // Create an SSM Parameter for the CodeCommit GRC Clone URL
      parameterName: config.stack_name.toLowerCase() + '-efs',
      stringValue: efs_volume.fileSystemId
    });

    // Create Tailscale Server and return the IP Address of this server
    const tailscale_security_group = new ec2.SecurityGroup(this, config.stack_name + "NLB-SG", {
      vpc: vpc
    });

    tailscale_security_group.addIngressRule(ec2.Peer.ipv4(config.ipAddresses + "/16"), ec2.Port.allTraffic()); // Allow the NLB to get connections to any port from the /16 that is defined in config.json:ipAddresses 



    var tailscale_iam_role = new iam.Role(this, config.stack_name + "TailscaleIAMRole", {
      roleName: config.stack_name + "TailscaleIAMRole",
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com')
    });

    tailscale_iam_role.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, config.stack_name + "-MPROLE_SSM", "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"));
    tailscale_iam_role.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(this, config.stack_name + "-MPROLE_LOGS", "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy"));
   

    var tailscale_user_data_str = readFileSync("./assets/userdata.sh", "utf-8");
    tailscale_user_data_str = tailscale_user_data_str.replace("ROUTES", config.ipAddresses + "/16");
    var tailscale_user_data = ec2.UserData.forLinux({});
    tailscale_user_data.addCommands(tailscale_user_data_str);


    var tailscale =  new ec2.Instance(this, config.stack_name + "Tailscale", {
      vpc: vpc, 
      vpcSubnets: vpc.selectSubnets({subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS}),
      machineImage: ec2.MachineImage.genericLinux(config.ami),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MEDIUM),
      securityGroup: tailscale_security_group, // The NLB Security Group actually works great here, since it allows all ports/protocols from the VPC to talk to it
      userData: tailscale_user_data,
      role: tailscale_iam_role,
      instanceName: config.stack_name + "-Tailscale"
    });

    // Create NLB and Bind the ID of it to an SSM parameter
    var nlb = new elb.NetworkLoadBalancer(this, config.stack_name, {
      vpc: vpc, 
      vpcSubnets: vpc.selectSubnets({subnetType: ec2.SubnetType.PUBLIC}),
      internetFacing: false,
      crossZoneEnabled: false,
      loadBalancerName: config.stack_name + "-RKE2-NLB",
      securityGroups: [tailscale_security_group]
    });


    const ssm_paremeter_nlb = new ssm.StringParameter(this, config.stack_name + "-LoadBalancerSSMParameter", { // Create an SSM Parameter for the CodeCommit GRC Clone URL
      parameterName: config.stack_name.toLowerCase() + '-elb',
      stringValue: nlb.loadBalancerArn
    });



    const ssm_parameter_tailscale = new ssm.StringParameter(this, config.stack_name + "-TailscaleSSMParameter", { // Create an SSM Parameter for the CodeCommit GRC Clone URL
      parameterName: config.stack_name.toLowerCase() + '-tailscale',
      stringValue: tailscale.instancePrivateIp
    });


  }
}
