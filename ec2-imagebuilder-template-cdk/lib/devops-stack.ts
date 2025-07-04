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



/*

README:

PIL.LOW NET Image Pipeline Stack Template

This stack creates the following things when cloned down in a build job:

1. An Codepipline pipeline for each branch in config.json:branches linked to the repo in config.json:repo
2. The EC2 Image Builder Pipeline with the specified component file in assets/ec2-imagebuilder-component.yaml (PROVIDED in the repo that is using this as its build template)
3. The specified SSM image parameter (config.json:ssm_output) for the region specified in config.json:region with the format ssm_output+BRANCH_HERE
4. s3 buckets for artifacts/scans as well as for any in between points in the codepipeline


NOTE: The actual component file etc needs to be provided by the user of this template, as that is sort of the point of this repo.

*/

// METHODS

function create_iam_roles(scope: Construct, config: any){
  // Create EC2 Image Builder Role
  var ec2_ib_role = new iam.Role(scope, config.stack_name + '-EC2ImageBuilderRole', {
      assumedBy: new iam.CompositePrincipal(
      new iam.ServicePrincipal("ec2.amazonaws.com"),
      new iam.ServicePrincipal("codecommit.amazonaws.com"),
      new iam.ServicePrincipal("codepipeline.amazonaws.com"),
      new iam.ServicePrincipal("s3.amazonaws.com"),
      new iam.ServicePrincipal("imagebuilder.amazonaws.com")

    ),
    roleName: config.stack_name + '-EC2ImageBuilderRole',
    description: "EC2 Image Builder role for CDK Stack: " + config.stack_name
  });

  ec2_ib_role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("EC2InstanceProfileForImageBuilder"));
  ec2_ib_role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("EC2InstanceProfileForImageBuilderECRContainerBuilds"));
  ec2_ib_role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"));
  ec2_ib_role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AdministratorAccess"));

  // Create CodePipeline Role
  var codepipeline_role = new iam.Role(scope, config.stack_name + '-AMI-CodePipelineRole', {
    assumedBy: new iam.CompositePrincipal(
      new iam.ServicePrincipal("ec2.amazonaws.com"),
      new iam.ServicePrincipal("codebuild.amazonaws.com"),
      new iam.ServicePrincipal("codedeploy.amazonaws.com"), 
      new iam.ServicePrincipal("codecommit.amazonaws.com"),
      new iam.ServicePrincipal("cloudformation.amazonaws.com"),
      new iam.ServicePrincipal("sns.amazonaws.com"),
      new iam.ServicePrincipal("codepipeline.amazonaws.com"),
      new iam.ServicePrincipal("s3.amazonaws.com"),
      new iam.ServicePrincipal("imagebuilder.amazonaws.com"),
      new iam.ServicePrincipal("ssm.amazonaws.com")
    ),
    roleName: config.stack_name + '-CodePipelineRole',
    description: "CodePipeline role for CDK Stack: " + config.stack_name
  });

  codepipeline_role.addManagedPolicy(iam.ManagedPolicy.fromManagedPolicyArn(scope, config.stack_name + "-ManagedPolicy", "arn:aws:iam::aws:policy/service-role/AWSCodeStarServiceRole"));
  codepipeline_role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess"));
  codepipeline_role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AWSImageBuilderFullAccess"));
  codepipeline_role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AWSCodeCommitFullAccess"));
  codepipeline_role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMFullAccess"));

  const instance_profile = new iam.CfnInstanceProfile(scope, config.stack_name + "-EC2IBInstanceProfile", {
        instanceProfileName: config.stack_name + "EC2IB-InstanceProfile",
        roles: [ec2_ib_role.roleName]
  });

  // Return roles to the function that calls this guy
  return(
    {
      "imagebuilder": ec2_ib_role,
      "codepipeline": codepipeline_role,
      "instance_profile": instance_profile
    }
  );

}

function create_sns_topic(scope: Construct, config: any) {
   const image_codepipeline_sns_topic = new sns.Topic(scope, config.stack_name + '-ami-codepipeline-sns-topic', {
    topicName: config.stack_name + '-ami-codepipeline-sns-topic',
    displayName: config.stack_name + "AMI Codepipeline SNS Approval"
  });

  var i: number  = 0; 
  config['repo']['emails'].forEach((email: string) => {
    var image_codepipeline_sns_subscription = new sns.Subscription(scope, config.stack_name + "-ami-codepipeline-sns-sub-" + i.toString(), {
      topic: image_codepipeline_sns_topic,
      protocol: sns.SubscriptionProtocol.EMAIL,
      endpoint: email
    });
    i ++;
  });
 
  return(image_codepipeline_sns_topic);
}

function create_pipeline(scope: Construct, config: any, branch: string, iam_roles: any, sns_topic: any, codecommit_repo: any) {
  // 1. Create the EC2 Image Builder Pipeline
  // a. Create EC2 Instance Profile and Infrastructure Configuration
  const infrastucture_config = new imagebuilder.CfnInfrastructureConfiguration(scope, config.stack_name + "-InfraConfig-" + branch, {
    name: config.stack_name + "EC2IB-InstanceProfile" + branch,
    instanceProfileName: String(iam_roles['instance_profile'].instanceProfileName),
    instanceTypes: [
      "m4.large"
    ]
  });
  infrastucture_config.node.addDependency(iam_roles['instance_profile']);

  // b. Load the EC2 Image Builder Component from the Assets folder. NOTE: The component must be named component.yaml
  var component_file_data = readFileSync("./assets/component.yaml", "utf-8");

  // c. Create the component with the details specified in config.json:component
  const imagebuilder_component = new imagebuilder.CfnComponent(scope, config.stack_name + "-Component-" + branch, {
    name: config['component']['name'] + "-" + branch,
    version: config['component']['version'],
    platform: "Linux",
    data: component_file_data
  });
  const componentConfigurationProperty: imagebuilder.CfnContainerRecipe.ComponentConfigurationProperty = {
    componentArn: imagebuilder_component.attrArn,
  };

  // d. Create the image recipe with the specified source AMI linking to the latest version of the component
  const image_recipe = new imagebuilder.CfnImageRecipe(scope, config.stack_name + "-ImageRecipe-" + branch, {
    name: config.stack_name + "-" + branch,
    parentImage: config['source_ami'],
    components: [componentConfigurationProperty],
    version: config['component']['version']
  });

  // e. Create the image pipeline linked to the image recipe
  const image_pipeline = new imagebuilder.CfnImagePipeline(scope, config.stack_name + "-ImagePipeline-" + branch, {
    name: config.stack_name + "-" + branch,
    infrastructureConfigurationArn: infrastucture_config.attrArn,
    imageRecipeArn: image_recipe.attrArn,
    // distributionConfigurationArn: "",
    executionRole: iam_roles['imagebuilder'].roleArn

  });
  image_pipeline.node.addDependency(infrastucture_config);

  // 2. Create the CodePipeline Pipeline that Links the AMI Repo and the Image Builder Pipeline 
  // a. Create the s3 bucket for use with CodePipeline - this will store any of the artifacts generated in the job.
  const codepipeline_s3_bucket =  new s3.Bucket(scope, config.stack_name + "-pipeline-storage-" + branch, {
      versioned: true, 
      bucketName: config.stack_name.toLowerCase( ) + "-pipeline-storage-" + branch,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true
  });

  // b. Create the CodePipeline Pipeline (We will add stuff to it as we go)
  const image_codepipeline = new codepipeline.Pipeline(scope, config.stack_name + branch, {
      pipelineName: config.stack_name + "-" + branch,
      artifactBucket: codepipeline_s3_bucket,
      restartExecutionOnUpdate: false,
      role: iam_roles['codepipeline']
  });
  const image_codepipeline_artifact_src = new codepipeline.Artifact(config.stack_name + "-PipelineArtifactSource-" + branch);
  const image_codepipeline_artifact_out = new codepipeline.Artifact(config.stack_name + "-PipelineArtifactOutput-" + branch);
  
  // c. Hook the CodeCommit repo referenced in config.json:repos into the sourceAction of the pipeline
  const image_pipeline_src_action = new codepipeline_actions.CodeCommitSourceAction({
    repository:  codecommit_repo,
    actionName: "SourceAction",
    output: image_codepipeline_artifact_src,
    branch: branch,
    codeBuildCloneOutput: true
  });

  const infra_pipeline_src = image_codepipeline.addStage({
    stageName: "Source",
    actions: [image_pipeline_src_action]
  });

  // d. Create the deploy approval stage which sends a notification to the SNS topic we created.
  const image_pipeline_approval_action = new codepipeline_actions.ManualApprovalAction({
      actionName: "DeployApproval",
      notificationTopic: sns_topic
    });
  
  const image_pipeline_approval_stage = image_codepipeline.addStage({
    stageName: "DeployApproval",
    actions: [image_pipeline_approval_action]
  });

  // e. Create the CodeBuild job that launches the EC2 Image Builder Pipeline. NOTE: The actual of the pipeline will be in another repo, the AMI Automation repo where our ansible is stored,
  const image_codepipline_codebuild = new codepipeline_actions.CodeBuildAction({ // Codebuild will build the software code, make it into a tar, and then commit the git tag/tar file the image repo
      input: image_codepipeline_artifact_src,
      actionName: "CodeBuild",
      project: new codebuild.PipelineProject(scope, config.stack_name + "-codebuild-ami-pre-" + branch, {
        environment: {
          buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_5,
          computeType: codebuild.ComputeType.SMALL,
          
        },
        timeout: cdk.Duration.hours(2),  // Note: https://repost.aws/questions/QUNe84jgBRQ9G5ACLDUzCt4w/free-tier-account-s-codebuild-stops-after-45min
        role: iam_roles['codepipeline']
      }),
      outputs: [image_codepipeline_artifact_out]
    });

    const image_codepipline_codebuild_stage = image_codepipeline.addStage({
      stageName: "Build",
      actions: [image_codepipline_codebuild]
    });

    const ssm_parameter = new ssm.StringParameter(scope, config.stack_name + "-ImageBuilderARN-" + branch, { // Create an SSM Parameter for the CodeCommit GRC Clone URL
      parameterName: config.stack_name.toLowerCase() + '-imagebuilder-arn-' + branch,
      stringValue: image_pipeline.attrArn
    });

}

export class ImagePipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, config: any, props?: cdk.StackProps) {
    super(scope, id, props);

    var iam_roles = create_iam_roles(this, config); // Create IAM Roles for EC2 Image Builder and CodePipeline
    var sns_topic = create_sns_topic(this, config); // Create an SNS Topic and Subscribe Emails in the config.json:repo:emails list
    const codecommit_repo =  codecommit.Repository.fromRepositoryName(this, config.stack_name + 'CodeCommitRepo', config['repo']['name']); // Get the codecommit repo specified in config.json:repo:name
    const ssm_parameter = new ssm.StringParameter(this, config.stack_name + "-RepoSSMParameter", { // Create an SSM Parameter for the CodeCommit GRC Clone URL
      parameterName: config.stack_name.toLowerCase() + '-repo',
      stringValue: codecommit_repo.repositoryCloneUrlGrc
    });

    const ssm_parameter_region = new ssm.StringParameter(this, config.stack_name + "-RegionSSMParameter", { // Create an SSM Parameter for the CodeCommit GRC Clone URL
      parameterName: config.stack_name.toLowerCase() + '-region',
      stringValue: this.region
    });

    // For each of the branches in config.json:repo:branches, create a CodePipeline pipeline and an EC2 Image Builder Pipeline
    config['repo']['branches'].forEach( (branch: any) => {
      create_pipeline(this, config, branch, iam_roles, sns_topic, codecommit_repo);
    }); 

  }
}
